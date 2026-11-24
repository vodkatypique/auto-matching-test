import * as z from "zod/mini";

// The shape of what each query returns, checked at runtime. node-pg types every
// row as any: without this, a column renamed by a migration or a NULL where
// the code expects text would only show up as a crash, or a wrong result, far
// from the query. The TypeScript types are inferred from these schemas, so the
// type and its check cannot drift apart.

export const CompanyRow = z.object({
  id: z.string(),
});
export type CompanyRow = z.infer<typeof CompanyRow>;

// One row per (transaction, candidate invoice) pair. The invoice columns are
// null when the transaction has no candidate.
export const CandidateRow = z.object({
  transaction_id: z.string(),
  label: z.string(),
  reference: z.nullable(z.string()),
  invoice_id: z.nullable(z.string()),
  supplier_name: z.nullable(z.string()),
  invoice_number: z.nullable(z.string()),
});
export type CandidateRow = z.infer<typeof CandidateRow>;

// Names the transaction in the error: a row index says nothing to whoever has
// to fix the data.
export function parseCandidateRow(row: Record<string, unknown>): CandidateRow {
  const result = CandidateRow.safeParse(row);
  if (!result.success) {
    throw new Error(
      `Unexpected data for transaction ${row.transaction_id}:\n${z.prettifyError(result.error)}`,
    );
  }
  return result.data;
}

export const CountRow = z.object({
  count: z.number(),
});
