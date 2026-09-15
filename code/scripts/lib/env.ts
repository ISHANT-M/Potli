/**
 * Shared .env reading for the dev scripts (setup + dev).
 *
 * Only unambiguous local checks live here: whether a key exists and whether its
 * value is still the .env.example template. A value that is present but wrong is
 * handed to pg as-is, because Postgres reports the real reason far better than
 * any local check could.
 *
 * Node runs this file directly through its native TypeScript support (types are
 * stripped at load).
 */
import fs from 'node:fs';
import path from 'node:path';

/** The one connection string the project uses. */
export const DB_URL_KEYS = ['SUPABASE_DB_URL'];

/** Any one of these means Supabase Auth is configured for the backend. */
export const SUPABASE_URL_KEYS = ['SUPABASE_URL'];
export const SUPABASE_ANON_KEYS = ['SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY'];

// The templates ship in .env.example as "postgres.PROJECT-REF:..." (Supabase).
const PLACEHOLDER = /(PROJECT-REF|PASSWORD@)/;

export type ConnectionState = 'configured' | 'missing-env' | 'missing-key' | 'empty' | 'placeholder';

export interface ConnectionInfo {
  state: ConnectionState;
  file: string;
  where?: string;
  key?: string;
  value?: string;
}

export function readEnvValue(dir: string, key: string): string | null {
  const file = path.join(dir, '.env');
  if (!fs.existsSync(file)) return null;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (match?.[1] === key) return (match[2] ?? '').trim().replace(/^["']|["']$/g, '');
  }
  return null;
}

/** True when the key is absent, empty, or still the .env.example template. */
export function isPlaceholderValue(value: string | null): boolean {
  return !value || PLACEHOLDER.test(value);
}

/**
 * Which Postgres connection string the backend will use, and why it is (not)
 * usable yet. `where` is an absolute "path:line" reference for messages.
 */
export function inspectConnectionEnv(backendDir: string): ConnectionInfo {
  const file = path.join(backendDir, '.env');
  if (!fs.existsSync(file)) return { state: 'missing-env', file };

  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const found: { key: string; line: number; value: string }[] = [];
  for (const key of DB_URL_KEYS) {
    const index = lines.findIndex((line) => new RegExp(`^\\s*${key}\\s*=`).test(line));
    if (index === -1) continue;
    const raw = (lines[index] ?? '').replace(new RegExp(`^\\s*${key}\\s*=\\s*`), '').trim();
    found.push({ key, line: index + 1, value: raw.replace(/^["']|["']$/g, '') });
  }
  if (found.length === 0) return { state: 'missing-key', file };

  const real = found.find((entry) => !isPlaceholderValue(entry.value));
  const primary = real ?? found[0];
  if (!primary) return { state: 'missing-key', file };
  const where = `${file}:${primary.line}`;
  const base = { file, where, key: primary.key };

  if (real) return { state: 'configured', ...base, value: real.value };
  if (!primary.value) return { state: 'empty', ...base };
  return { state: 'placeholder', ...base };
}
