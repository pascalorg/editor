import { createClient } from '@supabase/supabase-js'
import type { SupabaseDatabase } from '@pascal-app/db'
import { env } from '@/env.mjs'

/**
 * Safety check: warn loudly if a Vercel preview deployment is using
 * the production Supabase instance. This catches misconfigured branching.
 */
if (
  process.env.VERCEL_ENV === 'preview' &&
  process.env.SUPABASE_URL &&
  env.NEXT_PUBLIC_SUPABASE_URL === process.env.SUPABASE_URL
) {
  // If the Supabase integration set a branch-specific SUPABASE_URL,
  // it should differ from NEXT_PUBLIC_SUPABASE_URL (which comes from the
  // generic env vars pointing at production). When they match, the
  // integration likely skipped branch creation for this PR.
  console.warn(
    '⚠️  [supabase] Preview deployment appears to be using the PRODUCTION ' +
    'Supabase instance. Supabase branching may not be configured for this PR. ' +
    'See: https://supabase.com/docs/guides/deployment/branching',
  )
}

/**
 * Supabase client for server-side use with service role key
 * Bypasses Row Level Security (RLS) - use with caution
 * Always filter by user_id to enforce permissions
 */
export const supabaseAdmin = createClient<SupabaseDatabase>(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  },
)
