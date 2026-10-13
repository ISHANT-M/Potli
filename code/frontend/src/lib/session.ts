/** The signed-in user (Me) as seen by every page, plus sign-out and role home routes. */
import type { Me } from '../../../shared/types';
import { account, appwriteConfigured } from '../appwrite';
import { API_BASE, ApiRequestError, createApiClient } from './api';

const client = createApiClient({
  baseUrl: API_BASE,
  mintToken: async () => {
    if (!appwriteConfigured) throw new Error('Appwrite is not configured');
    return (await account.createJWT()).jwt;
  },
});

export const api = client.api;
export const imageUrl = client.imageUrl;

let current: Me | null = null;
const listeners = new Set<(me: Me | null) => void>();

export const getMe = (): Me | null => current;

export function setMe(me: Me | null): void {
  current = me;
  client.setSessionHint(me !== null);
  listeners.forEach((listener) => listener(me));
}

export function subscribe(listener: (me: Me | null) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Reload Me from the API. A 401 or a disabled account means signed out (null); other
 * failures (API down) throw so callers can say so. `fresh` re-mints the JWT first.
 */
export async function refreshMe(options: { fresh?: boolean } = {}): Promise<Me | null> {
  if (options.fresh) client.resetToken();
  try {
    const { user } = await api<{ user: Me }>('GET', '/auth/me', { auth: 'required' });
    setMe(user);
    return user;
  } catch (err) {
    if (err instanceof ApiRequestError && (err.status === 401 || err.code === 'ACCOUNT_DISABLED' || err.code === 'FORBIDDEN')) {
      setMe(null);
      if (err.code !== 'UNAUTHENTICATED') throw err;
      return null;
    }
    throw err;
  }
}

export async function signOut(): Promise<void> {
  await account.deleteSession({ sessionId: 'current' }).catch(() => undefined); // an expired session is still a sign-out
  client.resetToken();
  setMe(null);
  window.location.hash = '#/';
}

export function resetApiToken(): void {
  client.resetToken();
}

/** Where a signed-in user lands: their portal home. */
export function homeFor(me: Me): string {
  if (me.role === 'admin') return '#/admin';
  if (me.role === 'storage_partner') return me.partner?.status === 'approved' ? '#/partner/dashboard' : '#/partner/application';
  return '#/app';
}
