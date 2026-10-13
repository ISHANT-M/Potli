/** Process entry point: reads config, connects, serves, runs jobs and shuts down cleanly. */
import 'dotenv/config';
import { createApp } from './app.ts';
import { createAppwriteAdapter } from './appwrite.ts';
import { loadConfig } from './config.ts';
import { createDatabase } from './db.ts';
import { startJobs } from './jobs.ts';

async function main(): Promise<void> {
  const config = loadConfig();
  const { db, pool } = await createDatabase(config.databaseUrl);
  const appwrite = createAppwriteAdapter(config);

  const app = createApp({ db, appwrite, config });
  const server = app.listen(config.port, () => console.log(`Potli backend on http://localhost:${config.port}`));
  const stopJobs = startJobs(db);

  let closing = false;
  const shutdown = (): void => {
    if (closing) return;
    closing = true;
    stopJobs();
    server.close(() => {
      void pool.end().then(() => process.exit(0));
    });
    setTimeout(() => process.exit(0), 5_000).unref();
  };
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, shutdown);
}

try {
  await main();
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
