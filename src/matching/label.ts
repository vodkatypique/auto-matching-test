// Legal forms and filler words: they say nothing about who the supplier is.
const NON_DISTINCTIVE_WORDS = new Set([
  "sa",
  "sas",
  "sasu",
  "sarl",
  "eurl",
  "sci",
  "snc",
  "france",
  "de",
  "des",
  "du",
  "la",
  "le",
  "les",
  "et",
]);

// Lower case, accents removed, and anything that is not a letter or a digit
// turned into a separator: "Bureau Vallée" and "BUREAU VALLEE" give the same
// words.
export function words(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0);
}

// The supplier is named when every distinctive word of its name is a whole
// word of the label ("sfr" is not found in "sfri"), or when the label writes
// the name as one word ("TOTALENERGIES" for "Total Energies").
// A missing name, or one made only of generic words, is never evidence.
export function labelNamesSupplier(
  label: string,
  supplierName: string | null,
): boolean {
  if (supplierName === null) {
    return false;
  }
  const distinctiveWords = words(supplierName).filter(
    (word) => !NON_DISTINCTIVE_WORDS.has(word),
  );
  if (distinctiveWords.length === 0) {
    return false;
  }
  const labelWords = new Set(words(label));
  return (
    distinctiveWords.every((word) => labelWords.has(word)) ||
    labelWords.has(distinctiveWords.join(""))
  );
}

// The invoice number is cited when it is a whole word of the label, or the
// transaction reference itself. An empty number is never evidence.
export function citesInvoiceNumber(
  label: string,
  reference: string | null,
  invoiceNumber: string | null,
): boolean {
  const number = invoiceNumber?.trim().toLowerCase();
  if (!number) {
    return false;
  }
  const labelTokens = label.toLowerCase().split(/\s+/);
  return (
    labelTokens.includes(number) ||
    reference?.trim().toLowerCase() === number
  );
}
