import 'dotenv/config';

const read = (name: string): string => (process.env[name] ?? '').trim();

export const PORT = Number(read('PORT') || 4000);

export const APPWRITE_ENDPOINT = read('APPWRITE_ENDPOINT').replace(/\/$/, '');
export const APPWRITE_PROJECT_ID = read('APPWRITE_PROJECT_ID');
export const APPWRITE_API_KEY = read('APPWRITE_API_KEY');

export const DATABASE_URL = read('DATABASE_URL');

export const DEV_SEED_PASSWORD = read('DEV_SEED_PASSWORD') || 'Potli123!';

export type EnvCheck = [name: string, value: string];

export function requireEnv(checks: EnvCheck[]): void {
  const missing = checks.filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0) {
    console.error(`Missing ${missing.join(', ')} in backend/.env (see backend/.env.example).`);
    process.exit(1);
  }
}

export const REQUIRED: EnvCheck[] = [
  ['APPWRITE_ENDPOINT', APPWRITE_ENDPOINT],
  ['APPWRITE_PROJECT_ID', APPWRITE_PROJECT_ID],
  ['DATABASE_URL', DATABASE_URL],
];
