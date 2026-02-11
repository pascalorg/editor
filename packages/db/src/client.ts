import { createClient } from '@supabase/supabase-js'
import type { Database } from './types'

let _supabase: ReturnType<typeof createClient<Database>> | null = null

function getSupabase() {
  if (!_supabase) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error(
        'Missing required environment variables: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY. Please configure them in your deployment settings or .env.local file.'
      )
    }

    _supabase = createClient<Database>(supabaseUrl, supabaseAnonKey)
  }
  return _supabase
}

/**
 * Supabase client for client-side use with anon key
 * Uses Row Level Security (RLS) policies
 *
 * Initialized lazily to avoid requiring env vars at build time
 */
export const supabase = new Proxy({} as ReturnType<typeof createClient<Database>>, {
  get(_target, prop) {
    return Reflect.get(getSupabase(), prop)
  },
})
