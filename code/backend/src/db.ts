/** The API's shared database pool and profile queries. */
import { createDbWithToken, type Database } from '../../db/client.ts';
import { ensureProfile as ensureProfileRow, loadProfile as loadProfileFrom } from '../../db/profiles.ts';
import type { Profile, ProfileInput } from '../../db/profiles.ts';
import { DATABASE_URL } from './config.ts';

const connection = await createDbWithToken(DATABASE_URL);

export const { pool } = connection;
export const db: Database = connection.db;

export const query = (text: string, params?: unknown[]) => pool.query(text, params);

export { describeDbError, isDatabaseError } from '../../db/errors.ts';

export const loadProfile = (appwriteUserId: string): Promise<Profile | null> =>
  loadProfileFrom(db, appwriteUserId);

export const ensureProfile = (input: ProfileInput): Promise<Profile> => ensureProfileRow(db, input);
