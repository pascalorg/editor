import { createClient } from '@supabase/supabase-js'
import type { SupabaseDatabase } from '@pascal-app/db'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'

/**
 * Supabase client for server-side use with service role key
 * Bypasses Row Level Security (RLS) - use with caution
 * Always filter by user_id to enforce permissions
 */
export const supabaseAdmin = createClient<SupabaseDatabase>(
  supabaseUrl,
  supabaseServiceRoleKey,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  },
)
