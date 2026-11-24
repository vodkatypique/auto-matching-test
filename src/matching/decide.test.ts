import { describe, expect, it } from "vitest";
import { dayDiff, findMatch } from "./decide";
import type { InvoiceRow, TransactionRow } from "./types";

function invoiceDue(dueDate: string | null): InvoiceRow {
  return {
    id: `invoice-${dueDate}`,
    supplier_name: "Acme",
    invoice_number: "A-1",
    tax_free_total_cents: 10000,
    vat_amount_cents: 2000,
    due_date: dueDate,
  };
}

const paymentOnJune10: TransactionRow = {
  id: "tx",
  amount_cents: -12000,
  label: "VIR ACME",
  reference: null,
  date: "2026-06-10",
};

describe("matcher", () => {
  it("computes the difference in days", () => {
    expect(dayDiff("2026-01-31", "2026-01-01")).toBe(30);
  });

  it("counts calendar days across leap years and DST changes", () => {
    expect(dayDiff("2028-03-01", "2028-02-28")).toBe(2);
    expect(dayDiff("2026-03-01", "2026-02-28")).toBe(1);
    expect(dayDiff("2026-03-30", "2026-03-29")).toBe(1);
    expect(dayDiff("2026-10-26", "2026-10-25")).toBe(1);
  });

  it("accepts due dates from 3 days before to 30 days after the payment", () => {
    for (const dueDate of ["2026-06-07", "2026-07-10"]) {
      const invoice = invoiceDue(dueDate);
      expect(findMatch(paymentOnJune10, [invoice])).toBe(invoice);
    }
  });

  it("rejects due dates just outside the window", () => {
    for (const dueDate of ["2026-06-06", "2026-07-11"]) {
      expect(findMatch(paymentOnJune10, [invoiceDue(dueDate)])).toBeNull();
    }
  });

  it("never matches an invoice without a due date", () => {
    expect(findMatch(paymentOnJune10, [invoiceDue(null)])).toBeNull();
  });

  it("never matches an incoming payment, even of the same amount", () => {
    const credit = { ...paymentOnJune10, amount_cents: 12000 };
    expect(findMatch(credit, [invoiceDue("2026-06-10")])).toBeNull();
  });

  it("never matches an invoice the label does not designate", () => {
    const otherSupplier = { ...paymentOnJune10, label: "VIR DUPONT" };
    expect(findMatch(otherSupplier, [invoiceDue("2026-06-10")])).toBeNull();
  });

  it("matches an invoice whose total is exact in cents but not in floats", () => {
    const invoice = {
      id: "f0000003",
      supplier_name: "Cabinet Bernard Conseil",
      invoice_number: "CBC-117",
      tax_free_total_cents: 51283,
      vat_amount_cents: 10257,
      due_date: "2026-06-01",
    };
    const transaction = {
      id: "e0000003",
      amount_cents: -61540,
      label: "VIR SEPA CABINET BERNARD CONSEIL",
      reference: null,
      date: "2026-06-03",
    };

    expect(findMatch(transaction, [invoice])).toBe(invoice);
  });
});
