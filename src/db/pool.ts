import { Pool, types } from 'pg';

// Keep DATE columns as 'YYYY-MM-DD' strings. By default node-pg turns them
// into a Date at local midnight, which made day differences depend on the
// machine's time zone.
types.setTypeParser(types.builtins.DATE, (value) => value);

// A query stuck on a lock or a bad plan fails after this delay instead of
// hanging: the run is then rolled back and the process exits with an error.
const STATEMENT_TIMEOUT_MS = 30_000;
const CONNECTION_TIMEOUT_MS = 10_000;

export const db = new Pool({
  host: process.env.PGHOST ?? 'localhost',
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? 'postgres',
  password: process.env.PGPASSWORD ?? 'postgres',
  database: process.env.PGDATABASE ?? 'matching',
  connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
  statement_timeout: STATEMENT_TIMEOUT_MS,
});

// An idle connection can break (database restart, network). Without a
// listener, node-pg's "error" event would crash the process.
db.on('error', (error) => {
  console.error('Idle database connection lost:', error.message);
});
