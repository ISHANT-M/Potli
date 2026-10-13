/** Row to DTO mappers shared by the portal routers. DTO keys are camelCase; money is integer paise. */
import type { Profile } from '../../../db/profiles.ts';
import type { BookingRow, ListingRow, PartnerProfileRow, PaymentRow } from '../../../db/schema.ts';
import { quote } from '../../../shared/pricing.ts';
import type {
  Booking,
  HandoffCode,
  ListingDetail,
  ListingSummary,
  Me,
  PartnerBooking,
  PartnerListing,
} from '../../../shared/types.ts';

export const fileUrl = (fileId: string): string => `/api/v1/files/${fileId}`;

/** Postgres `time` arrives as HH:MM:SS; the API exposes HH:MM. */
export const clock = (value: string): string => value.slice(0, 5);

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

export function toMe(profile: Profile, partner: PartnerProfileRow | null, emailVerified: boolean): Me {
  return {
    id: profile.id,
    email: profile.email,
    fullName: profile.fullName,
    phone: profile.phone,
    role: profile.role,
    emailVerified,
    partner: partner
      ? {
          status: partner.status,
          businessName: partner.businessName,
          businessType: partner.businessType,
          phone: partner.phone,
          address: partner.address,
          city: partner.city,
          rejectionReason: partner.rejectionReason,
        }
      : null,
  };
}

export interface ListingContext {
  listing: ListingRow;
  businessName: string;
  ratingAverage?: number | null;
  ratingCount?: number;
  distanceKm?: number | null;
  available?: number | null;
}

export function toListingSummary(ctx: ListingContext): ListingSummary {
  const { listing } = ctx;
  return {
    id: listing.id,
    name: listing.name,
    area: listing.area,
    city: listing.city,
    address: listing.address,
    latitude: listing.latitude,
    longitude: listing.longitude,
    hourlyRatePaise: listing.hourlyRatePaise,
    dailyCapPaise: listing.dailyCapPaise,
    openTime: clock(listing.openTime),
    closeTime: clock(listing.closeTime),
    openDays: [...listing.openDays],
    businessName: ctx.businessName,
    coverUrl: listing.coverFileId ? fileUrl(listing.coverFileId) : null,
    ratingAverage: ctx.ratingAverage ?? null,
    ratingCount: ctx.ratingCount ?? 0,
    distanceKm: ctx.distanceKm ?? null,
    available: ctx.available ?? null,
  };
}

export function toListingDetail(ctx: ListingContext): ListingDetail {
  return { ...toListingSummary(ctx), description: ctx.listing.description, capacity: ctx.listing.capacity };
}

export function toPartnerListing(ctx: ListingContext): PartnerListing {
  const { listing } = ctx;
  return {
    ...toListingDetail(ctx),
    status: listing.status,
    flagReason: listing.flagReason,
    createdAt: listing.createdAt.toISOString(),
    updatedAt: listing.updatedAt.toISOString(),
  };
}

export interface BookingContext {
  booking: BookingRow;
  listing: ListingRow;
  businessName: string;
  partnerPhone: string;
  payment: PaymentRow | null;
  handoffCode?: HandoffCode | null;
  dropOffPhotoIds?: string[];
  rating?: { score: number; comment: string } | null;
  now?: Date;
}

const PHONE_VISIBLE = new Set(['booked', 'dropped', 'stored', 'picked_up', 'completed']);

function bookingBase(ctx: BookingContext): Omit<Booking, 'handoffCode' | 'canRate' | 'rating'> {
  const { booking, listing, payment } = ctx;
  return {
    id: booking.id,
    code: booking.code,
    status: booking.status,
    bagCount: booking.bagCount,
    slotStart: booking.slotStart.toISOString(),
    slotEnd: booking.slotEnd.toISOString(),
    quotedPaise: booking.quotedPaise,
    finalPaise: booking.finalPaise,
    paymentMethod: booking.paymentMethod,
    paymentStatus: payment?.status ?? 'pending',
    listing: {
      id: listing.id,
      name: listing.name,
      address: listing.address,
      area: listing.area,
      city: listing.city,
      latitude: listing.latitude,
      longitude: listing.longitude,
      openTime: clock(listing.openTime),
      closeTime: clock(listing.closeTime),
      businessName: ctx.businessName,
      ...(PHONE_VISIBLE.has(booking.status) && ctx.partnerPhone ? { phone: ctx.partnerPhone } : {}),
    },
    timeline: {
      bookedAt: iso(booking.bookedAt),
      droppedAt: iso(booking.droppedAt),
      storedAt: iso(booking.storedAt),
      pickedUpAt: iso(booking.pickedUpAt),
      completedAt: iso(booking.completedAt),
      cancelledAt: iso(booking.cancelledAt),
    },
    cancelReason: booking.cancelReason,
    canCancel: booking.status === 'booked',
    dropOffPhotoUrls: (ctx.dropOffPhotoIds ?? []).map(fileUrl),
  };
}

export function toBooking(ctx: BookingContext): Booking {
  const rating = ctx.rating ?? null;
  return {
    ...bookingBase(ctx),
    canRate: ctx.booking.status === 'completed' && rating === null,
    handoffCode: ctx.handoffCode ?? null,
    rating,
  };
}

export function toPartnerBooking(ctx: BookingContext & { traveler: { fullName: string; phone: string } }): PartnerBooking {
  const { booking, listing, payment } = ctx;
  const now = ctx.now ?? new Date();
  const holdingBags = booking.status === 'dropped' || booking.status === 'stored';
  const isOverdue = holdingBags && now > booking.slotEnd;

  // While bags are held, the running price includes any overstay; after pickup it is the final price.
  let overstayPaise = 0;
  if (booking.finalPaise !== null) {
    overstayPaise = Math.max(0, booking.finalPaise - booking.quotedPaise);
  } else if (isOverdue) {
    overstayPaise = Math.max(0, quote(listing, booking.bagCount, booking.slotStart, now).totalPaise - booking.quotedPaise);
  }

  const base = bookingBase(ctx);
  const captured = payment?.status === 'captured';
  return {
    ...base,
    traveler: ctx.traveler,
    overstayPaise,
    feePaise: captured ? payment.platformFeePaise : null,
    partnerSharePaise: captured ? payment.partnerSharePaise : null,
    isOverdue,
  };
}
