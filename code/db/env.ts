/**
 * Connection settings for the db workspace.
 *
 * Credentials stay in the backend's gitignored .env (that is where the rest of
 * the project keeps them); a db/.env can override any of them without copying
 * the others, because the first file loaded wins.
 */
import { config as loadEnv } from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

for (const file of [path.join(here, '.env'), path.join(here, '..', 'backend', '.env')]) {
  if (fs.existsSync(file)) loadEnv({ path: file, quiet: true });
}

const read = (name: string): string => (process.env[name] ?? '').trim();

/** Supabase Postgres is canonical; the pre-Supabase Neon URL is the fallback. */
export const DATABASE_URL = read('SUPABASE_DB_URL') || read('DATABASE_URL');

/** Shared dev password for the seeded accounts. */
export const DEV_SEED_PASSWORD = read('DEV_SEED_PASSWORD') || 'Potli123!';

export const MIGRATIONS_DIR = path.join(here, 'supabase', 'migrations');
export function requireDatabaseUrl(): string {
  if (!DATABASE_URL) {
    console.error('Missing SUPABASE_DB_URL (or DATABASE_URL) in backend/.env.');
    console.error('See backend/.env.example: the value is the Supabase session pooler string.');
    process.exit(1);
  }
  return DATABASE_URL;
}
