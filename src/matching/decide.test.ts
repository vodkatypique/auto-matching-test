import { describe, expect, it } from "vitest";
import { dayDiff, decideMatches, findCandidates } from "./decide";
import type { InvoiceRow, TransactionRow } from "./types";

function invoice(overrides: Partial<InvoiceRow> = {}): InvoiceRow {
  return {
    id: "invoice",
    supplier_name: "Acme",
    invoice_number: "A-1",
    tax_free_total_cents: 10000,
    vat_amount_cents: 2000,
    due_date: "2026-06-10",
    ...overrides,
  };
}

function payment(overrides: Partial<TransactionRow> = {}): TransactionRow {
  return {
    id: "tx",
    amount_cents: -12000,
    label: "VIR ACME",
    reference: null,
    date: "2026-06-10",
    ...overrides,
  };
}

describe("dayDiff", () => {
  it("computes the difference in days", () => {
    expect(dayDiff("2026-01-31", "2026-01-01")).toBe(30);
  });

  it("counts calendar days across leap years and DST changes", () => {
    expect(dayDiff("2028-03-01", "2028-02-28")).toBe(2);
    expect(dayDiff("2026-03-01", "2026-02-28")).toBe(1);
    expect(dayDiff("2026-03-30", "2026-03-29")).toBe(1);
    expect(dayDiff("2026-10-26", "2026-10-25")).toBe(1);
  });
});

describe("findCandidates", () => {
  it("accepts due dates from 3 days before to 30 days after the payment", () => {
    for (const dueDate of ["2026-06-07", "2026-07-10"]) {
      const candidate = invoice({ due_date: dueDate });
      expect(findCandidates(payment(), [candidate])).toEqual([candidate]);
    }
  });

  it("rejects due dates just outside the window", () => {
    for (const dueDate of ["2026-06-06", "2026-07-11"]) {
      expect(findCandidates(payment(), [invoice({ due_date: dueDate })])).toEqual([]);
    }
  });

  it("never keeps an invoice without a due date", () => {
    expect(findCandidates(payment(), [invoice({ due_date: null })])).toEqual([]);
  });

  it("never keeps an invoice for an incoming payment, even of the same amount", () => {
    expect(findCandidates(payment({ amount_cents: 12000 }), [invoice()])).toEqual([]);
  });

  it("never keeps an invoice the label does not designate", () => {
    expect(findCandidates(payment({ label: "VIR DUPONT" }), [invoice()])).toEqual([]);
  });

  it("keeps an invoice whose total is exact in cents but not in floats", () => {
    const candidate = invoice({
      supplier_name: "Cabinet Bernard Conseil",
      tax_free_total_cents: 51283,
      vat_amount_cents: 10257,
      due_date: "2026-06-01",
    });
    const transaction = payment({
      amount_cents: -61540,
      label: "VIR SEPA CABINET BERNARD CONSEIL",
      date: "2026-06-03",
    });

    expect(findCandidates(transaction, [candidate])).toEqual([candidate]);
  });
});

describe("decideMatches", () => {
  const june = invoice({ id: "june", invoice_number: "F-06", due_date: "2026-06-10" });
  const july = invoice({ id: "july", invoice_number: "F-07", due_date: "2026-07-01" });

  it("matches the only invoice the label designates", () => {
    expect(decideMatches([payment()], [june])).toEqual([
      { transactionId: "tx", outcome: "matched", invoiceId: "june" },
    ]);
  });

  it("reports when no invoice qualifies", () => {
    expect(decideMatches([payment({ label: "VIR DUPONT" })], [june])).toEqual([
      { transactionId: "tx", outcome: "no_candidate" },
    ]);
  });

  it("does not guess between invoices of the same supplier and amount", () => {
    expect(decideMatches([payment()], [june, july])).toEqual([
      { transactionId: "tx", outcome: "ambiguous" },
    ]);
  });

  it("matches the invoice whose number the label cites", () => {
    const citingJuly = payment({ label: "PRLV ACME F-07" });
    expect(decideMatches([citingJuly], [june, july])).toEqual([
      { transactionId: "tx", outcome: "matched", invoiceId: "july" },
    ]);
  });

  it("leaves both transactions unmatched when they claim the same invoice", () => {
    const imported = payment({ id: "imported" });
    const importedTwice = payment({ id: "imported-twice" });
    expect(decideMatches([imported, importedTwice], [june])).toEqual([
      { transactionId: "imported", outcome: "contested" },
      { transactionId: "imported-twice", outcome: "contested" },
    ]);
  });

  it("does not depend on the order of the transactions", () => {
    const transactions = [
      payment({ id: "a" }),
      payment({ id: "b", label: "PRLV ACME F-07" }),
      payment({ id: "c", label: "VIR DUPONT" }),
    ];
    const byId = (decisions: ReturnType<typeof decideMatches>) =>
      [...decisions].sort((x, y) => x.transactionId.localeCompare(y.transactionId));

    expect(byId(decideMatches([...transactions].reverse(), [june, july]))).toEqual(
      byId(decideMatches(transactions, [june, july])),
    );
  });
});
