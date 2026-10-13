/** Test database handle with a hard guard against ever touching a non-test database. */
import { createDb, type Database, type DbPool } from '../../db/client.ts';

export function assertTestDatabase(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('DATABASE_URL is not set for tests.');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  const testName = parsed.pathname.replace('/', '').endsWith('_test');
  if (!local || !testName) {
    throw new Error('Refusing to run tests: DATABASE_URL must point at a local database whose name ends in _test.');
  }
}

let handle: { pool: DbPool; db: Database } | null = null;

export function testDb(): { pool: DbPool; db: Database } {
  if (!handle) {
    const url = process.env.DATABASE_URL ?? '';
    assertTestDatabase(url);
    handle = createDb(url);
  }
  return handle;
}

export async function truncateAll(): Promise<void> {
  const { pool } = testDb();
  const { rows } = await pool.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public' and tablename <> 'migrations'",
  );
  if (rows.length === 0) return;
  const names = rows.map((row) => `"${row.tablename}"`).join(', ');
  await pool.query(`truncate table ${names} restart identity cascade`);
}

export async function closeTestDb(): Promise<void> {
  if (handle) {
    await handle.pool.end();
    handle = null;
  }
}
