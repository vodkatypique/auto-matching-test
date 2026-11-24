import { describe, expect, it } from "vitest";
import { citesInvoiceNumber, labelNamesSupplier, words } from "./label";

describe("words", () => {
  it("ignores case, accents and punctuation", () => {
    expect(words(" Bureau Vallée ")).toEqual(["bureau", "vallee"]);
    expect(words("Metro Cash & Carry")).toEqual(["metro", "cash", "carry"]);
  });
});

describe("labelNamesSupplier", () => {
  it.each([
    ["PRLV SEPA ORANGE SA F-2026-00016", "Orange", true],
    ["VIR SEPA CABINET BERNARD CONSEIL", "Cabinet Bernard Conseil", true],
    ["VIR LOYER SCI DES LILAS", "SCI des Lilas", true],
    ["CB TOTALENERGIES STATION", "Total Energies", true],
    ["PRLV SEPA SAGE", "Sage SAS", true],
    ["VIR TRANSFERT SFRI SARL", "SFRI SARL", true],
    ["VIR TRANSFERT SFRI SARL", "SFR", false],
    ["CB LEROY MERLIN PRO", "Free Pro", false],
    ["VIR RECU CLIENT DUPONT", "Imprimerie Dupont", false],
    ["CB AUBERGE DU PORT", "Uber", false],
  ])("%s names %s: %s", (label, supplierName, expected) => {
    expect(labelNamesSupplier(label, supplierName)).toBe(expected);
  });

  it("never treats a missing or generic name as evidence", () => {
    expect(labelNamesSupplier("PRLV SEPA ASSURANCE", null)).toBe(false);
    expect(labelNamesSupplier("VIR SAS FRANCE", "SAS France")).toBe(false);
  });
});

describe("citesInvoiceNumber", () => {
  it("finds the number as a whole word of the label", () => {
    expect(
      citesInvoiceNumber("PRLV SEPA ORANGE SA F-2026-00016", null, "F-2026-00016"),
    ).toBe(true);
    expect(
      citesInvoiceNumber("PRLV SEPA ORANGE SA F-2026-000161", null, "F-2026-00016"),
    ).toBe(false);
  });

  it("accepts the transaction reference", () => {
    expect(citesInvoiceNumber("PRLV SEPA ORANGE", "F-2026-00016", "F-2026-00016")).toBe(true);
  });

  it("never treats an empty or missing number as evidence", () => {
    expect(citesInvoiceNumber("PRLV SEPA SAGE", "", "")).toBe(false);
    expect(citesInvoiceNumber("PRLV SEPA SAGE", null, null)).toBe(false);
  });
});
