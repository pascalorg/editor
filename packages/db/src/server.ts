import { createClient } from '@supabase/supabase-js'
import type { Database } from './types'

let _supabaseAdmin: ReturnType<typeof createClient<Database>> | null = null

function getSupabaseAdmin() {
  if (!_supabaseAdmin) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      throw new Error(
        'Missing required environment variables: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Please configure them in your deployment settings or .env.local file.'
      )
    }

    _supabaseAdmin = createClient<Database>(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })
  }
  return _supabaseAdmin
}

/**
 * Supabase client for server-side use with service role key
 * Bypasses Row Level Security (RLS) - use with caution
 * Always filter by user_id to enforce permissions
 *
 * Initialized lazily to avoid requiring env vars at build time
 */
export const supabaseAdmin = new Proxy({} as ReturnType<typeof createClient<Database>>, {
  get(_target, prop) {
    return Reflect.get(getSupabaseAdmin(), prop)
  },
})
