import { normalizeLabel } from "./label";
import type { InvoiceRow, TransactionRow } from "./types";

export function dayDiff(a: Date | string, b: Date | string): number {
  return Math.floor((new Date(a).getTime() - new Date(b).getTime()) / 86400000);
}

export function scoreCandidate(
  transaction: TransactionRow,
  invoice: InvoiceRow,
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
    .filter(
      (invoice) =>
        invoice.tax_free_total + invoice.vat_amount ===
        Math.abs(transaction.amount),
    )
    .filter((invoice) => {
      const diff = dayDiff(transaction.date, invoice.due_date);
      return diff >= -30 && diff <= 3;
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
