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
import type { Match } from "./types";

// One database transaction per run: either every match of the run is
// written, or none is. The run id is stored on each match, so that a bad run
// can be listed and reverted.
export async function runAutoMatching(
  pool: Pool,
  companySiren: string,
): Promise<void> {
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
    const matches = decideMatches(transactions).filter(
      (decision): decision is Match => decision.outcome === "matched",
    );

    const runId = randomUUID();
    const written = await recordMatches(client, runId, matches);
    const withoutAccount = await countTransactionsWithoutAccount(client);
    await client.query("commit");

    console.log(
      `Matched ${written} of ${transactions.length} transactions (run ${runId})`,
    );
    if (written < matches.length) {
      console.log(
        `${matches.length - written} left as they were: matched by someone else during the run`,
      );
    }
    if (withoutAccount > 0) {
      console.warn(
        `${withoutAccount} transaction(s) belong to no known account: no run can match them`,
      );
    }
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
