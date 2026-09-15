/**
 * Profile queries shared by the API and the seed script.
 *
 * The db client is passed in rather than imported, so callers own their
 * connection (the API keeps one pool for its lifetime, the seed opens one for
 * the run).
 */
import { eq } from 'drizzle-orm';
import type { Database } from './client.ts';
import { partnerProfiles, profiles, type Role } from './schema.ts';

export interface Profile {
  id: string;
  email: string;
  fullName: string;
  role: Role;
}

export interface ProfileInput extends Profile {}

export interface PartnerProfileInput {
  userId: string;
  businessName: string;
  phone: string;
}

export async function loadProfile(db: Database, userId: string): Promise<Profile | null> {
  const [row] = await db
    .select({
      id: profiles.id,
      email: profiles.email,
      fullName: profiles.fullName,
      role: profiles.role,
    })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);
  return row ?? null;
}

export async function upsertProfile(db: Database, input: ProfileInput): Promise<Profile> {
  const [row] = await db
    .insert(profiles)
    .values(input)
    .onConflictDoUpdate({
      target: profiles.id,
      set: { email: input.email, fullName: input.fullName, role: input.role },
    })
    .returning({
      id: profiles.id,
      email: profiles.email,
      fullName: profiles.fullName,
      role: profiles.role,
    });
  if (!row) throw new Error(`could not upsert profile ${input.email}`);
  return row;
}

export async function upsertPartnerProfile(db: Database, input: PartnerProfileInput): Promise<void> {
  await db
    .insert(partnerProfiles)
    .values(input)
    .onConflictDoUpdate({
      target: partnerProfiles.userId,
      set: { businessName: input.businessName, phone: input.phone },
    });
}
