import { Pool, types } from 'pg';

// Keep DATE columns as 'YYYY-MM-DD' strings. By default node-pg turns them
// into a Date at local midnight, which made day differences depend on the
// machine's time zone.
types.setTypeParser(types.builtins.DATE, (value) => value);

export const db = new Pool({
  host: process.env.PGHOST ?? 'localhost',
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? 'postgres',
  password: process.env.PGPASSWORD ?? 'postgres',
  database: process.env.PGDATABASE ?? 'matching',
});
