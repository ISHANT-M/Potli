/** Appwrite IDs link these app-owned tables to accounts in a separate database. */
import { index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const userRole = pgEnum('user_role', ['traveler', 'storage_partner', 'admin']);

export type Role = (typeof userRole.enumValues)[number];

export const profiles = pgTable(
  'profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    appwriteUserId: text('appwrite_user_id').notNull().unique(),
    email: text('email').notNull(),
    fullName: text('full_name').notNull().default(''),
    role: userRole('role').notNull().default('traveler'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_profiles_role').on(table.role)],
);

export const partnerProfiles = pgTable('partner_profiles', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => profiles.id, { onDelete: 'cascade' }),
  businessName: text('business_name').notNull().default(''),
  phone: text('phone').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ProfileRow = typeof profiles.$inferSelect;
export type PartnerProfileRow = typeof partnerProfiles.$inferSelect;
