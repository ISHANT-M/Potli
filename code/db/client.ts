/**
 * Shared Postgres access for the db workspace: one place to build the pool and
 * the Drizzle client, so the backend and the db scripts cannot drift apart.
 */
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.ts';

export type Database = NodePgDatabase<typeof schema>;

export function createDb(connectionString: string): { pool: pg.Pool; db: Database } {
  const pool = new pg.Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  // Managed Postgres (Supabase, formerly Neon) suspends idle computes, so pooled
  // clients can drop; without this listener the pool 'error' event is unhandled
  // and takes the whole process down.
  pool.on('error', (err) => console.error('idle database client error:', err.message));

  const db = drizzle(pool, { schema });
  return { pool, db };
}
