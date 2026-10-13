/** Run the cleanup once by hand: `npm run cleanup` (add `-- --dry-run` to only count). */
import 'dotenv/config';
import { createAppwriteAdapter } from './appwrite.ts';
import { runCleanup } from './cleanup.ts';
import { loadConfig } from './config.ts';
import { createDatabase } from './db.ts';

const dryRun = process.argv.includes('--dry-run');
const config = loadConfig();
const appwrite = createAppwriteAdapter(config);
const { db, pool } = await createDatabase(config.databaseUrl);
try {
  const result = await runCleanup({ db, appwrite, config }, { dryRun });
  console.log(`${dryRun ? 'would remove' : 'removed'}: ${result.photosDeleted} photo(s), ${result.accountsDeleted} unverified account(s); ${result.errors} error(s)`);
} finally {
  await pool.end();
}
