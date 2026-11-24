import { parseArgs } from "node:util";
import type { RunSummary } from "./matching/run";

// The original entry point always ran for this company. It stays the default
// so that `npm start` behaves as before, in case the entry point was not ours
// to change. Ideally, a missing SIREN would be an error asking for one.
export const DEFAULT_SIREN = "900997767";

export const USAGE = "Usage: npm start -- [SIREN] [--dry-run]";

export class UsageError extends Error {}

export type CommandLine = {
  siren: string;
  dryRun: boolean;
  usedDefaultSiren: boolean;
};

export function parseCommandLine(args: string[]): CommandLine {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: { "dry-run": { type: "boolean", default: false } },
      allowPositionals: true,
    });
  } catch (error) {
    throw new UsageError((error as Error).message);
  }

  const { values, positionals } = parsed;
  if (positionals.length > 1) {
    throw new UsageError(`Expected one SIREN, got ${positionals.length}`);
  }
  const siren = positionals[0] ?? DEFAULT_SIREN;
  if (!/^\d{9}$/.test(siren)) {
    throw new UsageError(`A SIREN has exactly 9 digits, got "${siren}"`);
  }
  return {
    siren,
    dryRun: values["dry-run"] ?? false,
    usedDefaultSiren: positionals.length === 0,
  };
}

export function formatSummary(siren: string, summary: RunSummary): string[] {
  const { decisions } = summary;
  const lines = [
    `${summary.dryRun ? "Dry run" : "Run"} ${summary.runId} for SIREN ${siren}: ${summary.eligible} eligible transactions`,
    `  ${decisions.matched} matched`,
    `  ${decisions.ambiguous} ambiguous: several invoices fit, nothing tells them apart`,
    `  ${decisions.contested} contested: the same invoice chosen by several transactions`,
    `  ${decisions.no_candidate} without candidate`,
  ];
  if (summary.changedMeanwhile > 0) {
    lines.push(
      `  ${summary.changedMeanwhile} left as they were: changed by someone else during the run`,
    );
  }
  lines.push(
    summary.dryRun
      ? `Nothing was written: ${summary.written} match(es) would have been.`
      : `${summary.written} match(es) written.`,
  );
  if (summary.withoutAccount > 0) {
    lines.push(
      `Warning: ${summary.withoutAccount} transaction(s) belong to no known account: no run can match them.`,
    );
  }
  return lines;
}
