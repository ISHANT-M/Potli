/** Per test file: start from empty tables and release the pool afterwards. */
import { afterAll, beforeAll } from 'vitest';
import { closeTestDb, truncateAll } from './testDb.ts';

beforeAll(async () => {
  await truncateAll();
});

afterAll(async () => {
  await closeTestDb();
});
