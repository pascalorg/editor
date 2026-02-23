'use server'

import { createId } from '@pascal-app/db'
import { createServerSupabaseClient } from '../database/server'
import { getSession } from '../auth/server'

const MAX_IMAGES = 5

/**
 * Create signed upload URLs so the client can upload images directly to
 * Supabase Storage — bypasses Vercel's 4.5 MB serverless body-size limit.
 */
export async function createImageUploadUrls(
  files: { name: string; type: string }[],
): Promise<
  | { success: true; uploads: { path: string; signedUrl: string }[] }
  | { success: false; error: string }
> {
  try {
    if (files.length > MAX_IMAGES) {
      return { success: false, error: `Maximum ${MAX_IMAGES} images allowed` }
    }

    const supabase = await createServerSupabaseClient()
    const uploads: { path: string; signedUrl: string }[] = []

    for (const file of files) {
      if (!file.type.startsWith('image/')) continue

      const ext = file.name.split('.').pop() || 'jpg'
      const path = `${createId('img')}.${ext}`

      const { data, error } = await (
        supabase as ReturnType<typeof import('@supabase/supabase-js').createClient>
      ).storage
        .from('feedback-images')
        .createSignedUploadUrl(path)

      if (error || !data) {
        console.error(`Failed to create signed URL for ${file.name}:`, error)
        continue
      }

      uploads.push({ path, signedUrl: data.signedUrl })
    }

    return { success: true, uploads }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to create upload URLs',
    }
  }
}

/**
 * Submit feedback with pre-uploaded image paths.
 * Images are already in Supabase Storage — this just records the metadata.
 */
export async function submitFeedback(data: {
  message: string
  projectId?: string | null
  sceneGraph?: unknown
  imagePaths?: string[]
}): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const { message, projectId, sceneGraph, imagePaths } = data
    if (!message?.trim()) return { success: false, error: 'Message cannot be empty' }

    const session = await getSession()
    const supabase = await createServerSupabaseClient()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from('feedback').insert({
      id: createId('feedback'),
      user_id: session?.user?.id ?? null,
      project_id: projectId ?? null,
      message: message.trim(),
      images: imagePaths && imagePaths.length > 0 ? imagePaths : null,
      scene_graph: sceneGraph ?? null,
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
