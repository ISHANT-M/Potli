/**
 * The backend's connection to Postgres, composed from the shared db workspace.
 *
 * The pool, schema and profile queries live in code/db (shared with the seed and
 * migration scripts); this module owns the single pool instance the API uses and
 * re-exports what the routes need. Raw SQL stays available for the tables
 * Drizzle does not own (auth.users).
 */
import { createDb, type Database } from '../../db/client.ts';
import { loadProfile as loadProfileFrom } from '../../db/profiles.ts';
import type { Profile } from '../../db/profiles.ts';
import { SUPABASE_DB_URL } from './config.ts';

const connection = createDb(SUPABASE_DB_URL);

export const { pool } = connection;
export const db: Database = connection.db;

/** Raw query escape hatch, for tables outside the Drizzle schema. */
export const query = (text: string, params?: unknown[]) => pool.query(text, params);

export { describeDbError, isDatabaseError } from '../../db/errors.ts';

export const loadProfile = (userId: string): Promise<Profile | null> => loadProfileFrom(db, userId);
