import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import {
  countTransactionsWithoutAccount,
  getCompanyBySiren,
  getMatchCandidates,
  recordMatches,
} from "../db/queries";
import { decideMatches } from "./decide";
import { CANDIDATE_RULES } from "./rules";
import type { Match, MatchDecision } from "./types";

export type RunOptions = {
  dryRun?: boolean;
};

export type RunSummary = {
  runId: string;
  dryRun: boolean;
  eligible: number;
  decisions: Record<MatchDecision["outcome"], number>;
  // In a dry run, how many would have been written.
  written: number;
  // Matched, or handled by a user, by someone else during the run.
  changedMeanwhile: number;
  withoutAccount: number;
};

function countByOutcome(
  decisions: MatchDecision[],
): RunSummary["decisions"] {
  const counts = { matched: 0, no_candidate: 0, ambiguous: 0, contested: 0 };
  for (const decision of decisions) {
    counts[decision.outcome]++;
  }
  return counts;
}

// One database transaction per run: either every match of the run is
// written, or none is. The run id is stored on each match, so that a bad run
// can be listed and reverted.
export async function runAutoMatching(
  pool: Pool,
  companySiren: string,
  { dryRun = false }: RunOptions = {},
): Promise<RunSummary> {
  const client = await pool.connect();
  // A connection that breaks while checked out emits "error": without a
  // listener, node-pg would crash the process. The failing query still
  // rejects, so the run is rolled back below.
  const onConnectionError = (error: Error) => {
    console.error("Database connection lost during the run:", error.message);
  };
  client.on("error", onConnectionError);

  try {
    await client.query("begin");

    const company = await getCompanyBySiren(client, companySiren);
    if (company === undefined) {
      throw new Error(`No company with SIREN ${companySiren}`);
    }
    const transactions = await getMatchCandidates(
      client,
      company.id,
      CANDIDATE_RULES,
    );
    const decisions = decideMatches(transactions);
    const matches = decisions.filter(
      (decision): decision is Match => decision.outcome === "matched",
    );

    const runId = randomUUID();
    const written = await recordMatches(client, runId, matches);
    const withoutAccount = await countTransactionsWithoutAccount(client);
    // A dry run goes through exactly the same steps, writes included, so that
    // its numbers are the real ones. Then it rolls everything back.
    await client.query(dryRun ? "rollback" : "commit");

    return {
      runId,
      dryRun,
      eligible: transactions.length,
      decisions: countByOutcome(decisions),
      written,
      changedMeanwhile: matches.length - written,
      withoutAccount,
    };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw new Error(
      `Run for SIREN ${companySiren} rolled back, nothing was written: ${(error as Error).message}`,
      { cause: error },
    );
  } finally {
    client.off("error", onConnectionError);
    client.release();
  }
}
