'use server'

import type { createClient } from '@supabase/supabase-js'
import { createServerSupabaseClient } from '../database/server'
import { getSession } from '../auth/server'
import { createId } from '../utils/id-generator'

const BUCKET = 'project-assets'

export type AssetType = 'scan' | 'guide'

export type UploadAssetResult =
  | { success: true; url: string }
  | { success: false; error: string }

export type CreateUploadUrlResult =
  | { success: true; signedUrl: string; storageKey: string; assetId: string }
  | { success: false; error: string }

export type ConfirmUploadResult =
  | { success: true; url: string }
  | { success: false; error: string }

export type DeleteAssetResult =
  | { success: true }
  | { success: false; error: string }

/**
 * Upload a scan or guide file to Supabase Storage and record it in project_assets.
 * Returns the public HTTPS URL that can be stored directly on the scene node.
 */
export async function uploadProjectAsset(
  projectId: string,
  file: File,
  type: AssetType,
): Promise<UploadAssetResult> {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return { success: false, error: 'Not authenticated' }
    }

    const supabase = await createServerSupabaseClient()

    // Verify the user owns this project
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('owner_id')
      .eq('id', projectId)
      .single()

    if (projectError || !project) {
      return { success: false, error: 'Project not found' }
    }

    if ((project as any).owner_id !== session.user.id) {
      return { success: false, error: 'Not authorized to upload to this project' }
    }

    // Derive extension from file name
    const ext = file.name.includes('.') ? file.name.split('.').pop()! : ''
    const assetId = createId('asset')
    const storageKey = ext ? `${projectId}/${assetId}.${ext}` : `${projectId}/${assetId}`

    const arrayBuffer = await file.arrayBuffer()
    const bytes = new Uint8Array(arrayBuffer)

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storageKey, bytes, {
        contentType: file.type || 'application/octet-stream',
        upsert: false,
      })

    if (uploadError) {
      return { success: false, error: `Upload failed: ${uploadError.message}` }
    }

    const { data: urlData } = supabase.storage
      .from(BUCKET)
      .getPublicUrl(uploadData.path)

    const url = urlData.publicUrl

    // Record in project_assets table
    const { error: insertError } = await (supabase.from('project_assets') as any).insert({
      id: assetId,
      project_id: projectId,
      storage_key: storageKey,
      url,
      type,
      original_name: file.name,
      mime_type: file.type || null,
    })

    if (insertError) {
      // Best-effort cleanup: remove the uploaded file
      await supabase.storage.from(BUCKET).remove([storageKey])
      return { success: false, error: `Failed to record asset: ${insertError.message}` }
    }

    return { success: true, url }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to upload asset',
    }
  }
}

/**
 * Create a signed upload URL so the client can upload directly to Supabase Storage.
 * Bypasses Next.js body-size limits — supports files up to the bucket limit (500 MB).
 */
export async function createAssetUploadUrl(
  projectId: string,
  fileName: string,
  contentType: string,
  type: AssetType,
): Promise<CreateUploadUrlResult> {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return { success: false, error: 'Not authenticated' }
    }

    const supabase = await createServerSupabaseClient()

    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('owner_id')
      .eq('id', projectId)
      .single()

    if (projectError || !project) {
      return { success: false, error: 'Project not found' }
    }

    if ((project as any).owner_id !== session.user.id) {
      return { success: false, error: 'Not authorized to upload to this project' }
    }

    const ext = fileName.includes('.') ? fileName.split('.').pop()! : ''
    const assetId = createId('asset')
    const storageKey = ext ? `${projectId}/${assetId}.${ext}` : `${projectId}/${assetId}`

    const { data, error } = await (
      supabase as ReturnType<typeof createClient>
    ).storage
      .from(BUCKET)
      .createSignedUploadUrl(storageKey)

    if (error || !data) {
      return { success: false, error: `Failed to create upload URL: ${error?.message}` }
    }

    return { success: true, signedUrl: data.signedUrl, storageKey, assetId }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create upload URL',
    }
  }
}

/**
 * Record a successfully uploaded asset in the project_assets table.
 * Called after the client uploads the file directly to Supabase Storage.
 */
export async function confirmAssetUpload(
  projectId: string,
  assetId: string,
  storageKey: string,
  originalName: string,
  mimeType: string | null,
  type: AssetType,
): Promise<ConfirmUploadResult> {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return { success: false, error: 'Not authenticated' }
    }

    const supabase = await createServerSupabaseClient()

    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('owner_id')
      .eq('id', projectId)
      .single()

    if (projectError || !project) {
      return { success: false, error: 'Project not found' }
    }

    if ((project as any).owner_id !== session.user.id) {
      return { success: false, error: 'Not authorized' }
    }

    const { data: urlData } = supabase.storage
      .from(BUCKET)
      .getPublicUrl(storageKey)

    const url = urlData.publicUrl

    const { error: insertError } = await (supabase.from('project_assets') as any).insert({
      id: assetId,
      project_id: projectId,
      storage_key: storageKey,
      url,
      type,
      original_name: originalName,
      mime_type: mimeType,
    })

    if (insertError) {
      await supabase.storage.from(BUCKET).remove([storageKey])
      return { success: false, error: `Failed to record asset: ${insertError.message}` }
    }

    return { success: true, url }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to confirm upload',
    }
  }
}

/**
 * Delete a project asset by its public URL.
 * Removes both the storage file and the project_assets row.
 */
export async function deleteProjectAssetByUrl(
  projectId: string,
  url: string,
): Promise<DeleteAssetResult> {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return { success: false, error: 'Not authenticated' }
    }

    const supabase = await createServerSupabaseClient()

    // Verify ownership
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('owner_id')
      .eq('id', projectId)
      .single()

    if (projectError || !project) {
      return { success: false, error: 'Project not found' }
    }

    if ((project as any).owner_id !== session.user.id) {
      return { success: false, error: 'Not authorized' }
    }

    // Derive storage_key from the public URL
    // URL format: https://<project>.supabase.co/storage/v1/object/public/project-assets/<storageKey>
    const storageKeyFromUrl = url.split(`/${BUCKET}/`)[1]?.split('?')[0]

    if (!storageKeyFromUrl) {
      return { success: false, error: 'Could not derive storage key from URL' }
    }

    // Delete from storage directly — remove() is a no-op if the file doesn't exist
    const { error: storageError } = await supabase.storage.from(BUCKET).remove([storageKeyFromUrl])
    if (storageError) {
      return { success: false, error: `Storage delete failed: ${storageError.message}` }
    }

    // Delete DB row by storage_key scoped to this project
    const { error: dbError } = await (supabase.from('project_assets') as any)
      .delete()
      .eq('project_id', projectId)
      .eq('storage_key', storageKeyFromUrl)

    if (dbError) {
      return { success: false, error: `DB delete failed: ${dbError.message}` }
    }

    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete asset',
    }
  }
}
