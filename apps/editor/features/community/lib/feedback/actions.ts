'use server'

import { createId } from '@pascal-app/db'
import { createServerSupabaseClient } from '../database/server'
import { getSession } from '../auth/server'

export async function submitFeedback(
  message: string,
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const trimmed = message.trim()
    if (!trimmed) return { success: false, error: 'Message cannot be empty' }

    const session = await getSession()
    const supabase = await createServerSupabaseClient()

    const { error } = await supabase.from('feedback').insert({
      id: createId('feedback'),
      user_id: session?.user?.id ?? null,
      message: trimmed,
    })

    if (error) return { success: false, error: error.message }

    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to submit feedback',
    }
  }
}
