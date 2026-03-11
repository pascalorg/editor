/**
 * Supabase server client for database access
 */

import { supabaseAdmin } from '@/lib/supabase/server'

/**
 * Create a Supabase client for server-side use with service role key
 * This bypasses RLS and allows server actions to query the database directly
 * Authentication is handled by Better Auth, permissions enforced by filtering on user_id
 */
export async function createServerSupabaseClient() {
  return supabaseAdmin
}
