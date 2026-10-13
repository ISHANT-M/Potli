/** Appwrite IDs link these app-owned tables to accounts in a separate database. */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const userRole = pgEnum('user_role', ['traveler', 'storage_partner', 'admin']);
export const partnerStatus = pgEnum('partner_status', ['pending', 'approved', 'rejected', 'suspended']);
export const listingStatus = pgEnum('listing_status', ['active', 'paused', 'flagged']);
// Mirrors the state diagram. pending_payment is kept for online payments; cash-on-pickup
// bookings are created directly in `booked` because nothing is captured up front.
export const bookingStatus = pgEnum('booking_status', [
  'pending_payment',
  'booked',
  'dropped',
  'stored',
  'picked_up',
  'completed',
  'cancelled',
  'expired',
]);
export const paymentMethod = pgEnum('payment_method', ['cod', 'upi', 'card']);
// payout_settled is in the class diagram's PaymentStatus; with cash on pickup the partner is
// paid directly, so it is reserved and fee settlements are tracked through fee_settlements.
export const paymentStatus = pgEnum('payment_status', ['pending', 'captured', 'refunded', 'payout_settled', 'failed']);
export const handoffType = pgEnum('handoff_type', ['drop_off', 'pickup']);
export const handoffMethod = pgEnum('handoff_method', ['qr', 'otp']);
export const disputeStatus = pgEnum('dispute_status', ['open', 'resolved', 'rejected']);

export type Role = (typeof userRole.enumValues)[number];

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const tstz = (name: string) => timestamp(name, { withTimezone: true });

export const profiles = pgTable(
  'profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    appwriteUserId: text('appwrite_user_id').notNull().unique(),
    email: text('email').notNull(),
    fullName: text('full_name').notNull().default(''),
    phone: text('phone').notNull().default(''),
    role: userRole('role').notNull().default('traveler'),
    isDisabled: boolean('is_disabled').notNull().default(false),
    disabledReason: text('disabled_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('idx_profiles_role').on(table.role)],
);

export const partnerProfiles = pgTable(
  'partner_profiles',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    businessName: text('business_name').notNull().default(''),
    phone: text('phone').notNull().default(''),
    businessType: text('business_type').notNull().default(''),
    address: text('address').notNull().default(''),
    city: text('city').notNull().default(''),
    status: partnerStatus('status').notNull().default('pending'),
    rejectionReason: text('rejection_reason'),
    reviewedBy: uuid('reviewed_by').references(() => profiles.id),
    reviewedAt: tstz('reviewed_at'),
    submittedAt: tstz('submitted_at').notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('idx_partner_profiles_status').on(table.status)],
);

export const listings = pgTable(
  'listings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    partnerId: uuid('partner_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    address: text('address').notNull(),
    area: text('area').notNull().default(''),
    city: text('city').notNull(),
    latitude: doublePrecision('latitude').notNull(),
    longitude: doublePrecision('longitude').notNull(),
    capacity: integer('capacity').notNull(),
    hourlyRatePaise: integer('hourly_rate_paise').notNull(),
    dailyCapPaise: integer('daily_cap_paise').notNull(),
    openTime: time('open_time').notNull(),
    closeTime: time('close_time').notNull(),
    openDays: smallint('open_days')
      .array()
      .notNull()
      .default(sql`'{0,1,2,3,4,5,6}'::smallint[]`),
    coverFileId: text('cover_file_id'),
    status: listingStatus('status').notNull().default('active'),
    flagReason: text('flag_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('idx_listings_partner').on(table.partnerId),
    index('idx_listings_status').on(table.status),
    index('idx_listings_city').on(sql`lower(${table.city})`),
    check('listings_capacity_range', sql`${table.capacity} between 1 and 200`),
    check('listings_hourly_rate_range', sql`${table.hourlyRatePaise} between 1000 and 100000`),
    check(
      'listings_daily_cap_range',
      sql`${table.dailyCapPaise} >= ${table.hourlyRatePaise} and ${table.dailyCapPaise} <= 24 * ${table.hourlyRatePaise}`,
    ),
    check('listings_hours_order', sql`${table.closeTime} > ${table.openTime}`),
  ],
);

export const bookings = pgTable(
  'bookings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull().unique(),
    travelerId: uuid('traveler_id')
      .notNull()
      .references(() => profiles.id),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id),
    bagCount: integer('bag_count').notNull(),
    slotStart: tstz('slot_start').notNull(),
    slotEnd: tstz('slot_end').notNull(),
    status: bookingStatus('status').notNull(),
    quotedPaise: integer('quoted_paise').notNull(),
    finalPaise: integer('final_paise'),
    paymentMethod: paymentMethod('payment_method').notNull().default('cod'),
    searchStartedAt: tstz('search_started_at'),
    bookedAt: tstz('booked_at'),
    droppedAt: tstz('dropped_at'),
    storedAt: tstz('stored_at'),
    pickedUpAt: tstz('picked_up_at'),
    completedAt: tstz('completed_at'),
    cancelledAt: tstz('cancelled_at'),
    cancelledBy: uuid('cancelled_by').references(() => profiles.id),
    cancelReason: text('cancel_reason'),
    otpFailedAttempts: integer('otp_failed_attempts').notNull().default(0),
    otpLockedUntil: tstz('otp_locked_until'),
    idempotencyKey: text('idempotency_key'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('idx_bookings_listing_window').on(table.listingId, table.status, table.slotStart, table.slotEnd),
    index('idx_bookings_traveler').on(table.travelerId, sql`${table.createdAt} desc`),
    index('idx_bookings_status').on(table.status),
    unique('bookings_traveler_idempotency_unique').on(table.travelerId, table.idempotencyKey),
    check('bookings_bag_count_range', sql`${table.bagCount} between 1 and 10`),
    check('bookings_slot_order', sql`${table.slotEnd} > ${table.slotStart}`),
  ],
);

export const handoffRecords = pgTable(
  'handoff_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    type: handoffType('type').notNull(),
    method: handoffMethod('method').notNull(),
    verifiedBy: uuid('verified_by')
      .notNull()
      .references(() => profiles.id),
    bagCount: integer('bag_count').notNull(),
    photoFileIds: text('photo_file_ids')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    note: text('note').notNull().default(''),
    verifiedAt: tstz('verified_at').notNull().defaultNow(),
  },
  (table) => [unique('handoff_records_booking_type_unique').on(table.bookingId, table.type)],
);

export const feeSettlements = pgTable('fee_settlements', {
  id: uuid('id').primaryKey().defaultRandom(),
  partnerId: uuid('partner_id')
    .notNull()
    .references(() => profiles.id),
  amountPaise: integer('amount_paise').notNull(),
  paymentCount: integer('payment_count').notNull(),
  reference: text('reference').notNull(),
  note: text('note').notNull().default(''),
  recordedBy: uuid('recorded_by')
    .notNull()
    .references(() => profiles.id),
  createdAt: createdAt(),
});

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bookingId: uuid('booking_id')
      .notNull()
      .unique()
      .references(() => bookings.id),
    method: paymentMethod('method').notNull(),
    status: paymentStatus('status').notNull().default('pending'),
    amountPaise: integer('amount_paise').notNull(),
    platformFeePaise: integer('platform_fee_paise').notNull().default(0),
    partnerSharePaise: integer('partner_share_paise').notNull().default(0),
    collectedAt: tstz('collected_at'),
    collectedBy: uuid('collected_by').references(() => profiles.id),
    settlementId: uuid('settlement_id').references(() => feeSettlements.id),
    gatewayReference: text('gateway_reference'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('idx_payments_status_settlement').on(table.status, table.settlementId)],
);

export const ratings = pgTable(
  'ratings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bookingId: uuid('booking_id')
      .notNull()
      .unique()
      .references(() => bookings.id),
    travelerId: uuid('traveler_id')
      .notNull()
      .references(() => profiles.id),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id),
    score: smallint('score').notNull(),
    comment: text('comment').notNull().default(''),
    createdAt: createdAt(),
  },
  (table) => [
    index('idx_ratings_listing').on(table.listingId),
    check('ratings_score_range', sql`${table.score} between 1 and 5`),
  ],
);

export const disputes = pgTable(
  'disputes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id),
    raisedBy: uuid('raised_by')
      .notNull()
      .references(() => profiles.id),
    raisedByRole: userRole('raised_by_role').notNull(),
    reason: text('reason').notNull(),
    status: disputeStatus('status').notNull().default('open'),
    resolution: text('resolution'),
    resolvedBy: uuid('resolved_by').references(() => profiles.id),
    resolvedAt: tstz('resolved_at'),
    createdAt: createdAt(),
  },
  (table) => [
    index('idx_disputes_status_created').on(table.status, table.createdAt),
    uniqueIndex('uniq_open_dispute_per_raiser')
      .on(table.bookingId, table.raisedBy)
      .where(sql`${table.status} = 'open'`),
    check('disputes_reason_length', sql`char_length(${table.reason}) between 10 and 1000`),
  ],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: uuid('actor_id').references(() => profiles.id),
    actorRole: userRole('actor_role'),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id').notNull(),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    ip: text('ip'),
    createdAt: createdAt(),
  },
  (table) => [
    index('idx_audit_entity').on(table.entity, table.entityId),
    index('idx_audit_created').on(sql`${table.createdAt} desc`),
  ],
);

export type ProfileRow = typeof profiles.$inferSelect;
export type PartnerProfileRow = typeof partnerProfiles.$inferSelect;
export type ListingRow = typeof listings.$inferSelect;
export type BookingRow = typeof bookings.$inferSelect;
export type PaymentRow = typeof payments.$inferSelect;
export type HandoffRow = typeof handoffRecords.$inferSelect;
