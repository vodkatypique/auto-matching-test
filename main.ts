import { formatSummary, parseCommandLine, USAGE, UsageError } from './src/cli';
import { db } from './src/db/pool';
import { runAutoMatching } from './src/matching/run';

async function main() {
  const { siren, dryRun, usedDefaultSiren } = parseCommandLine(process.argv.slice(2));
  if (usedDefaultSiren) {
    console.warn(`No SIREN given: running for the default company ${siren}.`);
  }
  const summary = await runAutoMatching(db, siren, { dryRun });
  for (const line of formatSummary(siren, summary)) {
    console.log(line);
  }
}

main()
  .catch((error) => {
    if (error instanceof UsageError) {
      console.error(`${error.message}\n${USAGE}`);
      process.exitCode = 2;
    } else {
      console.error(error);
      process.exitCode = 1;
    }
  })
  .finally(() => db.end());
