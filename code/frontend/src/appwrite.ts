/** Browser sessions and password recovery through Appwrite. */
import { Account, Client, ID } from 'appwrite';

export { ID };

const endpoint = import.meta.env.VITE_APPWRITE_ENDPOINT as string | undefined;
const projectId = import.meta.env.VITE_APPWRITE_PROJECT_ID as string | undefined;

export const appwriteConfigured = Boolean(endpoint && projectId);

const client = new Client();
if (endpoint) client.setEndpoint(endpoint);
if (projectId) client.setProject(projectId);

export const account = new Account(client);

// Read recovery credentials before rendering the reset form.
const recoveryParams = new URLSearchParams(window.location.search);

export const recoveryLink = (() => {
  if (recoveryParams.get('flow') === 'verify') return null;
  const userId = recoveryParams.get('userId');
  const secret = recoveryParams.get('secret');
  return userId && secret ? { userId, secret } : null;
})();

/** Remove the spent recovery secret from the URL. */
export function clearRecoveryLink(): void {
  if (!recoveryLink) return;
  const url = new URL(window.location.href);
  url.searchParams.delete('userId');
  url.searchParams.delete('secret');
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}

/** Email-verification credentials from `?flow=verify&userId&secret`; cleared once used. */
export const verifyLink = (() => {
  if (recoveryParams.get('flow') !== 'verify') return null;
  const userId = recoveryParams.get('userId');
  const secret = recoveryParams.get('secret');
  return userId && secret ? { userId, secret } : null;
})();

export function clearVerifyLink(): void {
  if (!verifyLink) return;
  const url = new URL(window.location.href);
  for (const key of ['flow', 'userId', 'secret']) url.searchParams.delete(key);
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}
