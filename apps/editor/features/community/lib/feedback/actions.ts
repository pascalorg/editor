'use server'

import { createId } from '@pascal-app/db'
import { createServerSupabaseClient } from '../database/server'
import { getSession } from '../auth/server'

const MAX_IMAGES = 5
const MAX_IMAGE_SIZE = 5 * 1024 * 1024 // 5MB

export async function submitFeedback(
  formData: FormData,
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const message = (formData.get('message') as string)?.trim()
    if (!message) return { success: false, error: 'Message cannot be empty' }

    const projectId = (formData.get('projectId') as string) || null
    const sceneGraphRaw = formData.get('sceneGraph') as string | null
    const sceneGraph = sceneGraphRaw ? JSON.parse(sceneGraphRaw) : null

    const session = await getSession()
    const supabase = await createServerSupabaseClient()

    // Upload images to Supabase Storage
    const imageFiles = formData.getAll('images') as File[]
    const validImages = imageFiles.filter(
      (f) => f instanceof File && f.size > 0 && f.size <= MAX_IMAGE_SIZE && f.type.startsWith('image/'),
    ).slice(0, MAX_IMAGES)

    const imagePaths: string[] = []

    for (const file of validImages) {
      const ext = file.name.split('.').pop() || 'jpg'
      const path = `${createId('img')}.${ext}`

      const { error: uploadError } = await (supabase as ReturnType<typeof import('@supabase/supabase-js').createClient>)
        .storage
        .from('feedback-images')
        .upload(path, file, {
          contentType: file.type,
          upsert: false,
        })

      if (!uploadError) {
        imagePaths.push(path)
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from('feedback').insert({
      id: createId('feedback'),
      user_id: session?.user?.id ?? null,
      user_email: session?.user?.email ?? null,
      user_name: session?.user?.name ?? null,
      project_id: projectId,
      message,
      images: imagePaths.length > 0 ? imagePaths : null,
      scene_graph: sceneGraph,
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
