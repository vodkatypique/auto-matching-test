import type { Pool } from "pg";
import type { InvoiceRow, TransactionRow } from "../matching/types";

export type Db = Pick<Pool, "query">;

export async function getCompanyBySiren(db: Db, siren: string) {
  const {
    rows: [company],
  } = await db.query("select * from company where siren = $1", [siren]);
  return company;
}

export async function getCompanyTransactions(
  db: Db,
  companyId: string,
): Promise<TransactionRow[]> {
  const { rows } = await db.query<TransactionRow>(
    `select transaction.*
     from transaction
     join account on account.id = transaction.account_id
     where account.company_id = $1`,
    [companyId],
  );
  return rows;
}

export async function getCompanyInvoices(
  db: Db,
  companyId: string,
): Promise<InvoiceRow[]> {
  const { rows } = await db.query(
    "select * from buying_invoice where company_id = $1",
    [companyId],
  );
  return rows;
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
