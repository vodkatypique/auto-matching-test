import { describe, expect, it } from "vitest";
import {
  DEFAULT_SIREN,
  formatSummary,
  parseCommandLine,
  UsageError,
} from "./cli";
import type { RunSummary } from "./matching/run";

describe("parseCommandLine", () => {
  it("falls back to the default SIREN, and says so", () => {
    expect(parseCommandLine([])).toEqual({
      siren: DEFAULT_SIREN,
      dryRun: false,
      usedDefaultSiren: true,
    });
  });

  it("reads a SIREN and the dry-run flag", () => {
    expect(parseCommandLine(["812345678", "--dry-run"])).toEqual({
      siren: "812345678",
      dryRun: true,
      usedDefaultSiren: false,
    });
  });

  it.each([
    [["81234567"]],
    [["81234567X"]],
    [["812345678", "900997767"]],
    [["--dryrun"]],
  ])("rejects %j", (args) => {
    expect(() => parseCommandLine(args)).toThrow(UsageError);
  });
});

describe("formatSummary", () => {
  const summary: RunSummary = {
    runId: "run",
    dryRun: true,
    eligible: 5,
    decisions: { matched: 1, ambiguous: 1, contested: 2, no_candidate: 1 },
    written: 1,
    changedMeanwhile: 0,
    withoutAccount: 0,
  };

  it("makes clear that a dry run wrote nothing", () => {
    expect(formatSummary("900997767", summary)).toContain(
      "Nothing was written: 1 match(es) would have been.",
    );
  });
});
