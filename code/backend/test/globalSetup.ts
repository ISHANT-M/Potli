/** Once per run: refuse non-test databases, then apply the migrations with the real migrate script. */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertTestDatabase } from './testDb.ts';

export default async function setup(): Promise<void> {
  const url = process.env.DATABASE_URL ?? '';
  assertTestDatabase(url);
  const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../db/scripts/migrate.ts');
  const result = spawnSync(process.execPath, [script], {
    env: { ...process.env, DATABASE_URL: url, DATABASE_WS_PROXY: '' },
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`Could not prepare the test database. Is it running? Try "npm run test:db:up".\n${result.stderr}`);
  }
}
