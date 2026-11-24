import { describe, expect, it } from "vitest";
import { dayDiff, findMatch } from "./decide";
import { normalizeLabel } from "./label";

describe("matcher", () => {
  it("normalizes labels", () => {
    expect(normalizeLabel(" SFR ")).toBe("sfr");
  });

  it("computes the difference in days", () => {
    expect(dayDiff("2026-01-31", "2026-01-01")).toBe(30);
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
      date: new Date("2026-06-03"),
    };

    expect(findMatch(transaction, [invoice])).toBe(invoice);
  });
});
