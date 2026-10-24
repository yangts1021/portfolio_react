import { createClient } from '@supabase/supabase-js';

// The publishable key is meant to ship in the browser: access is enforced by RLS and login,
// not by keeping this key secret. Never put the service_role key here.
export const SUPABASE_URL = 'https://ptduqiebdqawopdheith.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_5LQzGXouO022LEZTtKg7-A_MepTRzp3';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY || 'missing-key', {
  auth: { persistSession: true, autoRefreshToken: true },
});
