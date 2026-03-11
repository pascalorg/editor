import { createClient } from '@supabase/supabase-js'
import type { SupabaseDatabase } from '@pascal-app/db'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

/**
 * Supabase client for client-side use with anon key
 * Uses Row Level Security (RLS) policies
 */
export const supabase = createClient<SupabaseDatabase>(supabaseUrl, supabaseAnonKey)
