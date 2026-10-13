/**
 * Daily housekeeping: delete luggage photos 48 hours after a booking ends, and delete accounts
 * that never verified their email 15 days after sign-up. Retention is stated in the privacy policy.
 */
import type { Database } from '../../db/client.ts';
import { audit } from '../../db/audit.ts';
import { and, desc, eq, inArray, sql } from '../../db/orm.ts';
import { auditLog, bookings, handoffRecords, profiles } from '../../db/schema.ts';
import type { AppwriteAdapter } from './appwrite.ts';
import type { Config } from './config.ts';

export const PHOTO_RETENTION_MS = 48 * 3_600_000;
export const UNVERIFIED_RETENTION_MS = 15 * 86_400_000;
const BATCH = 200;
const CHECK_EVERY_MS = 3_600_000;
const FIRST_CHECK_MS = 30_000;
const RUN_EVERY_MS = 24 * 3_600_000;
const LOCK_KEY = 727001;

export interface CleanupDeps {
  db: Database;
  appwrite: AppwriteAdapter;
  config: Pick<Config, 'buckets'>;
}

export interface CleanupResult {
  photosDeleted: number;
  photoRecordsCleared: number;
  accountsDeleted: number;
  errors: number;
}

/** Photos of finished bookings (completed or cancelled) older than 48 hours, unless a dispute is still open. */
async function purgePhotos(deps: CleanupDeps, now: Date, dryRun: boolean, result: CleanupResult): Promise<void> {
  const { db, appwrite, config } = deps;
  const cutoff = new Date(now.getTime() - PHOTO_RETENTION_MS);
  const rows = await db
    .select({ id: handoffRecords.id, bookingId: handoffRecords.bookingId, fileIds: handoffRecords.photoFileIds })
    .from(handoffRecords)
    .innerJoin(bookings, eq(bookings.id, handoffRecords.bookingId))
    .where(
      and(
        sql`cardinality(${handoffRecords.photoFileIds}) > 0`,
        inArray(bookings.status, ['completed', 'cancelled']),
        sql`coalesce(${bookings.completedAt}, ${bookings.cancelledAt}) < ${cutoff.toISOString()}`,
        sql`not exists (select 1 from disputes d where d.booking_id = ${bookings.id} and d.status = 'open')`,
      ),
    )
    .limit(BATCH);

  for (const row of rows) {
    if (dryRun) {
      result.photosDeleted += row.fileIds.length;
      continue;
    }
    try {
      for (const fileId of row.fileIds) await appwrite.deleteFile(config.buckets.handoff, fileId);
      await db.update(handoffRecords).set({ photoFileIds: [] }).where(eq(handoffRecords.id, row.id));
      await audit(db, { actorId: null, actorRole: null, action: 'photos.purge', entity: 'booking', entityId: row.bookingId, metadata: { count: row.fileIds.length } });
      result.photosDeleted += row.fileIds.length;
      result.photoRecordsCleared += 1;
    } catch (err) {
      result.errors += 1;
      console.error(`photo cleanup failed for booking ${row.bookingId}: ${(err as Error).message}`);
    }
  }
}

/**
 * Unverified sign-ups older than 15 days. Only accounts without any role label are touched, so
 * partners, admins and the infrastructure account are never eligible, and an account that has
 * bookings or a non-traveller profile is skipped.
 */
async function purgeUnverifiedAccounts(deps: CleanupDeps, now: Date, dryRun: boolean, result: CleanupResult): Promise<void> {
  const { db, appwrite } = deps;
  const users = await appwrite.listUnverifiedUsers(new Date(now.getTime() - UNVERIFIED_RETENTION_MS), BATCH);

  for (const user of users) {
    if (user.labels.length > 0) continue;
    try {
      const [profile] = await db
        .select({ id: profiles.id, role: profiles.role })
        .from(profiles)
        .where(eq(profiles.appwriteUserId, user.id))
        .limit(1);
      if (profile) {
        if (profile.role !== 'traveler') continue;
        const [used] = await db.select({ n: sql<number>`count(*)::int` }).from(bookings).where(eq(bookings.travelerId, profile.id));
        if ((used?.n ?? 0) > 0) continue;
      }
      if (dryRun) {
        result.accountsDeleted += 1;
        continue;
      }
      await appwrite.deleteUser(user.id);
      if (profile) {
        await db.update(auditLog).set({ actorId: null }).where(eq(auditLog.actorId, profile.id));
        await db.delete(profiles).where(eq(profiles.id, profile.id));
      }
      await audit(db, { actorId: null, actorRole: null, action: 'account.purge_unverified', entity: 'account', entityId: user.id, metadata: { createdAt: user.createdAt } });
      result.accountsDeleted += 1;
    } catch (err) {
      result.errors += 1;
      console.error(`account cleanup failed for ${user.id}: ${(err as Error).message}`);
    }
  }
}

/** Run every cleanup task once. `dryRun` counts what would be removed and deletes nothing. */
export async function runCleanup(deps: CleanupDeps, options: { now?: Date; dryRun?: boolean } = {}): Promise<CleanupResult> {
  const now = options.now ?? new Date();
  const dryRun = options.dryRun ?? false;
  const result: CleanupResult = { photosDeleted: 0, photoRecordsCleared: 0, accountsDeleted: 0, errors: 0 };
  for (const task of [purgePhotos, purgeUnverifiedAccounts]) {
    try {
      await task(deps, now, dryRun, result);
    } catch (err) {
      result.errors += 1;
      console.error(`cleanup task failed: ${(err as Error).message}`);
    }
  }
  return result;
}

/**
 * Run the cleanup if none has started in the last 24 hours. The claim is a `system.cleanup` audit row
 * taken under an advisory lock, so restarts and several servers on one database run it once a day.
 */
export async function runCleanupIfDue(deps: CleanupDeps, now: Date = new Date()): Promise<CleanupResult | null> {
  const { db } = deps;
  const claimId = await db.transaction(async (tx) => {
    const locked = (await tx.execute(sql`select pg_try_advisory_xact_lock(${LOCK_KEY}) as ok`)) as unknown as { rows: { ok: boolean }[] };
    if (!locked.rows[0]?.ok) return null;
    const [last] = await tx
      .select({ at: auditLog.createdAt })
      .from(auditLog)
      .where(eq(auditLog.action, 'system.cleanup'))
      .orderBy(desc(auditLog.createdAt))
      .limit(1);
    if (last && now.getTime() - last.at.getTime() < RUN_EVERY_MS) return null;
    const [claim] = await tx
      .insert(auditLog)
      .values({ action: 'system.cleanup', entity: 'system', entityId: 'daily', metadata: {} })
      .returning({ id: auditLog.id });
    return claim?.id ?? null;
  });
  if (!claimId) return null;

  const result = await runCleanup(deps, { now });
  // A run where every task failed is retried on the next hourly check.
  if (result.errors > 0 && result.photosDeleted + result.accountsDeleted === 0) {
    await db.delete(auditLog).where(eq(auditLog.id, claimId));
    return result;
  }
  await db.update(auditLog).set({ metadata: { ...result } }).where(eq(auditLog.id, claimId));
  console.log(`daily cleanup: ${result.photosDeleted} photo(s), ${result.accountsDeleted} unverified account(s), ${result.errors} error(s)`);
  return result;
}

/** Check hourly whether the daily cleanup is due; call the returned function on shutdown. */
export function startCleanupSchedule(deps: CleanupDeps): () => void {
  const check = (): void => {
    runCleanupIfDue(deps).catch((err) => console.error(`daily cleanup check failed: ${(err as Error).message}`));
  };
  const first = setTimeout(check, FIRST_CHECK_MS);
  const timer = setInterval(check, CHECK_EVERY_MS);
  first.unref();
  timer.unref();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
