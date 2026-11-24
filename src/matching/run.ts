import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import {
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
    await client.query("commit");

    console.log(
      `Matched ${written} of ${transactions.length} transactions (run ${runId})`,
    );
    if (written < matches.length) {
      console.log(
        `${matches.length - written} left as they were: matched by someone else during the run`,
      );
    }
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
