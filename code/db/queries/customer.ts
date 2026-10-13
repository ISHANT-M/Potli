/** Traveller read queries: visible listings (search, detail) and a traveller's own bookings. */
import { and, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import type { Database } from '../client.ts';
import {
  bookings,
  handoffRecords,
  listings,
  partnerProfiles,
  payments,
  profiles,
  ratings,
  type BookingRow,
  type ListingRow,
  type PaymentRow,
} from '../schema.ts';
import type { BookingStatus } from '../../shared/types.ts';

export interface VisibleListing {
  listing: ListingRow;
  businessName: string;
  ratingAverage: number | null;
  ratingCount: number;
  distanceKm: number | null;
}

/** Escape LIKE wildcards so user text matches literally (Postgres' default escape is a backslash). */
export const escapeLike = (value: string): string => value.replace(/[\\%_]/g, '\\$&');

/** Active listing, approved partner, partner not disabled. */
const visible = and(eq(listings.status, 'active'), eq(partnerProfiles.status, 'approved'), eq(profiles.isDisabled, false));

export interface SearchParams {
  id?: string;
  q?: string;
  city?: string;
  lat?: number;
  lng?: number;
  radiusKm?: number;
  sort?: 'distance' | 'price' | 'rating';
}

const MAX_ROWS = 500;

export async function findVisibleListings(db: Database, params: SearchParams = {}): Promise<VisibleListing[]> {
  const agg = db
    .select({
      listingId: ratings.listingId,
      average: sql<number>`avg(${ratings.score})::float`.as('average'),
      count: sql<number>`count(*)::int`.as('count'),
    })
    .from(ratings)
    .groupBy(ratings.listingId)
    .as('agg');

  const hasPoint = params.lat !== undefined && params.lng !== undefined;
  const distance = hasPoint
    ? sql<number>`(6371 * acos(least(1, greatest(-1, cos(radians(${params.lat!})) * cos(radians(${listings.latitude})) * cos(radians(${listings.longitude}) - radians(${params.lng!})) + sin(radians(${params.lat!})) * sin(radians(${listings.latitude}))))))`
    : sql<number | null>`null`;

  const text = params.q
    ? (() => {
        const pattern = `%${escapeLike(params.q)}%`;
        return or(ilike(listings.name, pattern), ilike(listings.area, pattern), ilike(listings.city, pattern), ilike(listings.address, pattern));
      })()
    : undefined;
  const conditions: (SQL | undefined)[] = [
    visible,
    params.id ? eq(listings.id, params.id) : undefined,
    text,
    params.city ? ilike(listings.city, escapeLike(params.city)) : undefined,
    hasPoint ? sql`${distance} <= ${params.radiusKm ?? 10}` : undefined,
  ];

  const order: SQL[] =
    params.sort === 'price'
      ? [sql`${listings.hourlyRatePaise} asc`]
      : params.sort === 'rating'
        ? [sql`${agg.average} desc nulls last`]
        : hasPoint
          ? [sql`${distance} asc`]
          : [sql`${agg.average} desc nulls last`];
  order.push(sql`${listings.name} asc`);

  const rows = await db
    .select({
      listing: listings,
      businessName: partnerProfiles.businessName,
      average: agg.average,
      count: agg.count,
      distance: distance.as('distance'),
    })
    .from(listings)
    .innerJoin(partnerProfiles, eq(partnerProfiles.userId, listings.partnerId))
    .innerJoin(profiles, eq(profiles.id, listings.partnerId))
    .leftJoin(agg, eq(agg.listingId, listings.id))
    .where(and(...conditions))
    .orderBy(...order)
    .limit(MAX_ROWS);

  return rows.map((row) => ({
    listing: row.listing,
    businessName: row.businessName,
    ratingAverage: row.average === null ? null : Math.round(row.average * 10) / 10,
    ratingCount: row.count ?? 0,
    distanceKm: row.distance === null ? null : Math.round(Number(row.distance) * 10) / 10,
  }));
}

export async function findVisibleListing(db: Database, id: string): Promise<VisibleListing | null> {
  return (await findVisibleListings(db, { id }))[0] ?? null;
}

export async function recentRatings(db: Database, listingId: string, limit = 5) {
  const rows = await db
    .select({ score: ratings.score, comment: ratings.comment, createdAt: ratings.createdAt, fullName: profiles.fullName })
    .from(ratings)
    .innerJoin(profiles, eq(profiles.id, ratings.travelerId))
    .where(eq(ratings.listingId, listingId))
    .orderBy(desc(ratings.createdAt))
    .limit(limit);
  return rows.map((row) => ({
    score: row.score,
    comment: row.comment,
    createdAt: row.createdAt.toISOString(),
    firstName: row.fullName.trim().split(/\s+/)[0] ?? '',
  }));
}

export interface TravelerBookingRow {
  booking: BookingRow;
  listing: ListingRow;
  businessName: string;
  partnerPhone: string;
  payment: PaymentRow | null;
  dropOffPhotoIds: string[];
  rating: { score: number; comment: string } | null;
}

export const UPCOMING_STATUSES: BookingStatus[] = ['booked', 'dropped', 'stored', 'picked_up'];
export const PAST_STATUSES: BookingStatus[] = ['completed', 'cancelled', 'expired'];

/** The traveller's own bookings; `traveler_id` is always in the WHERE. */
export async function findTravelerBookings(
  db: Database,
  travelerId: string,
  options: { id?: string; scope?: 'upcoming' | 'past' | 'all'; limit?: number; offset?: number } = {},
): Promise<{ rows: TravelerBookingRow[]; total: number }> {
  const scope = options.scope ?? 'all';
  const where = and(
    eq(bookings.travelerId, travelerId),
    options.id ? eq(bookings.id, options.id) : undefined,
    scope === 'upcoming' ? inArray(bookings.status, UPCOMING_STATUSES) : scope === 'past' ? inArray(bookings.status, PAST_STATUSES) : undefined,
  );

  const [count] = await db.select({ total: sql<number>`count(*)::int` }).from(bookings).where(where);
  const base = await db
    .select({ booking: bookings, listing: listings, businessName: partnerProfiles.businessName, partnerPhone: partnerProfiles.phone, payment: payments })
    .from(bookings)
    .innerJoin(listings, eq(listings.id, bookings.listingId))
    .innerJoin(partnerProfiles, eq(partnerProfiles.userId, listings.partnerId))
    .leftJoin(payments, eq(payments.bookingId, bookings.id))
    .where(where)
    .orderBy(scope === 'upcoming' ? sql`${bookings.slotStart} asc` : desc(bookings.createdAt))
    .limit(options.limit ?? 50)
    .offset(options.offset ?? 0);

  const ids = base.map((row) => row.booking.id);
  const photos = new Map<string, string[]>();
  const rated = new Map<string, { score: number; comment: string }>();
  if (ids.length > 0) {
    const handoffs = await db
      .select({ bookingId: handoffRecords.bookingId, photos: handoffRecords.photoFileIds })
      .from(handoffRecords)
      .where(and(inArray(handoffRecords.bookingId, ids), eq(handoffRecords.type, 'drop_off')));
    for (const row of handoffs) photos.set(row.bookingId, row.photos);
    const given = await db
      .select({ bookingId: ratings.bookingId, score: ratings.score, comment: ratings.comment })
      .from(ratings)
      .where(inArray(ratings.bookingId, ids));
    for (const row of given) rated.set(row.bookingId, { score: row.score, comment: row.comment });
  }

  return {
    total: count?.total ?? 0,
    rows: base.map((row) => ({
      ...row,
      dropOffPhotoIds: photos.get(row.booking.id) ?? [],
      rating: rated.get(row.booking.id) ?? null,
    })),
  };
}
