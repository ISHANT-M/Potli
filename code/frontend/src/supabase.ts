import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** True when .env supplies the Supabase project; the UI shows a hint if not. */
export const supabaseConfigured = Boolean(url && anonKey);

// A password-reset link arrives as #access_token=...&type=recovery, and
// supabase-js consumes and clears that hash as it creates the client. Read the
// signal first so the app can route to the new-password form instead of the
// dashboard once the recovery session exists.
const initialHashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
export const arrivingFromRecoveryLink =
  initialHashParams.get('type') === 'recovery' ||
  /(^|[#&?])type=recovery(&|=|$)/.test(window.location.href) ||
  new URLSearchParams(window.location.search).has('code');

// A used or expired reset link redirects back with #error=...&error_description=...
// which supabase-js does not surface, so the app reads it directly.
export const linkError = initialHashParams.get('error_description') ?? initialHashParams.get('error');

// The anon key is meant for the browser; row level security protects the data.
// detectSessionInUrl is on so a password reset link signs the user in for one
// password change (see handleResetPassword).
export const supabase = createClient(url ?? '', anonKey ?? '', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
