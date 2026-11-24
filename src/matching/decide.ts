import { citesInvoiceNumber, labelNamesSupplier } from "./label";
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

// An invoice without a due date cannot be placed in the window. The old code
// excluded it by accident: new Date(null) is 1970.
export function hasDueDate(invoice: InvoiceRow): invoice is InvoiceWithDueDate {
  return invoice.due_date !== null;
}

// A payment is a debit (negative amount) of the invoice total. Without
// Math.abs, a credit can no longer match a supplier invoice.
export function paysInvoiceTotal(
  transaction: TransactionRow,
  invoice: InvoiceRow,
): boolean {
  return (
    invoice.tax_free_total_cents + invoice.vat_amount_cents ===
    -transaction.amount_cents
  );
}

export function isDueWithinWindow(
  transaction: TransactionRow,
  invoice: InvoiceWithDueDate,
): boolean {
  const daysFromPaymentToDue = dayDiff(invoice.due_date, transaction.date);
  return (
    daysFromPaymentToDue >= -MAX_DAYS_DUE_BEFORE_PAYMENT &&
    daysFromPaymentToDue <= MAX_DAYS_DUE_AFTER_PAYMENT
  );
}

// Amount and date alone prove nothing: totals repeat a lot (153 Orange
// invoices of 59.99 in the seed). The bank label must designate the invoice,
// by its number or by its supplier's name.
export function isDesignatedByLabel(
  transaction: TransactionRow,
  invoice: InvoiceRow,
): boolean {
  return (
    citesInvoiceNumber(
      transaction.label,
      transaction.reference,
      invoice.invoice_number,
    ) || labelNamesSupplier(transaction.label, invoice.supplier_name)
  );
}

export function findMatch(
  transaction: TransactionRow,
  invoices: InvoiceRow[],
): InvoiceRow | null {
  const candidates = invoices
    .filter(hasDueDate)
    .filter((invoice) => paysInvoiceTotal(transaction, invoice))
    .filter((invoice) => isDueWithinWindow(transaction, invoice))
    .filter((invoice) => isDesignatedByLabel(transaction, invoice));

  // Several invoices can still qualify. Until that case is handled, the
  // closest due date wins, as before.
  const daysToDue = (invoice: InvoiceWithDueDate) =>
    Math.abs(dayDiff(invoice.due_date, transaction.date));
  candidates.sort((a, b) => daysToDue(a) - daysToDue(b));
  return candidates[0] ?? null;
}
