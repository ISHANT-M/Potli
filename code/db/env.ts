/** Load db/.env first, then fall back to backend/.env. */
import { config as loadEnv } from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

for (const file of [path.join(here, '.env'), path.join(here, '..', 'backend', '.env')]) {
  if (fs.existsSync(file)) loadEnv({ path: file, quiet: true });
}

const read = (name: string): string => (process.env[name] ?? '').trim();

export const DATABASE_URL = read('DATABASE_URL');

/** Optional WebSocket endpoint; unset for TCP. */
export const DATABASE_WS_PROXY = read('DATABASE_WS_PROXY');

/** Infrastructure credentials for minting the catcher's JWT. */
export const POTLI_DB_EMAIL = read('POTLI_DB_EMAIL');
export const POTLI_DB_PASSWORD = read('POTLI_DB_PASSWORD');

export const APPWRITE_ENDPOINT = read('APPWRITE_ENDPOINT');
export const APPWRITE_PROJECT_ID = read('APPWRITE_PROJECT_ID');
export const APPWRITE_API_KEY = read('APPWRITE_API_KEY');

export const DEV_SEED_PASSWORD = read('DEV_SEED_PASSWORD') || 'Potli123!';

export const MIGRATIONS_DIR = path.join(here, 'migrations');

export function requireDatabaseUrl(): string {
  if (!DATABASE_URL) {
    console.error('Missing DATABASE_URL in backend/.env.');
    console.error('See backend/.env.example: it points at Potli\'s Postgres, not Appwrite\'s.');
    process.exit(1);
  }
  return DATABASE_URL;
}

export function requireAppwrite(): { endpoint: string; projectId: string; apiKey: string } {
  const missing = [
    ['APPWRITE_ENDPOINT', APPWRITE_ENDPOINT],
    ['APPWRITE_PROJECT_ID', APPWRITE_PROJECT_ID],
    ['APPWRITE_API_KEY', APPWRITE_API_KEY],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0) {
    console.error(`Missing ${missing.join(', ')} in backend/.env.`);
    console.error('The seed creates accounts through the Appwrite API, so it needs those three.');
    process.exit(1);
  }
  return { endpoint: APPWRITE_ENDPOINT, projectId: APPWRITE_PROJECT_ID, apiKey: APPWRITE_API_KEY };
}
