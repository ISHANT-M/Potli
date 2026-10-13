/** Test app factory, a fake Appwrite adapter and data factories. */
import { randomBytes, randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { createBooking as createBookingRow, type CreateBookingInput } from '../../db/bookings.ts';
import {
  bookings,
  listings,
  partnerProfiles,
  profiles,
  type BookingRow,
  type ListingRow,
  type ProfileRow,
} from '../../db/schema.ts';
import type { PartnerStatus, Role } from '../../shared/types.ts';
import { createApp, type AppDeps } from '../src/app.ts';
import type { AppwriteAccount, AppwriteAdapter } from '../src/appwrite.ts';
import { LABEL_BY_ROLE } from '../src/appwrite.ts';
import type { Config } from '../src/config.ts';
import { errorHandler, notFoundHandler } from '../src/http/errors.ts';
import { createHandoffCodes } from '../src/lib/handoff.ts';
import { testDb } from './testDb.ts';

export const TEST_SECRET = randomBytes(32).toString('base64');

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    nodeEnv: 'test',
    port: 0,
    appwriteEndpoint: 'http://appwrite.invalid/v1',
    appwriteProjectId: 'test',
    appwriteApiKey: 'test-key',
    databaseUrl: process.env.DATABASE_URL ?? '',
    handoffSecret: TEST_SECRET,
    corsOrigins: ['http://localhost:5173'],
    appOrigin: 'http://localhost:5173',
    platformFeeBps: 1500,
    trustProxy: false,
    buckets: { handoff: 'handoff-photos', listing: 'listing-photos' },
    ...overrides,
  };
}

export interface FakeAppwrite extends AppwriteAdapter {
  accounts: Map<string, AppwriteAccount>;
  credentials: Map<string, string>;
  files: Map<string, { buffer: Buffer; mime: string }>;
  calls: {
    setLabels: { userId: string; labels: string[] }[];
    setUserStatus: { userId: string; enabled: boolean }[];
    uploads: { bucket: string; filename: string; mime: string; size: number; fileId: string }[];
  };
  /** Register an account and return the Bearer token that resolves to it. */
  register(account: AppwriteAccount, password?: string): string;
  reachable: boolean;
}

export function makeFakeAppwrite(): FakeAppwrite {
  const fake: FakeAppwrite = {
    accounts: new Map(),
    credentials: new Map(),
    files: new Map(),
    calls: { setLabels: [], setUserStatus: [], uploads: [] },
    reachable: true,
    register(account, password = 'Password123!') {
      const token = `jwt_${randomUUID()}`;
      fake.accounts.set(token, account);
      fake.credentials.set(account.email, password);
      return token;
    },
    async accountFromJwt(jwt) {
      return jwt ? (fake.accounts.get(jwt) ?? null) : null;
    },
    async signInWithPassword(email, password) {
      if (fake.credentials.get(email) !== password) return { error: 'refused', status: 401 };
      const entry = [...fake.accounts.entries()].find(([, account]) => account.email === email);
      return entry ? { jwt: entry[0] } : { error: 'refused', status: 401 };
    },
    async authReachable() {
      return fake.reachable;
    },
    async setLabels(userId, labels) {
      fake.calls.setLabels.push({ userId, labels });
    },
    async setUserStatus(userId, enabled) {
      fake.calls.setUserStatus.push({ userId, enabled });
    },
    async uploadFile(bucket, buffer, filename, mime) {
      const fileId = `file_${randomUUID().slice(0, 8)}`;
      fake.files.set(`${bucket}/${fileId}`, { buffer, mime });
      fake.calls.uploads.push({ bucket, filename, mime, size: buffer.length, fileId });
      return fileId;
    },
    async downloadFile(bucket, fileId) {
      return fake.files.get(`${bucket}/${fileId}`) ?? null;
    },
  };
  return fake;
}

export function makeApp(configOverrides: Partial<Config> = {}) {
  const { db } = testDb();
  const appwrite = makeFakeAppwrite();
  const config = testConfig(configOverrides);
  const app = createApp({ db, appwrite, config });
  const deps: AppDeps = { db, appwrite, config, handoff: createHandoffCodes(config.handoffSecret) };

  const authed = (token?: string) => {
    const agent = request(app);
    const withAuth = <T extends request.Test>(test: T): T => (token ? (test.set('Authorization', `Bearer ${token}`) as T) : test);
    return {
      get: (path: string) => withAuth(agent.get(path)),
      post: (path: string) => withAuth(agent.post(path)),
      patch: (path: string) => withAuth(agent.patch(path)),
      put: (path: string) => withAuth(agent.put(path)),
      delete: (path: string) => withAuth(agent.delete(path)),
    };
  };

  return { app, db, appwrite, config, deps, authed, anon: () => authed() };
}

/** A bare Express app with only the given routes, for testing middleware in isolation. */
export function makeMiniApp(register: (app: express.Express) => void, config: Config = testConfig()) {
  const app = express();
  app.use(express.json());
  register(app);
  app.use(notFoundHandler);
  app.use(errorHandler(config));
  return app;
}

let counter = 0;
const nextEmail = (prefix: string) => `${prefix}${(counter += 1)}@test.potli`;

export interface UserFixture {
  profile: ProfileRow;
  token: string;
  account: AppwriteAccount;
}

async function createUser(
  appwrite: FakeAppwrite,
  role: Role,
  options: { email?: string; fullName?: string; verified?: boolean; disabled?: boolean; phone?: string } = {},
): Promise<UserFixture> {
  const { db } = testDb();
  const email = options.email ?? nextEmail(role);
  const account: AppwriteAccount = {
    $id: `aw_${randomUUID()}`,
    email,
    name: options.fullName ?? `Test ${role}`,
    labels: [LABEL_BY_ROLE[role]],
    emailVerification: options.verified ?? true,
  };
  const [profile] = await db
    .insert(profiles)
    .values({
      appwriteUserId: account.$id,
      email,
      fullName: account.name,
      phone: options.phone ?? '',
      role,
      isDisabled: options.disabled ?? false,
    })
    .returning();
  if (!profile) throw new Error('profile not created');
  return { profile, account, token: appwrite.register(account) };
}

export const createTraveler = (appwrite: FakeAppwrite, options?: Parameters<typeof createUser>[2]) =>
  createUser(appwrite, 'traveler', options);

export const createAdmin = (appwrite: FakeAppwrite, options?: Parameters<typeof createUser>[2]) =>
  createUser(appwrite, 'admin', options);

export async function createPartner(
  appwrite: FakeAppwrite,
  options: Parameters<typeof createUser>[2] & { status?: PartnerStatus; businessName?: string } = {},
): Promise<UserFixture> {
  const { db } = testDb();
  const user = await createUser(appwrite, 'storage_partner', options);
  await db.insert(partnerProfiles).values({
    userId: user.profile.id,
    businessName: options.businessName ?? 'Test Storage',
    phone: '+919876543210',
    businessType: 'shop',
    address: '1 Test Road',
    city: 'Patiala',
    status: options.status ?? 'approved',
  });
  return user;
}

export async function createListing(partnerId: string, overrides: Partial<typeof listings.$inferInsert> = {}): Promise<ListingRow> {
  const { db } = testDb();
  const [row] = await db
    .insert(listings)
    .values({
      partnerId,
      name: `Listing ${(counter += 1)}`,
      address: '1 Test Road',
      area: 'Centre',
      city: 'Patiala',
      latitude: 30.33,
      longitude: 76.39,
      capacity: 10,
      hourlyRatePaise: 5000,
      dailyCapPaise: 40000,
      openTime: '08:00',
      closeTime: '22:00',
      ...overrides,
    })
    .returning();
  if (!row) throw new Error('listing not created');
  return row;
}

/** A slot at `startHour` IST on a day `daysAhead` from now, lasting `hours`; inside default opening hours. */
export function istSlot(daysAhead = 1, startHour = 10, hours = 4): { start: Date; end: Date } {
  const istNow = new Date(Date.now() + 330 * 60_000);
  const startUtc = Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate() + daysAhead, startHour, 0) - 330 * 60_000;
  return { start: new Date(startUtc), end: new Date(startUtc + hours * 3_600_000) };
}

export async function createBookingFor(
  travelerId: string,
  listingId: string,
  overrides: Partial<CreateBookingInput> = {},
): Promise<BookingRow> {
  const { db } = testDb();
  const slot = istSlot();
  const { booking } = await createBookingRow(db, {
    travelerId,
    listingId,
    bagCount: 1,
    slotStart: slot.start,
    slotEnd: slot.end,
    ...overrides,
  });
  return booking;
}

export async function setBookingStatus(bookingId: string, status: BookingRow['status']): Promise<void> {
  const { db } = testDb();
  const { eq } = await import('../../db/orm.ts');
  await db.update(bookings).set({ status }).where(eq(bookings.id, bookingId));
}
