/** Appwrite access for the API: JWT lookups, server-side sign-in, labels, user status and file storage. */
import { createHash } from 'node:crypto';
import type { Role } from '../../db/schema.ts';
import type { Config } from './config.ts';

export interface AppwriteAccount {
  $id: string;
  email: string;
  name: string;
  labels?: string[];
  emailVerification?: boolean;
}

export type SignInResult = { jwt: string } | { error: string; status: number };

export interface AppwriteAdapter {
  /** Resolve the account a JWT belongs to, or null when it is invalid or expired. */
  accountFromJwt(jwt: string | null): Promise<AppwriteAccount | null>;
  /** Server-side sign-in for API clients; the browser uses the Web SDK. */
  signInWithPassword(email: string, password: string): Promise<SignInResult>;
  authReachable(): Promise<boolean>;
  setLabels(userId: string, labels: string[]): Promise<void>;
  setUserStatus(userId: string, enabled: boolean): Promise<void>;
  /** Store a file in a private bucket and return its file id. */
  uploadFile(bucket: string, buffer: Buffer, filename: string, mime: string): Promise<string>;
  downloadFile(bucket: string, fileId: string): Promise<{ buffer: Buffer; mime: string } | null>;
}

// Appwrite labels are alphanumeric; the database enum uses snake_case.
const ROLE_BY_LABEL: Record<string, Role> = {
  traveler: 'traveler',
  storagePartner: 'storage_partner',
  admin: 'admin',
};

export const LABEL_BY_ROLE: Record<Role, string> = {
  traveler: 'traveler',
  storage_partner: 'storagePartner',
  admin: 'admin',
};

/** The infrastructure account is never a Potli user (code/ARCHITECTURE.md). */
export const INFRA_LABEL = 'infra';

export function roleFromLabels(labels: string[] = []): Role {
  for (const label of labels) {
    const role = ROLE_BY_LABEL[label];
    if (role) return role;
  }
  return 'traveler';
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Appwrite returned non-JSON (${response.status})`);
  }
}

export function createAppwriteAdapter(
  config: Pick<Config, 'appwriteEndpoint' | 'appwriteProjectId' | 'appwriteApiKey'>,
): AppwriteAdapter {
  const endpoint = config.appwriteEndpoint;

  const baseHeaders = (extra: Record<string, string> = {}): Record<string, string> => ({
    'X-Appwrite-Project': config.appwriteProjectId,
    ...extra,
  });
  const jsonHeaders = (extra: Record<string, string> = {}) => baseHeaders({ 'Content-Type': 'application/json', ...extra });
  const keyHeaders = (extra: Record<string, string> = {}) => baseHeaders({ 'X-Appwrite-Key': config.appwriteApiKey, ...extra });

  async function serverCall(method: string, path: string, body?: unknown): Promise<Response> {
    return fetch(`${endpoint}${path}`, {
      method,
      headers: body === undefined ? keyHeaders() : keyHeaders({ 'Content-Type': 'application/json' }),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  }

  // Appwrite sits behind a tunnel (0.2-1 s per call), so a verified token is remembered briefly.
  // Concurrent lookups for one token share a single request; failures are never cached.
  // Disabled accounts are still refused at once because that check reads Postgres per request.
  const JWT_CACHE_MS = 60_000;
  const JWT_CACHE_MAX = 500;
  const verified = new Map<string, { account: Promise<AppwriteAccount | null>; expires: number }>();

  async function lookupAccount(jwt: string): Promise<AppwriteAccount | null> {
    try {
      const response = await fetch(`${endpoint}/account`, {
        headers: jsonHeaders({ 'X-Appwrite-JWT': jwt }),
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) return null;
      return await readJson<AppwriteAccount>(response);
    } catch {
      return null;
    }
  }

  return {
    async accountFromJwt(jwt) {
      if (!jwt) return null;
      const key = createHash('sha256').update(jwt).digest('hex');
      const hit = verified.get(key);
      if (hit && hit.expires > Date.now()) return hit.account;

      const account = lookupAccount(jwt);
      verified.set(key, { account, expires: Date.now() + JWT_CACHE_MS });
      if (verified.size > JWT_CACHE_MAX) verified.delete(verified.keys().next().value as string);
      void account.then((result) => {
        if (!result && verified.get(key)?.account === account) verified.delete(key);
      });
      return account;
    },

    /** Appwrite 2.x returns the session secret only in Set-Cookie, so carry it into the JWT request. */
    async signInWithPassword(email, password) {
      const session = await fetch(`${endpoint}/account/sessions/email`, {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ email, password }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!session.ok) return { error: 'Sign-in was refused.', status: session.status };

      const sessionCookie = session.headers
        .getSetCookie()
        .map((cookie) => cookie.split(';')[0] ?? '')
        .find((cookie) => cookie.startsWith('a_session_'));
      if (!sessionCookie) return { error: 'No session was returned.', status: 502 };

      const response = await fetch(`${endpoint}/account/jwts`, {
        method: 'POST',
        headers: jsonHeaders({ Cookie: sessionCookie }),
        body: '{}',
        signal: AbortSignal.timeout(10_000),
      });
      const body = await readJson<{ jwt?: string }>(response);
      if (!response.ok || !body.jwt) return { error: 'Could not create a token.', status: 502 };
      return { jwt: body.jwt };
    },

    /** /health/version is public; /health requires a scoped API key. */
    async authReachable() {
      try {
        const response = await fetch(`${endpoint}/health/version`, {
          headers: baseHeaders(),
          signal: AbortSignal.timeout(8_000),
        });
        return response.ok;
      } catch {
        return false;
      }
    },

    async setLabels(userId, labels) {
      const response = await serverCall('PUT', `/users/${encodeURIComponent(userId)}/labels`, { labels });
      if (!response.ok) throw new Error(`Appwrite could not update labels (${response.status})`);
    },

    async setUserStatus(userId, enabled) {
      const response = await serverCall('PATCH', `/users/${encodeURIComponent(userId)}/status`, { status: enabled });
      if (!response.ok) throw new Error(`Appwrite could not update the user status (${response.status})`);
    },

    async uploadFile(bucket, buffer, filename, mime) {
      const form = new FormData();
      form.append('fileId', 'unique()');
      form.append('file', new Blob([new Uint8Array(buffer)], { type: mime }), filename);
      const response = await fetch(`${endpoint}/storage/buckets/${encodeURIComponent(bucket)}/files`, {
        method: 'POST',
        headers: keyHeaders(),
        body: form,
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`Appwrite storage upload failed (${response.status})`);
      const body = await readJson<{ $id: string }>(response);
      return body.$id;
    },

    async downloadFile(bucket, fileId) {
      const response = await fetch(
        `${endpoint}/storage/buckets/${encodeURIComponent(bucket)}/files/${encodeURIComponent(fileId)}/download`,
        { headers: keyHeaders(), signal: AbortSignal.timeout(30_000) },
      );
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Appwrite storage download failed (${response.status})`);
      return {
        buffer: Buffer.from(await response.arrayBuffer()),
        mime: response.headers.get('content-type') ?? 'application/octet-stream',
      };
    },
  };
}
