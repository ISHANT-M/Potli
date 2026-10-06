/** Profile queries shared by the API and seed; callers own the connection. */
import { eq } from 'drizzle-orm';
import type { Database } from './client.ts';
import { partnerProfiles, profiles, type Role } from './schema.ts';

export interface Profile {
  id: string;
  appwriteUserId: string;
  email: string;
  fullName: string;
  role: Role;
}

export interface ProfileInput {
  appwriteUserId: string;
  email: string;
  fullName: string;
  role: Role;
}

export interface PartnerProfileInput {
  userId: string;
  businessName: string;
  phone: string;
}

const profileColumns = {
  id: profiles.id,
  appwriteUserId: profiles.appwriteUserId,
  email: profiles.email,
  fullName: profiles.fullName,
  role: profiles.role,
};

export async function loadProfile(db: Database, appwriteUserId: string): Promise<Profile | null> {
  const [row] = await db
    .select(profileColumns)
    .from(profiles)
    .where(eq(profiles.appwriteUserId, appwriteUserId))
    .limit(1);
  return row ?? null;
}

export async function upsertProfile(db: Database, input: ProfileInput): Promise<Profile> {
  const [row] = await db
    .insert(profiles)
    .values(input)
    .onConflictDoUpdate({
      target: profiles.appwriteUserId,
      set: { email: input.email, fullName: input.fullName, role: input.role },
    })
    .returning(profileColumns);
  if (!row) throw new Error(`could not upsert profile ${input.email}`);
  return row;
}

/** Create missing profiles on first API contact; preserve existing roles. */
export async function ensureProfile(db: Database, input: ProfileInput): Promise<Profile> {
  const existing = await loadProfile(db, input.appwriteUserId);
  if (existing) return existing;
  return upsertProfile(db, { ...input, role: input.role ?? 'traveler' });
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
