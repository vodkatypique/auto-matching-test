import { describe, expect, it } from "vitest";
import { decideMatches } from "./decide";
import type { InvoiceRow, TransactionRow } from "./types";

function invoice(overrides: Partial<InvoiceRow> = {}): InvoiceRow {
  return {
    id: "invoice",
    supplier_name: "Acme",
    invoice_number: "A-1",
    ...overrides,
  };
}

function payment(overrides: Partial<TransactionRow> = {}): TransactionRow {
  return { id: "tx", label: "VIR ACME", reference: null, ...overrides };
}

describe("decideMatches", () => {
  const june = invoice({ id: "june", invoice_number: "F-06" });
  const july = invoice({ id: "july", invoice_number: "F-07" });

  it("matches the only candidate the label designates", () => {
    expect(
      decideMatches([{ transaction: payment(), candidates: [june] }]),
    ).toEqual([{ transactionId: "tx", outcome: "matched", invoiceId: "june" }]);
  });

  it("reports a transaction without candidates", () => {
    expect(
      decideMatches([{ transaction: payment(), candidates: [] }]),
    ).toEqual([{ transactionId: "tx", outcome: "no_candidate" }]);
  });

  it("ignores candidates the label does not designate", () => {
    const transaction = payment({ label: "VIR DUPONT" });
    expect(decideMatches([{ transaction, candidates: [june] }])).toEqual([
      { transactionId: "tx", outcome: "no_candidate" },
    ]);
  });

  it("does not guess between invoices of the same supplier", () => {
    expect(
      decideMatches([{ transaction: payment(), candidates: [june, july] }]),
    ).toEqual([{ transactionId: "tx", outcome: "ambiguous" }]);
  });

  it("matches the invoice whose number the label cites", () => {
    const transaction = payment({ label: "PRLV ACME F-07" });
    expect(decideMatches([{ transaction, candidates: [june, july] }])).toEqual([
      { transactionId: "tx", outcome: "matched", invoiceId: "july" },
    ]);
  });

  it("leaves both transactions unmatched when they claim the same invoice", () => {
    expect(
      decideMatches([
        { transaction: payment({ id: "imported" }), candidates: [june] },
        { transaction: payment({ id: "imported-twice" }), candidates: [june] },
      ]),
    ).toEqual([
      { transactionId: "imported", outcome: "contested" },
      { transactionId: "imported-twice", outcome: "contested" },
    ]);
  });

  it("does not depend on the order of the transactions", () => {
    const transactions = [
      { transaction: payment({ id: "a" }), candidates: [june, july] },
      {
        transaction: payment({ id: "b", label: "PRLV ACME F-07" }),
        candidates: [june, july],
      },
      { transaction: payment({ id: "c", label: "VIR DUPONT" }), candidates: [june] },
    ];
    const byId = (decisions: ReturnType<typeof decideMatches>) =>
      [...decisions].sort((x, y) => x.transactionId.localeCompare(y.transactionId));

    expect(byId(decideMatches([...transactions].reverse()))).toEqual(
      byId(decideMatches(transactions)),
    );
  });
});
