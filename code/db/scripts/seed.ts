/** Seed Appwrite accounts, then their Postgres profiles. */
import { createDbWithToken } from '../client.ts';
import {
  DATABASE_URL,
  DEV_SEED_PASSWORD,
  requireAppwrite,
  requireDatabaseUrl,
} from '../env.ts';
import { upsertPartnerProfile, upsertProfile } from '../profiles.ts';
import type { Role } from '../schema.ts';

interface DevUser {
  email: string;
  fullName: string;
  role: Role;
  label: string;
  businessName?: string;
  phone?: string;
}

const DEV_USERS: DevUser[] = [
  { email: 'aanshaj_be24@thapar.edu', fullName: 'Anshaj', role: 'traveler', label: 'traveler' },
  { email: 'abindal1_be24@thapar.edu', fullName: 'Aayush Bindal', role: 'traveler', label: 'traveler' },
  {
    email: 'stiwari1_be24@thapar.edu',
    fullName: 'Satyam Tiwari',
    role: 'storage_partner',
    label: 'storagePartner',
    businessName: 'Satyam Storage',
    phone: '+91 95803 80494',
  },
  { email: 'imehndiratta_be24@thapar.edu', fullName: 'Ishant Mehndiratta', role: 'admin', label: 'admin' },
];

interface AppwriteConfig {
  endpoint: string;
  projectId: string;
  apiKey: string;
}

function appwriteCall(config: AppwriteConfig, method: string, path: string, body?: unknown) {
  // Appwrite rejects bodyless GETs carrying Content-Type.
  const headers: Record<string, string> = {
    'X-Appwrite-Project': config.projectId,
    'X-Appwrite-Key': config.apiKey,
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  return fetch(`${config.endpoint}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Appwrite returned non-JSON (${response.status}): ${text.slice(0, 200)}`);
  }
}

interface AppwriteUser {
  $id: string;
  email: string;
  name: string;
  labels: string[];
}

async function findUserByEmail(config: AppwriteConfig, email: string): Promise<AppwriteUser | null> {
  const response = await appwriteCall(config, 'GET', '/users?limit=100');
  if (!response.ok) throw new Error(`listing users failed: ${await response.text()}`);
  const body = await readJson<{ users: AppwriteUser[] }>(response);
  return body.users.find((user) => user.email === email) ?? null;
}

async function upsertAuthUser(config: AppwriteConfig, spec: DevUser): Promise<AppwriteUser> {
  const existing = await findUserByEmail(config, spec.email);
  if (!existing) {
    const response = await appwriteCall(config, 'POST', '/users', {
      userId: 'unique()',
      email: spec.email,
      password: DEV_SEED_PASSWORD,
      name: spec.fullName,
    });
    if (!response.ok) throw new Error(`creating ${spec.email} failed: ${await response.text()}`);
    return readJson<AppwriteUser>(response);
  }

  // Restore the dev password after recovery tests.
  const resetPassword = await appwriteCall(config, 'PATCH', `/users/${existing.$id}/password`, {
    password: DEV_SEED_PASSWORD,
  });
  if (!resetPassword.ok) {
    throw new Error(`restoring the password for ${spec.email} failed: ${await resetPassword.text()}`);
  }
  return existing;
}

async function applyLabelAndVerification(config: AppwriteConfig, user: AppwriteUser, spec: DevUser): Promise<void> {
  // Replace labels with the app role only; never grant infrastructure access.
  const label = await appwriteCall(config, 'PUT', `/users/${user.$id}/labels`, { labels: [spec.label] });
  if (!label.ok) throw new Error(`label for ${spec.email} failed: ${await label.text()}`);

  // An empty verification body succeeds without changing the flag.
  const verification = await appwriteCall(config, 'PATCH', `/users/${user.$id}/verification`, {
    emailVerification: true,
  });
  if (!verification.ok) throw new Error(`verification for ${spec.email} failed: ${await verification.text()}`);
}

async function main(): Promise<void> {
  requireDatabaseUrl();
  const config = requireAppwrite();
  const { pool, db } = await createDbWithToken(DATABASE_URL);

  try {
    for (const spec of DEV_USERS) {
      const user = await upsertAuthUser(config, spec);
      await applyLabelAndVerification(config, user, spec);

      const profile = await upsertProfile(db, {
        appwriteUserId: user.$id,
        email: spec.email,
        fullName: spec.fullName,
        role: spec.role,
      });
      if (spec.role === 'storage_partner') {
        await upsertPartnerProfile(db, {
          userId: profile.id,
          businessName: spec.businessName ?? '',
          phone: spec.phone ?? '',
        });
      }
      console.log(`seeded ${spec.email} (${spec.role}, label ${spec.label}, appwrite ${user.$id})`);
    }

    console.log(`\n${DEV_USERS.length} dev accounts ready; password: ${DEV_SEED_PASSWORD}`);
  } finally {
    await pool.end();
  }
}

try {
  await main();
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
