import { db } from './src/db/pool';
import { runAutoMatching } from './src/matching/run';

async function main() {
  await runAutoMatching('900997767');
  await db.end();
}

main().catch(async (e) => {
  console.error(e);
  await db.end();
  process.exit(1);
});
