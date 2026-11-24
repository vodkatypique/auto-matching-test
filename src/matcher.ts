import { db } from "./db/pool";
import { findMatch } from "./matching/decide";
import type { InvoiceRow, TransactionRow } from "./matching/types";

async function getCandidates(companyId: string): Promise<InvoiceRow[]> {
  const { rows } = await db.query(
    `select * from buying_invoice where company_id = '${companyId}'`,
  );
  return rows;
}

export async function runAutoMatching(companySiren: string): Promise<void> {
  const {
    rows: [company],
  } = await db.query(`select * from company where siren = '${companySiren}'`);

  const { rows: transactions } = await db.query<TransactionRow>(
    `select transaction.*
     from transaction
     join account on account.id = transaction.account_id
     where account.company_id = '${company.id}'`,
  );

  let matched = 0;

  for (const transaction of transactions) {
    try {
      const invoice = findMatch(transaction, await getCandidates(company.id));
      if (!invoice) {
        continue;
      }

      await db.query(
        `update transaction set matched_invoice_id = '${invoice.id}' where id = '${transaction.id}'`,
      );
      matched++;
    } catch (e) {
      console.log("skip", e);
    }
  }

  console.log(`Matched ${matched} of ${transactions.length} transactions`);
}
