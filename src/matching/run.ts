import { db } from "../db/pool";
import {
  getCompanyBySiren,
  getMatchCandidates,
  setMatchedInvoice,
} from "../db/queries";
import { decideMatches } from "./decide";
import { CANDIDATE_RULES } from "./rules";

export async function runAutoMatching(companySiren: string): Promise<void> {
  const company = await getCompanyBySiren(db, companySiren);
  const transactions = await getMatchCandidates(
    db,
    company.id,
    CANDIDATE_RULES,
  );
  const decisions = decideMatches(transactions);

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
