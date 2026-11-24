import { db } from "../db/pool";
import {
  getCompanyBySiren,
  getEligibleInvoices,
  getEligibleTransactions,
  setMatchedInvoice,
} from "../db/queries";
import { findMatch } from "./decide";
import {
  ELIGIBLE_INVOICE_STATUSES,
  ELIGIBLE_TRANSACTION_STATUS,
} from "./rules";

export async function runAutoMatching(companySiren: string): Promise<void> {
  const company = await getCompanyBySiren(db, companySiren);
  const transactions = await getEligibleTransactions(
    db,
    company.id,
    ELIGIBLE_TRANSACTION_STATUS,
  );
  const invoices = await getEligibleInvoices(
    db,
    company.id,
    ELIGIBLE_INVOICE_STATUSES,
  );

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
