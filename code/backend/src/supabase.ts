import { createClient, type User } from '@supabase/supabase-js';
import type { Profile } from '../../db/profiles.ts';
import type { Role } from '../../db/schema.ts';
import { SUPABASE_ANON_KEY, SUPABASE_URL, requireEnv } from './config.ts';

// Validate before createClient, which throws a bare "supabaseUrl is required."
requireEnv([
  ['SUPABASE_URL', SUPABASE_URL],
  ['SUPABASE_ANON_KEY (or SUPABASE_PUBLISHABLE_KEY)', SUPABASE_ANON_KEY],
]);

// Stateless: the backend never keeps a Supabase session of its own.
const options = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
};

export const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, options);

export interface PublicUser {
  id: string | null;
  email: string;
  full_name: string;
  role: Role;
}

// Supabase Auth verifies the signature and expiry of its own access tokens.
export async function userFromAccessToken(token: string | null): Promise<User | null> {
  if (!token) return null;
  const { data, error } = await supabaseAuth.auth.getUser(token);
  if (error) return null;
  return data.user ?? null;
}

export function toPublicUser(profile: Profile | null, authUser: User | null): PublicUser {
  return {
    id: profile?.id ?? authUser?.id ?? null,
    email: profile?.email ?? authUser?.email ?? '',
    full_name: profile?.fullName || (authUser?.user_metadata?.full_name as string | undefined) || '',
    role: profile?.role ?? 'traveler',
  };
}

export async function authReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
      headers: { apikey: SUPABASE_ANON_KEY },
      signal: AbortSignal.timeout(5_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
