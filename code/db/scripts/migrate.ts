/**
 * Applies supabase/migrations in filename order.
 *
 * Versions are recorded in supabase_migrations.schema_migrations, the same table
 * the Supabase CLI uses, so `supabase db push` and this script can be used
 * interchangeably.
 *
 * This is TypeScript executed by Node's native type stripping, so the types are
 * erased at load time and `tsc` is what checks them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createDb } from '../client.ts';
import { MIGRATIONS_DIR, SUPABASE_DB_URL, requireDatabaseUrl } from '../env.ts';
import { describeDbError } from '../errors.ts';

const MIGRATION_PATTERN = /^(\d{14})_(.+)\.sql$/;

async function main(): Promise<void> {
  requireDatabaseUrl();
  const { pool } = createDb(SUPABASE_DB_URL);

  try {
    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((file) => MIGRATION_PATTERN.test(file))
      .sort();

    if (files.length === 0) {
      console.log(`no migrations found in ${MIGRATIONS_DIR}`);
      return;
    }

    // Same bookkeeping table the Supabase CLI uses, so one migration history is
    // shared between the CLI and this script.
    await pool.query('create schema if not exists supabase_migrations');
    await pool.query(`create table if not exists supabase_migrations.schema_migrations (
      version text primary key,
      name text,
      statements text[],
      applied_at timestamptz not null default now()
    )`);

    const { rows } = await pool.query<{ version: string }>(
      'select version from supabase_migrations.schema_migrations',
    );
    const applied = new Set(rows.map((row) => row.version));

    let count = 0;
    for (const file of files) {
      const match = MIGRATION_PATTERN.exec(file);
      const version = match?.[1];
      const name = match?.[2];
      if (!version || !name) continue;
      if (applied.has(version)) {
        console.log(`skip    ${file}`);
        continue;
      }

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      const client = await pool.connect();
      try {
        await client.query('begin');
        await client.query(sql);
        await client.query(
          `insert into supabase_migrations.schema_migrations (version, name, statements)
           values ($1, $2, $3)`,
          [version, name, [sql]],
        );
        await client.query('commit');
      } catch (err) {
        await client.query('rollback');
        throw new Error(`${file}: ${describeDbError(err)} (${(err as Error).message})`);
      } finally {
        client.release();
      }
      console.log(`applied ${file}`);
      count += 1;
    }

    console.log(`${count} migration(s) applied to Supabase Postgres`);
  } finally {
    await pool.end();
  }
}

try {
  await main();
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
