/** Shared Drizzle pools: TCP or WebSocket with Appwrite JWT authentication. */
import { neonConfig, Pool as NeonPool } from '@neondatabase/serverless';
import { drizzle as drizzleNeon } from 'drizzle-orm/neon-serverless';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import pg from 'pg';
import ws from 'ws';
import {
  APPWRITE_ENDPOINT,
  APPWRITE_PROJECT_ID,
  DATABASE_WS_PROXY,
  POTLI_DB_EMAIL,
  POTLI_DB_PASSWORD,
} from './env.ts';
import * as schema from './schema.ts';

export type Database = PgDatabase<never, typeof schema>;

export interface DbClient {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
  release(): void;
}

export interface DbPool {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
  connect(): Promise<DbClient>;
  end(): Promise<void>;
}

function wantsSsl(connectionString: string): boolean {
  return /[?&]sslmode=(require|verify-ca|verify-full)/.test(connectionString);
}

function parseWsProxy(value: string): { target: string; secure: boolean } | null {
  try {
    const url = new URL(value.includes('://') ? value : `wss://${value}`);
    return { target: `${url.host}${url.pathname.replace(/\/$/, '')}`, secure: url.protocol === 'wss:' };
  } catch {
    return null;
  }
}

export function createDb(connectionString: string): { pool: DbPool; db: Database } {
  const proxy = DATABASE_WS_PROXY ? parseWsProxy(DATABASE_WS_PROXY) : null;

  if (proxy) {
    neonConfig.useSecureWebSocket = proxy.secure;
    neonConfig.wsProxy = () => proxy.target;
    // The catcher requires the standard Postgres authentication handshake.
    neonConfig.pipelineConnect = false;
    neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;

    const pool = new NeonPool({ connectionString });
    return { pool, db: drizzleNeon(pool, { schema }) as unknown as Database };
  }

  const pool = new pg.Pool({
    connectionString,
    ...(wantsSsl(connectionString) ? { ssl: { rejectUnauthorized: false } } : {}),
  });

  // Unhandled idle-client errors would terminate the process.
  pool.on('error', (err) => console.error('idle database client error:', err.message));

  return { pool, db: drizzle(pool, { schema }) as unknown as NodePgDatabase<typeof schema> & Database };
}

/** Mint the infrastructure JWT used as the catcher's Postgres password. */
export async function mintDatabaseToken(): Promise<string> {
  if (!POTLI_DB_EMAIL || !POTLI_DB_PASSWORD) {
    throw new Error(
      'POTLI_DB_EMAIL and POTLI_DB_PASSWORD are required to reach the database through the catcher (see backend/.env.example).',
    );
  }
  if (!APPWRITE_ENDPOINT || !APPWRITE_PROJECT_ID) {
    throw new Error('APPWRITE_ENDPOINT and APPWRITE_PROJECT_ID are required to mint the database token.');
  }

  const session = await fetch(`${APPWRITE_ENDPOINT}/account/sessions/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Appwrite-Project': APPWRITE_PROJECT_ID },
    body: JSON.stringify({ email: POTLI_DB_EMAIL, password: POTLI_DB_PASSWORD }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!session.ok) {
    throw new Error(`Appwrite refused the database account (${session.status}): ${await session.text()}`);
  }

  // Appwrite 2.x returns the session secret only in Set-Cookie.
  const cookie = session.headers
    .getSetCookie()
    .map((value) => value.split(';')[0] ?? '')
    .find((value) => value.startsWith('a_session_'));
  if (!cookie) throw new Error('Appwrite did not return a session cookie.');

  const token = await fetch(`${APPWRITE_ENDPOINT}/account/jwts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Appwrite-Project': APPWRITE_PROJECT_ID, Cookie: cookie },
    body: '{}',
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await token.json()) as { jwt?: string; message?: string };
  if (!token.ok || !body.jwt) throw new Error(body.message ?? 'Appwrite did not return a JWT.');
  return body.jwt;
}

/** Use an Appwrite JWT for WebSocket connections; leave TCP credentials unchanged. */
export async function createDbWithToken(
  connectionString: string,
): Promise<{ pool: DbPool; db: Database }> {
  if (!DATABASE_WS_PROXY) return createDb(connectionString);

  const token = await mintDatabaseToken();
  const url = new URL(connectionString);
  url.password = token;
  return createDb(url.toString());
}
