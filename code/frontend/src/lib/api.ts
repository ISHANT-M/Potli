/** Typed API client: Bearer JWT from the Appwrite session, error envelope parsing, one retry on 401. */
import type { ApiError } from '../../../shared/types';

export const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';
const JWT_MAX_AGE_MS = 10 * 60_000;

export class ApiRequestError extends Error {
  status: number;
  code: string;
  fields: Record<string, string>;

  constructor(status: number, code: string, message: string, fields: Record<string, string> = {}) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export interface ApiOptions {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  form?: FormData;
  idempotencyKey?: string;
  signal?: AbortSignal;
  /** `auto` sends a token only when someone is signed in; `required` always mints one. */
  auth?: 'auto' | 'required' | 'none';
}

export interface ApiClientDeps {
  baseUrl: string;
  /** Mint a fresh JWT, or throw when there is no session. */
  mintToken: () => Promise<string>;
  fetchFn?: typeof fetch;
  now?: () => number;
}

const NETWORK_MESSAGE = 'Could not reach Potli. Check your connection and try again.';

export function parseErrorBody(status: number, body: unknown): ApiRequestError {
  const envelope = (body as Partial<ApiError> | null)?.error;
  if (envelope && typeof envelope.code === 'string') {
    return new ApiRequestError(status, envelope.code, envelope.message ?? 'Something went wrong.', envelope.fields ?? {});
  }
  return new ApiRequestError(status, status >= 500 ? 'INTERNAL' : 'UNKNOWN', 'Something went wrong. Please try again.');
}

export function createApiClient(deps: ApiClientDeps) {
  const fetchFn = deps.fetchFn ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const now = deps.now ?? Date.now;
  let cached: { token: string; at: number } | null = null;
  let sessionHint = false;

  async function token(force: boolean): Promise<string> {
    if (!force && cached && now() - cached.at < JWT_MAX_AGE_MS) return cached.token;
    try {
      cached = { token: await deps.mintToken(), at: now() };
    } catch {
      cached = null;
      throw new ApiRequestError(401, 'UNAUTHENTICATED', 'Please sign in to continue.');
    }
    return cached.token;
  }

  function buildUrl(path: string, query?: ApiOptions['query']): string {
    const url = new URL(`${deps.baseUrl}/api/v1${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  async function send(method: string, path: string, options: ApiOptions, forceToken: boolean): Promise<Response> {
    const headers: Record<string, string> = {};
    const mode = options.auth ?? 'auto';
    if (mode === 'required' || (mode === 'auto' && sessionHint)) {
      try {
        headers.Authorization = `Bearer ${await token(forceToken)}`;
      } catch (err) {
        if (mode === 'required') throw err;
      }
    }
    if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
    let body: BodyInit | undefined;
    if (options.form) body = options.form;
    else if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }
    try {
      // Give up on a stalled connection instead of leaving the page loading forever (uploads get longer).
      const signal = options.signal ?? AbortSignal.timeout(options.form ? 60_000 : 20_000);
      return await fetchFn(buildUrl(path, options.query), { method, headers, body, signal });
    } catch (err) {
      if ((err as Error).name === 'AbortError' && options.signal) throw err;
      throw new ApiRequestError(0, 'NETWORK', NETWORK_MESSAGE);
    }
  }

  async function request(method: string, path: string, options: ApiOptions = {}): Promise<Response> {
    let response = await send(method, path, options, false);
    if (response.status === 401 && (options.auth ?? 'auto') !== 'none') {
      cached = null;
      response = await send(method, path, options, true);
    }
    return response;
  }

  async function api<T>(method: string, path: string, options: ApiOptions = {}): Promise<T> {
    const response = await request(method, path, options);
    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    if (!response.ok) throw parseErrorBody(response.status, parsed);
    return parsed as T;
  }

  /** Fetch a private image with the Bearer token and return an object URL for <img src>. */
  async function imageUrl(path: string): Promise<string> {
    const response = await request('GET', path.replace(/^\/api\/v1/, ''), {});
    if (!response.ok) throw parseErrorBody(response.status, null);
    return URL.createObjectURL(await response.blob());
  }

  return {
    api,
    imageUrl,
    /** Forget the cached token (after sign-in, sign-out or email verification). */
    resetToken: () => {
      cached = null;
    },
    setSessionHint: (signedIn: boolean) => {
      sessionHint = signedIn;
    },
  };
}
