import { db } from "../db/pool";
import {
  getCompanyBySiren,
  getEligibleInvoices,
  getEligibleTransactions,
  setMatchedInvoice,
} from "../db/queries";
import { decideMatches } from "./decide";
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

  const decisions = decideMatches(transactions, invoices);

  let matched = 0;

  for (const decision of decisions) {
    if (decision.outcome !== "matched") {
      continue;
    }
    try {
      await setMatchedInvoice(db, decision.transactionId, decision.invoiceId);
      matched++;
    } catch (e) {
      console.log("skip", e);
    }
  }

  console.log(`Matched ${matched} of ${transactions.length} transactions`);
}
