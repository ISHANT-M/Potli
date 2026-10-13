/** Helpers shared by the partner and admin routers: paging, id params, LIKE escaping and DTO building. */
import type { Request } from 'express';
import { z } from 'zod';
import { eq, type SQL } from '../../../../db/orm.ts';
import type { Database } from '../../../../db/client.ts';
import { handoffPhotos, type BookingRecord } from '../../../../db/queries/partner.ts';
import { handoffRecords } from '../../../../db/schema.ts';
import type { PartnerBooking } from '../../../../shared/types.ts';
import { fileUrl, toPartnerBooking } from '../../lib/serialize.ts';

export const idParams = z.object({ id: z.string().uuid() });

export const pagingShape = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
};

export const pageWindow = (page: number, pageSize: number) => ({ limit: pageSize, offset: (page - 1) * pageSize });

/** `%text%` with LIKE wildcards escaped, for ILIKE searches. */
export const likePattern = (text: string): string => `%${text.replace(/[\\%_]/g, '\\$&')}%`;

export const clientIp = (req: Request): string | null => req.ip ?? null;

export const asNonNull = (conditions: (SQL | undefined | null | '' | false)[]): SQL[] => conditions.filter((c): c is SQL => Boolean(c));

export async function toPartnerBookings(db: Database, records: BookingRecord[], now: Date = new Date()): Promise<PartnerBooking[]> {
  const photos = await handoffPhotos(db, records.map((r) => r.booking.id));
  return records.map((r) =>
    toPartnerBooking({
      booking: r.booking,
      listing: r.listing,
      businessName: r.businessName,
      partnerPhone: r.partnerPhone,
      payment: r.payment,
      dropOffPhotoIds: photos.get(r.booking.id) ?? [],
      traveler: { fullName: r.travelerName, phone: r.travelerPhone },
      now,
    }),
  );
}

export async function handoffsOf(db: Database, bookingId: string) {
  const rows = await db.select().from(handoffRecords).where(eq(handoffRecords.bookingId, bookingId)).orderBy(handoffRecords.verifiedAt);
  return rows.map((h) => ({
    type: h.type,
    method: h.method,
    bagCount: h.bagCount,
    note: h.note,
    photoUrls: h.photoFileIds.map(fileUrl),
    verifiedAt: h.verifiedAt.toISOString(),
  }));
}
