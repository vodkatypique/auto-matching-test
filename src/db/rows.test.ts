import { describe, expect, it } from "vitest";
import { CandidateRow } from "./rows";

describe("CandidateRow", () => {
  const row = {
    transaction_id: "tx",
    label: "PRLV SEPA ORANGE",
    reference: null,
    invoice_id: null,
    supplier_name: null,
    invoice_number: null,
  };

  it("accepts a transaction without candidate", () => {
    expect(CandidateRow.parse(row)).toEqual(row);
  });

  it("rejects a row that no longer has the expected shape", () => {
    const { label: _label, ...withoutLabel } = row;
    expect(() => CandidateRow.parse(withoutLabel)).toThrow();
    expect(() => CandidateRow.parse({ ...row, label: null })).toThrow();
  });
});
