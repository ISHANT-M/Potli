import 'dotenv/config';

const read = (name: string): string => (process.env[name] ?? '').trim();

export const PORT = Number(read('PORT') || 4000);

// Supabase project (Dashboard -> Project Settings -> API).
export const SUPABASE_URL = read('SUPABASE_URL');
// "anon" / "publishable" key: safe to expose, used to verify user tokens.
export const SUPABASE_ANON_KEY = read('SUPABASE_ANON_KEY') || read('SUPABASE_PUBLISHABLE_KEY');

// Supabase Postgres (session pooler).
export const SUPABASE_DB_URL = read('SUPABASE_DB_URL');

export const DEV_SEED_PASSWORD = read('DEV_SEED_PASSWORD') || 'Potli123!';

export type EnvCheck = [name: string, value: string];

export function requireEnv(checks: EnvCheck[]): void {
  const missing = checks.filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0) {
    console.error(`Missing ${missing.join(', ')} in backend/.env (see backend/.env.example).`);
    process.exit(1);
  }
}

export const SUPABASE_REQUIRED: EnvCheck[] = [
  ['SUPABASE_URL', SUPABASE_URL],
  ['SUPABASE_ANON_KEY', SUPABASE_ANON_KEY],
  ['SUPABASE_DB_URL', SUPABASE_DB_URL],
];
