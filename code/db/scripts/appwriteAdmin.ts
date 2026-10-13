/** Server-side Appwrite REST helper shared by the seed and the bucket bootstrap. */
import { requireAppwrite } from '../env.ts';

export interface AppwriteConfig {
  endpoint: string;
  projectId: string;
  apiKey: string;
}

export function appwriteConfig(): AppwriteConfig {
  return requireAppwrite();
}

export function appwriteCall(config: AppwriteConfig, method: string, path: string, body?: unknown): Promise<Response> {
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
    signal: AbortSignal.timeout(20_000),
  });
}

export async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Appwrite returned non-JSON (${response.status}): ${text.slice(0, 200)}`);
  }
}
