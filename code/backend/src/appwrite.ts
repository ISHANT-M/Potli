/** Appwrite session creation and JWT verification for API clients. */
import { APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, requireEnv } from './config.ts';
import type { Profile } from '../../db/profiles.ts';
import type { Role } from '../../db/schema.ts';

requireEnv([
  ['APPWRITE_ENDPOINT', APPWRITE_ENDPOINT],
  ['APPWRITE_PROJECT_ID', APPWRITE_PROJECT_ID],
]);

export interface PublicUser {
  id: string | null;
  email: string;
  full_name: string;
  role: Role;
}

export interface AppwriteAccount {
  $id: string;
  email: string;
  name: string;
  labels?: string[];
}

// Appwrite labels are alphanumeric; the database enum uses snake_case.
const ROLE_BY_LABEL: Record<string, Role> = {
  traveler: 'traveler',
  storagePartner: 'storage_partner',
  admin: 'admin',
};

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Appwrite-Project': APPWRITE_PROJECT_ID,
    ...extra,
  };
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Appwrite returned non-JSON (${response.status}): ${text.slice(0, 200)}`);
  }
}

export async function accountFromJwt(jwt: string | null): Promise<AppwriteAccount | null> {
  if (!jwt) return null;
  try {
    const response = await fetch(`${APPWRITE_ENDPOINT}/account`, {
      headers: headers({ 'X-Appwrite-JWT': jwt }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null;
    return await readJson<AppwriteAccount>(response);
  } catch {
    return null;
  }
}

/** Appwrite 2.x requires the session's Set-Cookie value to mint a JWT. */
export async function signInWithPassword(
  email: string,
  password: string,
): Promise<{ jwt: string } | { error: string }> {
  const session = await fetch(`${APPWRITE_ENDPOINT}/account/sessions/email`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(10_000),
  });
  const sessionBody = await readJson<{ message?: string }>(session);
  if (!session.ok) {
    return { error: sessionBody.message ?? 'Invalid email or password.' };
  }

  const sessionCookie = session.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0] ?? '')
    .find((cookie) => cookie.startsWith('a_session_'));
  if (!sessionCookie) {
    return { error: 'Appwrite did not return a session cookie.' };
  }

  const jwt = await fetch(`${APPWRITE_ENDPOINT}/account/jwts`, {
    method: 'POST',
    headers: headers({ Cookie: sessionCookie }),
    body: '{}',
    signal: AbortSignal.timeout(10_000),
  });
  const jwtBody = await readJson<{ jwt?: string; message?: string }>(jwt);
  if (!jwt.ok || !jwtBody.jwt) {
    return { error: jwtBody.message ?? 'Could not create a token for that session.' };
  }
  return { jwt: jwtBody.jwt };
}

/** /health/version is public; /health requires a scoped API key. */
export async function authReachable(): Promise<boolean> {
  try {
    const response = await fetch(`${APPWRITE_ENDPOINT}/health/version`, {
      headers: { 'X-Appwrite-Project': APPWRITE_PROJECT_ID },
      signal: AbortSignal.timeout(8_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function roleFromLabels(labels: string[] = []): Role {
  for (const label of labels) {
    const role = ROLE_BY_LABEL[label];
    if (role) return role;
  }
  return 'traveler';
}

export function toPublicUser(profile: Profile | null, account: AppwriteAccount | null): PublicUser {
  return {
    id: profile?.id ?? null,
    email: profile?.email ?? account?.email ?? '',
    full_name: profile?.fullName || account?.name || '',
    role: profile?.role ?? roleFromLabels(account?.labels),
  };
}
