/** Generate SQL migrations; apply them with scripts/migrate.ts, not drizzle-kit push. */
import { DATABASE_URL } from './env.ts';
import { defineConfig } from 'drizzle-kit';

if (!DATABASE_URL) {
  console.error('Set DATABASE_URL in backend/.env before running drizzle-kit.');
  process.exit(1);
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './schema.ts',
  out: './migrations',
  dbCredentials: { url: DATABASE_URL },
});
