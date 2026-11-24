import type { Pool } from "pg";
import * as z from "zod/mini";
import type {
  CandidateRules,
  Match,
  TransactionCandidates,
} from "../matching/types";
import { CompanyRow, CountRow, parseCandidateRow } from "./rows";

export type Db = Pick<Pool, "query">;

export async function getCompanyBySiren(
  db: Db,
  siren: string,
): Promise<CompanyRow | undefined> {
  const { rows } = await db.query("select id from company where siren = $1", [
    siren,
  ]);
  return z.array(CompanyRow).parse(rows)[0];
}

// Every eligible transaction of the company, with the invoices it could pay:
// same exact amount, due date within the window. Postgres compares numeric
// amounts and calendar dates exactly, so no float or time zone issue here.
export async function getMatchCandidates(
  db: Db,
  companyId: string,
  rules: CandidateRules,
): Promise<TransactionCandidates[]> {
  // I checked the plan with EXPLAIN ANALYZE on the seed: with up-to-date
  // statistics (see scripts/reset.ts), Postgres runs the NOT EXISTS below as
  // a single anti-join, not one subquery per invoice. It reads each table
  // once, like a LEFT JOIN ... IS NULL would, in about the same time (10 to
  // 15 ms for the anti-join alone, on 35k invoices). So no performance
  // concern a priori, and it states the intent more directly: no transaction
  // points to this invoice.
  const { rows } = await db.query(
    `with eligible_transactions as (
       select transaction.*
       from transaction
       join account on account.id = transaction.account_id
       where account.company_id = $1
         and transaction.amount < 0 -- outgoing payments only
         and transaction.status = $2
         and transaction.deleted_at is null
         and transaction.matched_invoice_id is null
         -- Never touch a transaction a user worked on: once they undo a
         -- match, it must not come back. "is distinct from" keeps the rows
         -- where match_source is null, which "<>" would drop.
         and transaction.match_source is distinct from 'manual'
     ),
     eligible_invoices as (
       select *
       from buying_invoice
       where company_id = $1
         and deleted_at is null
         and invoice_status = any($3)
         and not exists ( -- already matched to a transaction
           select 1
           from transaction
           where transaction.matched_invoice_id = buying_invoice.id
             and transaction.deleted_at is null
         )
     )
     select t.id as transaction_id, t.label, t.reference,
            i.id as invoice_id, i.supplier_name, i.invoice_number
     from eligible_transactions t
     left join eligible_invoices i -- keeps transactions without candidates
       on i.tax_free_total + i.vat_amount = -t.amount
      and i.due_date between t.date - $4::int and t.date + $5::int
     order by t.id, i.id`,
    [
      companyId,
      rules.transactionStatus,
      rules.invoiceStatuses,
      rules.maxDaysDueBeforePayment,
      rules.maxDaysDueAfterPayment,
    ],
  );

  const byTransaction = new Map<string, TransactionCandidates>();
  for (const row of rows.map(parseCandidateRow)) {
    let entry = byTransaction.get(row.transaction_id);
    if (entry === undefined) {
      entry = {
        transaction: {
          id: row.transaction_id,
          // Without a label, nothing can designate an invoice: the
          // transaction just stays unmatched, instead of failing the run.
          label: row.label ?? "",
          reference: row.reference,
        },
        candidates: [],
      };
      byTransaction.set(row.transaction_id, entry);
    }
    if (row.invoice_id !== null) {
      entry.candidates.push({
        id: row.invoice_id,
        supplier_name: row.supplier_name,
        invoice_number: row.invoice_number,
      });
    }
  }
  return [...byTransaction.values()];
}

// Transactions whose account does not exist belong to no company: no run can
// ever match them. There is no foreign key to prevent it, so they are counted
// to be reported instead of disappearing silently.
export async function countTransactionsWithoutAccount(db: Db): Promise<number> {
  const { rows } = await db.query(
    `select count(*)::int as count
     from transaction
     where not exists (
       select 1 from account where account.id = transaction.account_id
     )`,
  );
  return CountRow.parse(rows[0]).count;
}

// Writes all the matches of a run in one statement. The guards skip a
// transaction that someone matched, or that a user worked on, since it was
// read, instead of overwriting their choice. Returns how many were written.
export async function recordMatches(
  db: Db,
  runId: string,
  matches: Match[],
): Promise<number> {
  const { rowCount } = await db.query(
    `update transaction
     set matched_invoice_id = m.invoice_id,
         match_source = 'auto',
         matched_at = now(),
         match_run_id = $3
     from unnest($1::uuid[], $2::uuid[]) as m(transaction_id, invoice_id)
     where transaction.id = m.transaction_id
       and transaction.matched_invoice_id is null
       and transaction.match_source is distinct from 'manual'
       and transaction.deleted_at is null`,
    [
      matches.map((match) => match.transactionId),
      matches.map((match) => match.invoiceId),
      runId,
    ],
  );
  return rowCount ?? 0;
}
