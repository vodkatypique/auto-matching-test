import { normalizeLabel } from "./label";
import type {
  InvoiceRow,
  InvoiceWithDueDate,
  TransactionRow,
} from "./types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// README rule: the due date falls between 3 days before and 30 days after
// the transaction date.
const MAX_DAYS_DUE_BEFORE_PAYMENT = 3;
const MAX_DAYS_DUE_AFTER_PAYMENT = 30;

// Calendar days from b to a, for two 'YYYY-MM-DD' dates. Date.parse reads a
// date-only ISO string as UTC midnight, and UTC has no daylight saving time,
// so the result is a whole number of days whatever the machine's time zone.
export function dayDiff(a: string, b: string): number {
  return (Date.parse(a) - Date.parse(b)) / MS_PER_DAY;
}

export function scoreCandidate(
  transaction: TransactionRow,
  invoice: InvoiceWithDueDate,
): number {
  const label = normalizeLabel(transaction.label);
  let score = Math.abs(dayDiff(transaction.date, invoice.due_date));

  if (
    label.includes(normalizeLabel(invoice.supplier_name)) ||
    label.includes(normalizeLabel(invoice.invoice_number))
  ) {
    score -= 100;
  }

  return score;
}

export function findMatch(
  transaction: TransactionRow,
  invoices: InvoiceRow[],
): InvoiceRow | null {
  const candidates = invoices
    // An invoice without a due date cannot be placed in the window. The old
    // code excluded it by accident
    .filter(
      (invoice): invoice is InvoiceWithDueDate => invoice.due_date !== null,
    )
    // A payment is a debit (negative amount) of the invoice total. Without
    // Math.abs, a credit can no longer match a supplier invoice.
    .filter(
      (invoice) =>
        invoice.tax_free_total_cents + invoice.vat_amount_cents ===
        -transaction.amount_cents,
    )
    .filter((invoice) => {
      const daysFromPaymentToDue = dayDiff(invoice.due_date, transaction.date);
      return (
        daysFromPaymentToDue >= -MAX_DAYS_DUE_BEFORE_PAYMENT &&
        daysFromPaymentToDue <= MAX_DAYS_DUE_AFTER_PAYMENT
      );
    });

  if (candidates.length === 0) {
    return null;
  }

  const scored = candidates.map((invoice) => ({
    invoice,
    score: scoreCandidate(transaction, invoice),
  }));
  scored.sort((a, b) => a.score - b.score);
  return scored[0].invoice;
}
