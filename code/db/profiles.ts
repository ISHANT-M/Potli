/** Profile queries shared by the API and seed; callers own the connection. */
import { eq } from 'drizzle-orm';
import type { Database } from './client.ts';
import { partnerProfiles, profiles, type Role } from './schema.ts';
import type { PartnerStatus } from '../shared/types.ts';

export interface Profile {
  id: string;
  appwriteUserId: string;
  email: string;
  fullName: string;
  phone: string;
  role: Role;
  isDisabled: boolean;
  disabledReason: string | null;
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
  businessType?: string;
  address?: string;
  city?: string;
  status?: PartnerStatus;
  rejectionReason?: string | null;
}

const profileColumns = {
  id: profiles.id,
  appwriteUserId: profiles.appwriteUserId,
  email: profiles.email,
  fullName: profiles.fullName,
  phone: profiles.phone,
  role: profiles.role,
  isDisabled: profiles.isDisabled,
  disabledReason: profiles.disabledReason,
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

/** Create missing profiles on first API contact; an existing profile (and its role) is never overwritten. */
export async function ensureProfile(db: Database, input: ProfileInput): Promise<Profile> {
  const existing = await loadProfile(db, input.appwriteUserId);
  if (existing) return existing;
  await db.insert(profiles).values(input).onConflictDoNothing({ target: profiles.appwriteUserId });
  const created = await loadProfile(db, input.appwriteUserId);
  if (!created) throw new Error(`could not create profile ${input.email}`);
  return created;
}

export async function upsertPartnerProfile(db: Database, input: PartnerProfileInput): Promise<void> {
  const { userId, ...fields } = input;
  await db
    .insert(partnerProfiles)
    .values({ userId, ...fields })
    .onConflictDoUpdate({ target: partnerProfiles.userId, set: { ...fields, updatedAt: new Date() } });
}

export async function loadProfileById(db: Database, id: string): Promise<Profile | null> {
  const [row] = await db.select(profileColumns).from(profiles).where(eq(profiles.id, id)).limit(1);
  return row ?? null;
}

export async function updateProfile(
  db: Database,
  id: string,
  changes: { fullName?: string; phone?: string },
): Promise<Profile | null> {
  const [row] = await db
    .update(profiles)
    .set({ ...changes, updatedAt: new Date() })
    .where(eq(profiles.id, id))
    .returning(profileColumns);
  return row ?? null;
}

export async function setDisabled(
  db: Database,
  id: string,
  disabled: boolean,
  reason: string | null = null,
): Promise<Profile | null> {
  const [row] = await db
    .update(profiles)
    .set({ isDisabled: disabled, disabledReason: disabled ? reason : null, updatedAt: new Date() })
    .where(eq(profiles.id, id))
    .returning(profileColumns);
  return row ?? null;
}
