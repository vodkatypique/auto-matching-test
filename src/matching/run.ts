import { db } from "../db/pool";
import {
  getCompanyBySiren,
  getCompanyInvoices,
  getCompanyTransactions,
  setMatchedInvoice,
} from "../db/queries";
import { findMatch } from "./decide";

export async function runAutoMatching(companySiren: string): Promise<void> {
  const company = await getCompanyBySiren(db, companySiren);
  const transactions = await getCompanyTransactions(db, company.id);
  const invoices = await getCompanyInvoices(db, company.id);

  let matched = 0;

  for (const transaction of transactions) {
    try {
      const invoice = findMatch(transaction, invoices);
      if (!invoice) {
        continue;
      }

      await setMatchedInvoice(db, transaction.id, invoice.id);
      matched++;
    } catch (e) {
      console.log("skip", e);
    }
  }

  console.log(`Matched ${matched} of ${transactions.length} transactions`);
}
