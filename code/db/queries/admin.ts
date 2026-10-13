/** Overview metrics for the admin console (definitions in 02-CONTRACTS section 8). */
import { sql } from 'drizzle-orm';
import type { Database } from '../client.ts';
import { BOOKING_STATUSES } from '../../shared/bookingStatus.ts';
import type { BookingStatus } from '../../shared/types.ts';

/** Run raw SQL; Database is typed without a result kind, so the result shape is asserted here. */
export const rows = async <T>(db: Database, query: ReturnType<typeof sql>): Promise<T[]> =>
  ((await db.execute(query)) as unknown as { rows: T[] }).rows;
const num = (value: unknown): number => Number(value ?? 0);
const orNull = (value: unknown): number | null => (value === null || value === undefined || Number.isNaN(Number(value)) ? null : Number(value));

export interface Overview {
  users: { travelers: number; partners: number; admins: number };
  partners: { pending: number; approved: number; rejected: number; suspended: number };
  bookings: { byStatus: Record<BookingStatus, number>; created: number; completed: number };
  revenue: { grossPaise: number; feesEarnedPaise: number; feesDuePaise: number; feesSettledPaise: number };
  bft: { medianSeconds: number | null; sampleSize: number };
  handoffSuccessRate: number | null;
  utilization: number | null;
  openDisputes: number;
  averageRating: number | null;
}

export async function overviewMetrics(db: Database, from: Date, to: Date): Promise<Overview> {
  const f = from.toISOString();
  const t = to.toISOString();
  const days = Math.max(1, (to.getTime() - from.getTime()) / 86_400_000);

  const [users, partners, byStatus, revenue, bft, handoff, util, disputes, rating, completed] = await Promise.all([
    rows<{ role: string; n: number }>(db, sql`select role::text, count(*)::int as n from profiles group by role`),
    rows<{ status: string; n: number }>(db, sql`select status::text, count(*)::int as n from partner_profiles group by status`),
    rows<{ status: string; n: number }>(db, sql`select status::text, count(*)::int as n from bookings where created_at >= ${f}::timestamptz and created_at < ${t}::timestamptz group by status`),
    rows<Record<string, number>>(db, sql`
      select coalesce(sum(amount_paise) filter (where status = 'captured' and collected_at >= ${f}::timestamptz and collected_at < ${t}::timestamptz), 0)::bigint as gross,
        coalesce(sum(platform_fee_paise) filter (where status = 'captured' and collected_at >= ${f}::timestamptz and collected_at < ${t}::timestamptz), 0)::bigint as fees,
        coalesce(sum(platform_fee_paise) filter (where status = 'captured' and settlement_id is null), 0)::bigint as due,
        coalesce(sum(platform_fee_paise) filter (where status = 'captured' and settlement_id is not null), 0)::bigint as settled
      from payments`),
    rows<{ median: number | null; n: number }>(db, sql`
      select (percentile_cont(0.5) within group (order by extract(epoch from booked_at - search_started_at)))::float as median, count(*)::int as n
      from bookings where created_at >= ${f}::timestamptz and created_at < ${t}::timestamptz and search_started_at is not null and booked_at is not null`),
    rows<{ reached: number; ok: number }>(db, sql`
      select count(*)::int as reached,
        count(*) filter (where b.status = 'completed' and not exists (select 1 from disputes d where d.booking_id = b.id))::int as ok
      from bookings b where b.dropped_at >= ${f}::timestamptz and b.dropped_at < ${t}::timestamptz`),
    rows<{ used: number | null; supply: number | null }>(db, sql`
      select (select sum(bag_count * extract(epoch from slot_end - slot_start) / 3600.0) from bookings
              where status not in ('cancelled', 'expired') and slot_start >= ${f}::timestamptz and slot_start < ${t}::timestamptz)::float as used,
             (select sum(capacity * extract(epoch from close_time - open_time) / 3600.0 * ${days}) from listings where status = 'active')::float as supply`),
    rows<{ n: number }>(db, sql`select count(*)::int as n from disputes where status = 'open'`),
    rows<{ avg: number | null }>(db, sql`select avg(score)::float as avg from ratings`),
    rows<{ n: number }>(db, sql`select count(*)::int as n from bookings where completed_at >= ${f}::timestamptz and completed_at < ${t}::timestamptz`),
  ]);

  const status = Object.fromEntries(BOOKING_STATUSES.map((s) => [s, 0])) as Record<BookingStatus, number>;
  for (const row of byStatus) status[row.status as BookingStatus] = num(row.n);
  const countOf = (list: { n: number; role?: string; status?: string }[], key: 'role' | 'status', value: string) =>
    num(list.find((row) => row[key] === value)?.n);
  const money = revenue[0] ?? {};
  const reached = num(handoff[0]?.reached);
  const supply = orNull(util[0]?.supply);

  return {
    users: { travelers: countOf(users, 'role', 'traveler'), partners: countOf(users, 'role', 'storage_partner'), admins: countOf(users, 'role', 'admin') },
    partners: {
      pending: countOf(partners, 'status', 'pending'),
      approved: countOf(partners, 'status', 'approved'),
      rejected: countOf(partners, 'status', 'rejected'),
      suspended: countOf(partners, 'status', 'suspended'),
    },
    bookings: {
      byStatus: status,
      created: Object.values(status).reduce((a, b) => a + b, 0),
      completed: num(completed[0]?.n),
    },
    revenue: { grossPaise: num(money.gross), feesEarnedPaise: num(money.fees), feesDuePaise: num(money.due), feesSettledPaise: num(money.settled) },
    bft: { medianSeconds: orNull(bft[0]?.median), sampleSize: num(bft[0]?.n) },
    handoffSuccessRate: reached > 0 ? num(handoff[0]?.ok) / reached : null,
    utilization: supply && supply > 0 ? num(util[0]?.used) / supply : null,
    openDisputes: num(disputes[0]?.n),
    averageRating: orNull(rating[0]?.avg),
  };
}
