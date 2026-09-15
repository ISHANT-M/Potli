/**
 * Drizzle schema: the source of truth for the tables this app owns.
 *
 * `auth.users` is declared only so profiles can reference it; Supabase Auth
 * (GoTrue) owns that table, and drizzle.config.ts excludes the auth schema from
 * anything Drizzle would otherwise try to manage.
 *
 * The trigger, RLS policies and grants that go with these tables are plain SQL
 * in supabase/migrations, because Drizzle does not express them.
 */
import { index, pgEnum, pgSchema, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const userRole = pgEnum('user_role', ['traveler', 'storage_partner', 'admin']);

export type Role = (typeof userRole.enumValues)[number];

const auth = pgSchema('auth');

export const authUsers = auth.table('users', {
  id: uuid('id').primaryKey(),
});

export const profiles = pgTable(
  'profiles',
  {
    id: uuid('id')
      .primaryKey()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
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
