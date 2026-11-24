// Note for reviewers: amounts are compared as integer cents.
// The original code summed two floats and compared them with ===, which
// fails for about one invoice in five (512.83 + 102.57 === 615.4000000000001)
// The columns are now numeric(12,2), which is exact, and node-pg returns
// numeric as a string to avoid losing precision. We convert it to integer
// cents right here, at the database boundary, so the matching logic only
// ever does integer arithmetic. Math.round(Number(v) * CENTS_PER_EURO) is
// exact for every numeric(12,2) value: the largest one is 10^12 cents, far
// below 2^53.
const CENTS_PER_EURO = 100;

export function numericToCents(value: string): number {
  return Math.round(Number(value) * CENTS_PER_EURO);
}
