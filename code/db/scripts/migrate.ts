/** Apply SQL files in filename order; record each migration in the same transaction. */
import fs from 'node:fs';
import path from 'node:path';
import { createDbWithToken } from '../client.ts';
import { DATABASE_URL, MIGRATIONS_DIR, requireDatabaseUrl } from '../env.ts';
import { describeDbError } from '../errors.ts';

const MIGRATION_EXTENSION = '.sql';

async function main(): Promise<void> {
  requireDatabaseUrl();
  const { pool } = await createDbWithToken(DATABASE_URL);

  try {
    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((file) => file.endsWith(MIGRATION_EXTENSION))
      .sort();

    if (files.length === 0) {
      console.log(`no migrations found in ${MIGRATIONS_DIR}`);
      return;
    }

    await pool.query(`create table if not exists migrations (
      version text primary key,
      name text,
      applied_at timestamptz not null default now()
    )`);

    const { rows } = await pool.query<{ version: string }>('select version from migrations');
    const applied = new Set(rows.map((row) => row.version));

    let count = 0;
    for (const file of files) {
      const version = file.slice(0, -MIGRATION_EXTENSION.length);
      if (applied.has(version)) {
        console.log(`skip    ${file}`);
        continue;
      }

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      const client = await pool.connect();
      try {
        await client.query('begin');
        await client.query(sql);
        await client.query('insert into migrations (version, name) values ($1, $2)', [version, file]);
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

    console.log(`${count} migration(s) applied`);
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
