/**
 * drizzle-kit config. Runs from the db workspace:
 *
 *   npm run generate -- --name <change>   # writes supabase/migrations/<timestamp>_<name>.sql
 *   cd ../backend && npm run db:migrate   # applies it and records the version
 *
 * `drizzle-kit push` is deliberately not used: it diffs against the live
 * database and would try to manage Supabase's own auth schema.
 */
import { defineConfig } from 'drizzle-kit';
import { SUPABASE_DB_URL } from './env.ts';

if (!SUPABASE_DB_URL) {
  console.error('Set SUPABASE_DB_URL in backend/.env before running drizzle-kit.');
  process.exit(1);
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './schema.ts',
  out: './supabase/migrations',
  migrations: { prefix: 'supabase' },
  tablesFilter: ['!auth.*'],
  dbCredentials: { url: SUPABASE_DB_URL },
});
