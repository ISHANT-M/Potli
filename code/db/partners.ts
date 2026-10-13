/** Partner application state: loading a partner's profile and moving it through review. */
import { eq } from 'drizzle-orm';
import type { Database } from './client.ts';
import { partnerProfiles, type PartnerProfileRow } from './schema.ts';
import type { PartnerStatus } from '../shared/types.ts';

export async function loadPartnerProfile(db: Database, userId: string): Promise<PartnerProfileRow | null> {
  const [row] = await db.select().from(partnerProfiles).where(eq(partnerProfiles.userId, userId)).limit(1);
  return row ?? null;
}

export interface SetPartnerStatusInput {
  userId: string;
  status: PartnerStatus;
  reviewerId: string | null;
  /** Required by the API for `rejected` and `suspended`; cleared otherwise. */
  reason?: string | null;
}

export async function setPartnerStatus(db: Database, input: SetPartnerStatusInput): Promise<PartnerProfileRow | null> {
  const resubmitted = input.status === 'pending';
  const [row] = await db
    .update(partnerProfiles)
    .set({
      status: input.status,
      rejectionReason: input.status === 'rejected' || input.status === 'suspended' ? (input.reason ?? null) : null,
      reviewedBy: resubmitted ? null : input.reviewerId,
      reviewedAt: resubmitted ? null : new Date(),
      ...(resubmitted ? { submittedAt: new Date() } : {}),
      updatedAt: new Date(),
    })
    .where(eq(partnerProfiles.userId, input.userId))
    .returning();
  return row ?? null;
}
