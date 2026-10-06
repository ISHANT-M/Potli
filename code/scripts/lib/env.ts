/** Shared env checks for setup and dev; connection errors come from Postgres. */
import fs from 'node:fs';
import path from 'node:path';

export const DB_URL_KEYS = ['DATABASE_URL'];

export const APPWRITE_ENDPOINT_KEYS = ['APPWRITE_ENDPOINT'];
export const APPWRITE_PROJECT_KEYS = ['APPWRITE_PROJECT_ID'];
export const FRONTEND_APPWRITE_ENDPOINT_KEYS = ['VITE_APPWRITE_ENDPOINT'];
export const FRONTEND_APPWRITE_PROJECT_KEYS = ['VITE_APPWRITE_PROJECT_ID'];

const PLACEHOLDER = /(PASSWORD@|^$)/;

export type ConnectionState = 'configured' | 'missing-env' | 'missing-key' | 'empty' | 'placeholder';

export interface ConnectionInfo {
  state: ConnectionState;
  file: string;
  where?: string;
  key?: string;
  value?: string;
}

export function readEnvValue(dir: string, keys: string | string[]): string | null {
  const wanted = Array.isArray(keys) ? keys : [keys];
  const file = path.join(dir, '.env');
  if (!fs.existsSync(file)) return null;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (match?.[1] && wanted.includes(match[1])) return (match[2] ?? '').trim().replace(/^["']|["']$/g, '');
  }
  return null;
}


export function isPlaceholderValue(value: string | null): boolean {
  return !value || PLACEHOLDER.test(value);
}

/** Report connection configuration with path:line references. */
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
