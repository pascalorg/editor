/**
 * Supabase server client for database access
 * Re-exports from @pascal-app/db package
 */

import { supabaseAdmin } from '@pascal-app/db/server'

/**
 * Create a Supabase client for server-side use with service role key
 * This bypasses RLS and allows server actions to query the database directly
 * Authentication is handled by Better Auth, permissions enforced by filtering on user_id
 */
export async function createServerSupabaseClient() {
  return supabaseAdmin
}
