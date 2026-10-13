/** Admin sessions end after 15 minutes without activity; the login page shows a notice afterwards. */
import { signOut } from '../../lib/session';

const IDLE_MS = 15 * 60_000;
const FLAG = 'potli.adminIdle';
const EVENTS = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const;

export function takeAdminIdleFlag(): boolean {
  try {
    const set = sessionStorage.getItem(FLAG) === '1';
    sessionStorage.removeItem(FLAG);
    return set;
  } catch {
    return false;
  }
}

/** Start watching; the returned function stops it (called when leaving the admin portal). */
export function startIdleWatch(): () => void {
  let timer = window.setTimeout(expire, IDLE_MS);
  function expire(): void {
    try {
      sessionStorage.setItem(FLAG, '1');
    } catch {
      // the notice is optional
    }
    void signOut().then(() => {
      window.location.hash = '#/admin/login';
    });
  }
  const reset = (): void => {
    window.clearTimeout(timer);
    timer = window.setTimeout(expire, IDLE_MS);
  };
  EVENTS.forEach((name) => window.addEventListener(name, reset, { passive: true }));
  return () => {
    window.clearTimeout(timer);
    EVENTS.forEach((name) => window.removeEventListener(name, reset));
  };
}
