import { citesInvoiceNumber, labelNamesSupplier } from "./label";
import type {
  InvoiceRow,
  InvoiceWithDueDate,
  MatchDecision,
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

export function findCandidates(
  transaction: TransactionRow,
  invoices: InvoiceRow[],
): InvoiceWithDueDate[] {
  return invoices
    .filter(hasDueDate)
    .filter((invoice) => paysInvoiceTotal(transaction, invoice))
    .filter((invoice) => isDueWithinWindow(transaction, invoice))
    .filter((invoice) => isDesignatedByLabel(transaction, invoice));
}

type Choice =
  | { outcome: "chosen"; invoice: InvoiceRow }
  | { outcome: "no_candidate" | "ambiguous" };

// Picks the invoice a transaction pays, without guessing: an invoice cited by
// its number beats one only named by its supplier, and when several invoices
// remain equally designated, none is picked.
function chooseInvoice(
  transaction: TransactionRow,
  candidates: InvoiceRow[],
): Choice {
  const citedByNumber = candidates.filter((invoice) =>
    citesInvoiceNumber(
      transaction.label,
      transaction.reference,
      invoice.invoice_number,
    ),
  );
  const strongest = citedByNumber.length > 0 ? citedByNumber : candidates;

  if (strongest.length === 0) {
    return { outcome: "no_candidate" };
  }
  if (strongest.length > 1) {
    return { outcome: "ambiguous" };
  }
  return { outcome: "chosen", invoice: strongest[0] };
}

// Decides every transaction before anything is written, so that an invoice
// chosen by two transactions (a duplicated bank import, two payments of the
// same amount) leaves both unmatched instead of being paid twice. The result
// does not depend on the order of the transactions.
export function decideMatches(
  transactions: TransactionRow[],
  invoices: InvoiceRow[],
): MatchDecision[] {
  const choices = transactions.map((transaction) => ({
    transaction,
    choice: chooseInvoice(transaction, findCandidates(transaction, invoices)),
  }));

  const claimsPerInvoice = new Map<string, number>();
  for (const { choice } of choices) {
    if (choice.outcome === "chosen") {
      const claims = claimsPerInvoice.get(choice.invoice.id) ?? 0;
      claimsPerInvoice.set(choice.invoice.id, claims + 1);
    }
  }

  return choices.map(({ transaction, choice }): MatchDecision => {
    if (choice.outcome !== "chosen") {
      return { transactionId: transaction.id, outcome: choice.outcome };
    }
    if ((claimsPerInvoice.get(choice.invoice.id) ?? 0) > 1) {
      return { transactionId: transaction.id, outcome: "contested" };
    }
    return {
      transactionId: transaction.id,
      outcome: "matched",
      invoiceId: choice.invoice.id,
    };
  });
}
