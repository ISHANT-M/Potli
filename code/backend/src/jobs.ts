/** Background jobs: expire bookings that were never dropped off. */
import type { Database } from '../../db/client.ts';
import { expireOverdueBookings } from '../../db/bookings.ts';

export const JOB_INTERVAL_MS = 5 * 60_000;

/** Start the periodic jobs; call the returned function on shutdown. */
export function startJobs(db: Database, intervalMs: number = JOB_INTERVAL_MS): () => void {
  const run = async (): Promise<void> => {
    try {
      const expired = await expireOverdueBookings(db);
      if (expired > 0) console.log(`expired ${expired} overdue booking(s)`);
    } catch (err) {
      console.error(`booking expiry job failed: ${(err as Error).message}`);
    }
  };

  void run();
  const timer = setInterval(() => void run(), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
