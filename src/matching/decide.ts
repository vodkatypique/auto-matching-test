import { citesInvoiceNumber, labelNamesSupplier } from "./label";
import type {
  InvoiceRow,
  MatchDecision,
  TransactionCandidates,
  TransactionRow,
} from "./types";

// Eligibility, the exact amount and the due date window are checked in SQL
// (getMatchCandidates). This module holds the decision policy: the label must
// designate the invoice, and nothing is guessed.

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
  transactions: TransactionCandidates[],
): MatchDecision[] {
  const choices = transactions.map(({ transaction, candidates }) => ({
    transaction,
    choice: chooseInvoice(
      transaction,
      candidates.filter((invoice) => isDesignatedByLabel(transaction, invoice)),
    ),
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
