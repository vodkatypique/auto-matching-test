import type { Pool } from "pg";
import type {
  InvoiceRow,
  InvoiceStatus,
  TransactionRow,
  TransactionStatus,
} from "../matching/types";
import { numericToCents } from "./money";

export type Db = Pick<Pool, "query">;

export async function getCompanyBySiren(db: Db, siren: string) {
  const {
    rows: [company],
  } = await db.query("select * from company where siren = $1", [siren]);
  return company;
}

export async function getEligibleTransactions(
  db: Db,
  companyId: string,
  status: TransactionStatus,
): Promise<TransactionRow[]> {
  const { rows } = await db.query(
    `select transaction.*
     from transaction
     join account on account.id = transaction.account_id
     where account.company_id = $1
       and transaction.amount < 0 -- outgoing payments only
       and transaction.status = $2
       and transaction.deleted_at is null
       and transaction.matched_invoice_id is null`,
    [companyId, status],
  );
  return rows.map(({ amount, ...row }) => ({
    ...row,
    amount_cents: numericToCents(amount),
  }));
}

export async function getEligibleInvoices(
  db: Db,
  companyId: string,
  statuses: InvoiceStatus[],
): Promise<InvoiceRow[]> {
  // I checked the plan with EXPLAIN ANALYZE on the seed: Postgres runs the
  // NOT EXISTS below as a single anti-join, not one subquery per invoice. It
  // reads each table once, like a LEFT JOIN ... IS NULL would, in about the
  // same time (10 to 15 ms for 35k invoices). So no performance concern a
  // priori, and it states the intent more directly: no transaction points to
  // this invoice.
  const { rows } = await db.query(
    `select *
     from buying_invoice
     where company_id = $1
       and deleted_at is null
       and invoice_status = any($2)
       and not exists ( -- already matched to a transaction
         select 1
         from transaction
         where transaction.matched_invoice_id = buying_invoice.id
           and transaction.deleted_at is null
       )`,
    [companyId, statuses],
  );
  return rows.map(({ tax_free_total, vat_amount, ...row }) => ({
    ...row,
    tax_free_total_cents: numericToCents(tax_free_total),
    vat_amount_cents: numericToCents(vat_amount),
  }));
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
