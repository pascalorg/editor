'use client'

import { createBrowserClient } from '@supabase/ssr'
import type { Database } from './supabase-types'

let client: ReturnType<typeof createBrowserClient<Database>> | null = null

/** Browser-side Supabase singleton. Safe to call multiple times. */
export function getSupabaseClient() {
  if (!client) {
    client = createBrowserClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    )
  }
  return client
}
