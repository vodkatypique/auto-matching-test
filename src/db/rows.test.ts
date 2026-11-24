import { describe, expect, it } from "vitest";
import { CandidateRow, parseCandidateRow } from "./rows";

describe("CandidateRow", () => {
  const row = {
    transaction_id: "tx",
    label: "PRLV SEPA ORANGE",
    reference: null,
    invoice_id: null,
    supplier_name: null,
    invoice_number: null,
  };

  it("accepts a transaction without candidate, or without label", () => {
    expect(CandidateRow.parse(row)).toEqual(row);
    expect(CandidateRow.parse({ ...row, label: null })).toEqual({
      ...row,
      label: null,
    });
  });

  it("rejects a row that no longer has the expected shape", () => {
    const { label: _label, ...withoutLabel } = row;
    expect(() => CandidateRow.parse(withoutLabel)).toThrow();
    expect(() => CandidateRow.parse({ ...row, label: 42 })).toThrow();
  });

  it("names the transaction and the column in the error", () => {
    expect(() => parseCandidateRow({ ...row, label: 42 })).toThrow(
      /transaction tx[\s\S]*label/,
    );
  });
});
