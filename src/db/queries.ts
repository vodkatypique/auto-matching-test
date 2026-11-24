import type { Pool } from "pg";
import type {
  CandidateRules,
  TransactionCandidates,
} from "../matching/types";

export type Db = Pick<Pool, "query">;

export async function getCompanyBySiren(db: Db, siren: string) {
  const {
    rows: [company],
  } = await db.query("select * from company where siren = $1", [siren]);
  return company;
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
  for (const row of rows) {
    let entry = byTransaction.get(row.transaction_id);
    if (entry === undefined) {
      entry = {
        transaction: {
          id: row.transaction_id,
          label: row.label,
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

export async function setMatchedInvoice(
  db: Db,
  transactionId: string,
  invoiceId: string,
): Promise<void> {
  await db.query(
    "update transaction set matched_invoice_id = $1 where id = $2",
    [invoiceId, transactionId],
  );
}
