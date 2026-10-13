/** Database factory; nothing connects at import time so the app can be built with an injected database. */
import { createDbWithToken, type DbPool, type Database } from '../../db/client.ts';

export type { Database, DbPool };
export { describeDbError, isDatabaseError } from '../../db/errors.ts';

export interface DatabaseHandle {
  db: Database;
  pool: DbPool;
}

export async function createDatabase(databaseUrl: string): Promise<DatabaseHandle> {
  return createDbWithToken(databaseUrl);
}
