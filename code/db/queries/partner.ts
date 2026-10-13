/** Booking read models shared by the partner and admin routers: one joined query, then mapped to DTOs. */
import { and, count, desc, eq, inArray, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Database } from '../client.ts';
import {
  bookings,
  handoffRecords,
  listings,
  partnerProfiles,
  payments,
  profiles,
  type BookingRow,
  type ListingRow,
  type PaymentRow,
} from '../schema.ts';

export interface BookingRecord {
  booking: BookingRow;
  listing: ListingRow;
  payment: PaymentRow | null;
  businessName: string;
  partnerPhone: string;
  partnerId: string;
  partnerName: string;
  travelerId: string;
  travelerName: string;
  travelerPhone: string;
  travelerEmail: string;
}

export const travelerAlias = alias(profiles, 'traveler');
const traveler = travelerAlias;
const owner = alias(profiles, 'owner');

function base(db: Database) {
  return db
    .select({
      booking: bookings,
      listing: listings,
      payment: payments,
      businessName: partnerProfiles.businessName,
      partnerPhone: partnerProfiles.phone,
      partnerId: owner.id,
      partnerName: owner.fullName,
      travelerId: traveler.id,
      travelerName: traveler.fullName,
      travelerPhone: traveler.phone,
      travelerEmail: traveler.email,
    })
    .from(bookings)
    .innerJoin(listings, eq(listings.id, bookings.listingId))
    .innerJoin(partnerProfiles, eq(partnerProfiles.userId, listings.partnerId))
    .innerJoin(owner, eq(owner.id, listings.partnerId))
    .innerJoin(traveler, eq(traveler.id, bookings.travelerId))
    .leftJoin(payments, eq(payments.bookingId, bookings.id));
}

export async function findBookingRecords(
  db: Database,
  where: SQL | undefined,
  page?: { limit: number; offset: number },
): Promise<BookingRecord[]> {
  const query = base(db).where(where).orderBy(desc(bookings.slotStart), desc(bookings.id));
  return page ? query.limit(page.limit).offset(page.offset) : query;
}

export async function countBookingRecords(db: Database, where: SQL | undefined): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(bookings)
    .innerJoin(listings, eq(listings.id, bookings.listingId))
    .innerJoin(traveler, eq(traveler.id, bookings.travelerId))
    .where(where);
  return row?.total ?? 0;
}

/** Photo file ids per booking and handoff type. */
export async function handoffPhotos(db: Database, bookingIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (bookingIds.length === 0) return map;
  const rows = await db
    .select({ bookingId: handoffRecords.bookingId, ids: handoffRecords.photoFileIds })
    .from(handoffRecords)
    .where(and(inArray(handoffRecords.bookingId, bookingIds), eq(handoffRecords.type, 'drop_off')));
  for (const row of rows) map.set(row.bookingId, row.ids);
  return map;
}

/** Peak number of bags that will be on a listing's shelves at once from `now` on. */
export async function peakFutureBags(db: Database, listingId: string, now: Date = new Date()): Promise<number> {
  const rows = await db
    .select({ start: bookings.slotStart, end: bookings.slotEnd, bags: bookings.bagCount, status: bookings.status })
    .from(bookings)
    .where(and(eq(bookings.listingId, listingId), inArray(bookings.status, ['booked', 'dropped', 'stored'])));
  const events: { at: number; delta: number }[] = [];
  for (const row of rows) {
    const holding = row.status !== 'booked';
    const end = holding ? Math.max(row.end.getTime(), now.getTime()) : row.end.getTime();
    if (end <= now.getTime()) continue;
    events.push({ at: Math.max(row.start.getTime(), now.getTime()), delta: row.bags }, { at: end, delta: -row.bags });
  }
  events.sort((a, b) => a.at - b.at || a.delta - b.delta); // ends before starts at the same instant
  let current = 0;
  let peak = 0;
  for (const event of events) {
    current += event.delta;
    peak = Math.max(peak, current);
  }
  return peak;
}
