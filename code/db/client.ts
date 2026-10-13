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

export interface CreateDbOptions {
  /** Supplies the password for each new connection (the catcher's short-lived token). */
  password?: () => Promise<string>;
}

export function createDb(connectionString: string, options: CreateDbOptions = {}): { pool: DbPool; db: Database } {
  const proxy = DATABASE_WS_PROXY ? parseWsProxy(DATABASE_WS_PROXY) : null;

  if (proxy) {
    neonConfig.useSecureWebSocket = proxy.secure;
    neonConfig.wsProxy = () => proxy.target;
    // The catcher requires the standard Postgres authentication handshake.
    neonConfig.pipelineConnect = false;
    neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;

    // A password provider needs explicit fields: pg lets a connection string override them.
    const url = new URL(connectionString);
    const pool = options.password
      ? new NeonPool({
          host: url.hostname,
          port: Number(url.port) || 5432,
          user: decodeURIComponent(url.username),
          database: url.pathname.slice(1),
          password: options.password,
          idleTimeoutMillis: 60_000, // close before the tunnel drops an idle socket
        })
      : new NeonPool({ connectionString });
    // Unhandled idle-client errors would terminate the process.
    pool.on('error', (err: Error) => console.error('idle database client error:', err.message));
    if (options.password) {
      // A cold reconnect through the tunnel costs ~2 s, so keep one connection warm.
      setInterval(() => void pool.query('select 1').catch(() => undefined), 40_000).unref();
    }
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
    // Cloudflare answers 530 with an HTML page when the homelab tunnel is down.
    const detail = session.status === 530 ? 'Appwrite is unreachable (Cloudflare tunnel down)' : (await session.text()).slice(0, 200);
    throw new Error(`Appwrite refused the database account (${session.status}): ${detail}`);
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

/**
 * Use an Appwrite JWT as the password for WebSocket connections; leave TCP credentials unchanged.
 * The JWT lasts 15 minutes and the pool opens new connections whenever idle ones close, so the
 * token is re-minted per connection (reused for 10 minutes), not once at startup.
 */
export async function createDbWithToken(
  connectionString: string,
): Promise<{ pool: DbPool; db: Database }> {
  if (!DATABASE_WS_PROXY) return createDb(connectionString);

  let cached: { token: string; at: number } | null = null;
  const currentToken = async (): Promise<string> => {
    if (!cached || Date.now() - cached.at > 10 * 60_000) cached = { token: await mintDatabaseToken(), at: Date.now() };
    return cached.token;
  };
  await currentToken(); // fail fast at startup when Appwrite is unreachable
  return createDb(connectionString, { password: currentToken });
}
