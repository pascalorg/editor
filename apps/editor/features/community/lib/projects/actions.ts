/**
 * Project actions - Server actions for project management
 * Uses Better Auth session + Supabase to query the same database as the monorepo
 */

'use server'

import { createServerSupabaseClient } from '../database/server'
import { getSession } from '../auth/server'
import { createId } from '../utils/id-generator'
import { isSceneGraphEmpty } from '../models/scene-graph-utils'
import type { CreateProjectParams, Project } from './types'

export type ActionResult<T = unknown> = {
  success: boolean
  data?: T
  error?: string
  message?: string
}

/**
 * Fetch all projects for the current user
 */
export async function getUserProjects(): Promise<ActionResult<Project[]>> {
  try {
    const session = await getSession()

    if (!session?.user) {
      return {
        success: false,
        error: 'Not authenticated',
        data: [],
      }
    }

    const supabase = await createServerSupabaseClient()

    // Query projects table with address relation
    const { data, error } = await supabase
      .from('projects')
      .select(`
        *,
        address:projects_addresses(*)
      `)
      .eq('owner_id', session.user.id)
      .order('created_at', { ascending: false })

    if (error) {
      return {
        success: false,
        error: error.message,
        data: [],
      }
    }

    return {
      success: true,
      data: data as Project[],
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch projects',
      data: [],
    }
  }
}

/**
 * Get a specific project by ID for the current user
 */
export async function getProjectById(projectId: string): Promise<ActionResult<Project | null>> {
  try {
    const session = await getSession()

    if (!session?.user) {
      return { success: false, error: 'Not authenticated', data: null }
    }

    const supabase = await createServerSupabaseClient()

    const { data, error } = await supabase
      .from('projects')
      .select(`*, address:projects_addresses(*)`)
      .eq('id', projectId)
      .eq('owner_id', session.user.id)
      .single<Project>()

    if (error) {
      return { success: false, error: error.message, data: null }
    }

    return { success: true, data: data as Project }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch project',
      data: null,
    }
  }
}

/**
 * Get the active project for the current session
 */
export async function getActiveProject(): Promise<ActionResult<Project | null>> {
  try {
    const session = await getSession()

    if (!session?.user) {
      return {
        success: false,
        error: 'Not authenticated',
        data: null,
      }
    }

    const supabase = await createServerSupabaseClient()

    // Get session's active_project_id from sessions table
    const { data: sessionData, error: sessionError } = await supabase
      .from('auth_sessions')
      .select('active_project_id')
      .eq('user_id', session.user.id)
      .single<{ active_project_id: string | null }>()

    if (sessionError || !sessionData?.active_project_id) {
      return {
        success: true,
        data: null,
      }
    }

    // Get the project with address
    const { data, error } = await supabase
      .from('projects')
      .select(`
        *,
        address:projects_addresses(*)
      `)
      .eq('id', sessionData.active_project_id)
      .single<Project>()

    if (error) {
      return {
        success: false,
        error: error.message,
        data: null,
      }
    }

    return {
      success: true,
      data: data as Project,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch active project',
      data: null,
    }
  }
}

/**
 * Set the active project for the current session
 */
export async function setActiveProject(projectId: string | null): Promise<ActionResult> {
  try {
    const session = await getSession()

    if (!session?.user) {
      return {
        success: false,
        error: 'Not authenticated',
      }
    }

    const supabase = await createServerSupabaseClient()

    // Update session's active_project_id
    const { error } = await (supabase
      .from('auth_sessions') as any)
      .update({ active_project_id: projectId })
      .eq('user_id', session.user.id)

    if (error) {
      return {
        success: false,
        error: error.message,
      }
    }

    return {
      success: true,
      message: projectId ? 'Active project updated' : 'Active project cleared',
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to set active project',
    }
  }
}

/**
 * Create a new project
 */
export async function createProject(params: CreateProjectParams): Promise<ActionResult<Project>> {
  try {
    const session = await getSession()

    if (!session?.user) {
      return {
        success: false,
        error: 'Not authenticated',
      }
    }

    const supabase = await createServerSupabaseClient()

    const projectId = createId('project')
    let addressId: string | null = null

    // Only create address if address data is provided
    const hasAddressData = params.center || params.streetNumber || params.route || params.city || params.state || params.postalCode
    if (hasAddressData) {
      addressId = createId('address')
      const addressData = {
        id: addressId,
        street_number: params.streetNumber,
        route: params.route,
        city: params.city || '',
        state: params.state || '',
        postal_code: params.postalCode || '',
        country: params.country || 'US',
        latitude: params.center ? params.center[1].toString() : undefined,
        longitude: params.center ? params.center[0].toString() : undefined,
      }
      const { error: addressError } = (await (supabase
        .from('projects_addresses') as any)
        .insert(addressData)
        .select()
        .single()) as { data: any; error: any }

      if (addressError) {
        return {
          success: false,
          error: addressError?.message || 'Failed to create address',
        }
      }
    }

    // Determine if scene graph is empty
    const isEmpty = params.sceneGraph ? isSceneGraphEmpty(params.sceneGraph) : true

    // Create the project
    const projectData = {
      id: projectId,
      name: params.name,
      address_id: addressId,
      owner_id: session.user.id,
      is_private: params.isPrivate !== undefined ? params.isPrivate : true,
      is_empty: isEmpty,
      details_json: params.center
        ? {
            coordinates: params.center,
            createdFrom: 'editor-app',
          }
        : {
            createdFrom: 'editor-app',
          },
    }
    const { data, error } = (await (supabase
      .from('projects') as any)
      .insert(projectData)
      .select(`
        *,
        address:projects_addresses(*)
      `)
      .single()) as { data: Project | null; error: any }

    if (error) {
      return {
        success: false,
        error: error.message,
      }
    }

    // If scene graph is provided, create the model
    if (params.sceneGraph) {
      const modelId = createId('model')
      const { error: modelError } = await supabase.from('projects_models').insert({
        id: modelId,
        project_id: projectId,
        version: 1,
        scene_graph: params.sceneGraph,
      } as any)

      if (modelError) {
        console.error('Failed to create model:', modelError)
        // Don't fail the project creation if model creation fails
      }
    }

    return {
      success: true,
      data: data as Project,
      message: 'Project created successfully',
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create project',
    }
  }
}

/**
 * Check if a project with the given address already exists
 */
export async function checkProjectDuplicate(params: {
  streetNumber?: string
  route?: string
  city?: string
  state?: string
  postalCode?: string
}): Promise<
  ActionResult<{
    isDuplicate: boolean
    isUserProject?: boolean
    existingProject?: Project
  }>
> {
  try {
    const session = await getSession()

    if (!session?.user) {
      return {
        success: false,
        error: 'Not authenticated',
      }
    }

    const supabase = await createServerSupabaseClient()

    // Query for existing project with matching address
    const { data, error } = await supabase
      .from('projects')
      .select(`
        *,
        address:projects_addresses!inner(*)
      `)
      .eq('address.street_number', params.streetNumber || '')
      .eq('address.route', params.route || '')
      .eq('address.city', params.city || '')
      .eq('address.state', params.state || '')
      .eq('address.postal_code', params.postalCode || '')
      .limit(1)

    if (error) {
      return {
        success: false,
        error: error.message,
      }
    }

    if (data && data.length > 0) {
      const existingProject = data[0] as unknown as Project
      return {
        success: true,
        data: {
          isDuplicate: true,
          isUserProject: existingProject.owner_id === session.user.id,
          existingProject,
        },
      }
    }

    return {
      success: true,
      data: {
        isDuplicate: false,
      },
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to check for duplicates',
    }
  }
}

/**
 * Fetch public projects for community hub
 */
export async function getPublicProjects(): Promise<ActionResult<Project[]>> {
  try {
    const supabase = await createServerSupabaseClient()

    const { data, error } = await supabase
      .from('projects')
      .select(`
        *,
        address:projects_addresses(*),
        owner:auth_users!owner_id(id, name, username, image)
      `)
      .eq('is_private', false)
      .eq('is_empty', false)
      .order('views', { ascending: false })
      .limit(50)

    if (error) {
      return {
        success: false,
        error: error.message,
        data: [],
      }
    }

    return {
      success: true,
      data: data as Project[],
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch public projects',
      data: [],
    }
  }
}

/**
 * Fetch public projects for a specific user (by user ID)
 */
export async function getPublicProjectsByUserId(userId: string): Promise<ActionResult<Project[]>> {
  try {
    const supabase = await createServerSupabaseClient()

    const { data, error } = await supabase
      .from('projects')
      .select(`
        *,
        address:projects_addresses(*)
      `)
      .eq('owner_id', userId)
      .eq('is_private', false)
      .order('created_at', { ascending: false })

    if (error) {
      return { success: false, error: error.message, data: [] }
    }

    return { success: true, data: data as Project[] }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch projects',
      data: [],
    }
  }
}

/**
 * Get a project model for viewing
 * Allows viewing if: project is public OR user owns the project
 */
export async function getProjectModelPublic(projectId: string): Promise<
  ActionResult<{ project: Project; model: any | null; isOwner: boolean }>
> {
  try {
    const session = await getSession()
    const supabase = await createServerSupabaseClient()

    // Get the project (without privacy filter first)
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select(`
        *,
        address:projects_addresses(*),
        owner:auth_users!owner_id(id, name, username, image)
      `)
      .eq('id', projectId)
      .single()

    if (projectError || !project) {
      return {
        success: false,
        error: 'Project not found',
        data: undefined,
      }
    }

    // Check if user can view this project
    // Allow if: project is public OR user owns it
    const projectData = project as any
    const isOwner = session?.user && projectData.owner_id === session.user.id
    const isPublic = projectData.is_private === false

    if (!isPublic && !isOwner) {
      return {
        success: false,
        error: 'Project is private',
        data: undefined,
      }
    }

    // Get the model
    const { data: model } = await supabase
      .from('projects_models')
      .select('*')
      .eq('project_id', projectId)
      .is('deleted_at', null)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle()

    return {
      success: true,
      data: {
        project: projectData as Project,
        model: model || null,
        isOwner: !!isOwner,
      },
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch project',
      data: undefined,
    }
  }
}

/**
 * Increment project view count
 */
export async function incrementProjectViews(projectId: string): Promise<ActionResult> {
  try {
    const supabase = await createServerSupabaseClient()

    const { error } = await supabase.rpc('increment_project_views', {
      project_id: projectId,
    } as any)

    if (error) {
      console.error('Failed to increment views:', error)
      // Don't fail the request if view increment fails
    }

    return { success: true }
  } catch (error) {
    console.error('Failed to increment views:', error)
    return { success: true } // Don't fail on view tracking errors
  }
}

/**
 * Update project privacy setting
 */
export async function updateProjectPrivacy(
  projectId: string,
  isPrivate: boolean,
): Promise<ActionResult> {
  try {
    const session = await getSession()

    if (!session?.user) {
      return {
        success: false,
        error: 'Not authenticated',
      }
    }

    const supabase = await createServerSupabaseClient()

    // Verify ownership
    const { data: project } = await supabase
      .from('projects')
      .select('owner_id')
      .eq('id', projectId)
      .single()

    if ((project as any)?.owner_id !== session.user.id) {
      return {
        success: false,
        error: 'Unauthorized',
      }
    }

    // Update privacy
    const { error } = await (supabase
      .from('projects') as any)
      .update({ is_private: isPrivate })
      .eq('id', projectId)

    if (error) {
      return {
        success: false,
        error: error.message,
      }
    }

    return {
      success: true,
      message: `Project is now ${isPrivate ? 'private' : 'public'}`,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update project privacy',
    }
  }
}

/**
 * Update project visibility settings (privacy + public scan/guide visibility)
 */
export async function updateProjectVisibility(
  projectId: string,
  settings: {
    isPrivate?: boolean
    showScansPublic?: boolean
    showGuidesPublic?: boolean
  },
): Promise<ActionResult> {
  try {
    const session = await getSession()

    if (!session?.user) {
      return { success: false, error: 'Not authenticated' }
    }

    const supabase = await createServerSupabaseClient()

    // Verify ownership
    const { data: project } = await supabase
      .from('projects')
      .select('owner_id')
      .eq('id', projectId)
      .single()

    if ((project as any)?.owner_id !== session.user.id) {
      return { success: false, error: 'Unauthorized' }
    }

    const updateData: Record<string, boolean> = {}
    if (settings.isPrivate !== undefined) updateData.is_private = settings.isPrivate
    if (settings.showScansPublic !== undefined) updateData.show_scans_public = settings.showScansPublic
    if (settings.showGuidesPublic !== undefined) updateData.show_guides_public = settings.showGuidesPublic

    if (Object.keys(updateData).length === 0) {
      return { success: true, message: 'No changes' }
    }

    const { error } = await (supabase
      .from('projects') as any)
      .update(updateData)
      .eq('id', projectId)

    if (error) {
      return { success: false, error: error.message }
    }

    return { success: true, message: 'Visibility settings updated' }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update visibility settings',
    }
  }
}

/**
 * Update project name
 */
export async function updateProjectName(
  projectId: string,
  name: string,
): Promise<ActionResult> {
  try {
    const session = await getSession()

    if (!session?.user) {
      return {
        success: false,
        error: 'Not authenticated',
      }
    }

    if (!name.trim()) {
      return {
        success: false,
        error: 'Project name cannot be empty',
      }
    }

    const supabase = await createServerSupabaseClient()

    // Verify ownership
    const { data: project } = await supabase
      .from('projects')
      .select('owner_id')
      .eq('id', projectId)
      .single()

    if ((project as any)?.owner_id !== session.user.id) {
      return {
        success: false,
        error: 'Unauthorized',
      }
    }

    // Update name
    const { error } = await (supabase
      .from('projects') as any)
      .update({ name: name.trim() })
      .eq('id', projectId)

    if (error) {
      return {
        success: false,
        error: error.message,
      }
    }

    return {
      success: true,
      message: 'Project name updated',
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update project name',
    }
  }
}

/**
 * Update project address
 */
export async function updateProjectAddress(
  projectId: string,
  addressData: {
    street_number?: string
    route?: string
    city?: string
    state?: string
    postal_code?: string
    country?: string
  },
): Promise<ActionResult> {
  try {
    const session = await getSession()

    if (!session?.user) {
      return {
        success: false,
        error: 'Not authenticated',
      }
    }

    const supabase = await createServerSupabaseClient()

    // Verify ownership and get address_id
    const { data: project } = await supabase
      .from('projects')
      .select('owner_id, address_id')
      .eq('id', projectId)
      .single()

    if (!project) {
      return {
        success: false,
        error: 'Project not found',
      }
    }

    if ((project as any).owner_id !== session.user.id) {
      return {
        success: false,
        error: 'Unauthorized',
      }
    }

    // Update address
    const { error } = await (supabase
      .from('projects_addresses') as any)
      .update(addressData)
      .eq('id', (project as any).address_id)

    if (error) {
      return {
        success: false,
        error: error.message,
      }
    }

    return {
      success: true,
      message: 'Address updated successfully',
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update address',
    }
  }
}

/**
 * Delete a project
 * Only the owner can delete their project
 */
export async function deleteProject(projectId: string): Promise<ActionResult> {
  try {
    const session = await getSession()

    if (!session?.user) {
      return {
        success: false,
        error: 'Not authenticated',
      }
    }

    const supabase = await createServerSupabaseClient()

    // Verify ownership
    const { data: project } = await supabase
      .from('projects')
      .select('owner_id')
      .eq('id', projectId)
      .single()

    if (!project) {
      return {
        success: false,
        error: 'Project not found',
      }
    }

    if ((project as any).owner_id !== session.user.id) {
      return {
        success: false,
        error: 'Unauthorized',
      }
    }

    // Delete project asset files from storage before deleting the project
    const { data: assets } = await (supabase.from('project_assets') as any)
      .select('storage_key')
      .eq('project_id', projectId)

    if (assets && assets.length > 0) {
      const storageKeys = (assets as { storage_key: string }[]).map((a) => a.storage_key)
      await supabase.storage.from('project-assets').remove(storageKeys)
    }

    // Delete the project (cascade will delete related records including project_assets rows)
    const { error } = await supabase.from('projects').delete().eq('id', projectId)

    if (error) {
      return {
        success: false,
        error: error.message,
      }
    }

    return {
      success: true,
      message: 'Project deleted successfully',
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete project',
    }
  }
}

/**
 * Check if the current user has liked specific projects
 * Returns a map of projectId -> boolean
 */
export async function getUserProjectLikes(
  projectIds: string[],
): Promise<ActionResult<Record<string, boolean>>> {
  try {
    const session = await getSession()

    if (!session?.user || projectIds.length === 0) {
      // Return empty map for unauthenticated users or no projects
      return {
        success: true,
        data: {},
      }
    }

    const supabase = await createServerSupabaseClient()

    const { data: likes, error } = await supabase
      .from('projects_likes')
      .select('project_id')
      .eq('user_id', session.user.id)
      .in('project_id', projectIds)

    if (error) {
      return {
        success: false,
        error: error.message,
        data: {},
      }
    }

    // Convert array to map
    const likeMap: Record<string, boolean> = {}
    projectIds.forEach((id) => {
      likeMap[id] = likes?.some((like) => (like as any).project_id === id) || false
    })

    return {
      success: true,
      data: likeMap,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch likes',
      data: {},
    }
  }
}

/**
 * Toggle like on a project
 * Returns the new like state and updated like count
 */
export async function toggleProjectLike(
  projectId: string,
): Promise<ActionResult<{ liked: boolean; likes: number }>> {
  try {
    const session = await getSession()

    if (!session?.user) {
      return {
        success: false,
        error: 'Not authenticated',
      }
    }

    const supabase = await createServerSupabaseClient()
    const userId = session.user.id

    // Check if user has already liked this project
    const { data: existingLike } = await supabase
      .from('projects_likes')
      .select('id')
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .maybeSingle()

    let liked = false

    if (existingLike) {
      // Unlike - remove the like
      const { error } = await (supabase
        .from('projects_likes') as any)
        .delete()
        .eq('id', (existingLike as any).id)

      if (error) {
        return {
          success: false,
          error: error.message,
        }
      }

      liked = false
    } else {
      // Like - add a new like
      const likeId = createId('like')
      const { error } = await (supabase.from('projects_likes') as any).insert({
        id: likeId,
        project_id: projectId,
        user_id: userId,
      })

      if (error) {
        return {
          success: false,
          error: error.message,
        }
      }

      liked = true
    }

    // Get updated like count
    const { data: likeCount } = await supabase.rpc('get_project_like_count', {
      project_id: projectId,
    } as any)

    // Update the project's like count cache
    await (supabase
      .from('projects') as any)
      .update({ likes: likeCount || 0 })
      .eq('id', projectId)

    return {
      success: true,
      data: {
        liked,
        likes: likeCount || 0,
      },
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to toggle like',
    }
  }
}

/**
 * Upload a thumbnail image to Supabase Storage and update the project
 */
export async function uploadProjectThumbnail(
  projectId: string,
  blob: Blob
): Promise<{ success: true; data: { thumbnail_url: string } } | { success: false; error: string }> {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return { success: false, error: 'Not authenticated' }
    }

    // Validate file size (max 10MB)
    const MAX_SIZE = 10 * 1024 * 1024
    if (blob.size > MAX_SIZE) {
      return { success: false, error: `Image too large (${(blob.size / 1024 / 1024).toFixed(1)}MB). Maximum size is 10MB.` }
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
      return { success: false, error: 'Not authorized to update this project' }
    }

    const filename = `${projectId}/thumbnail.png`

    // Upload to Supabase Storage (upsert to override existing thumbnail)
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('project-thumbnails')
      .upload(filename, blob, {
        contentType: 'image/png',
        upsert: true,
      })

    if (uploadError) {
      return { success: false, error: `Upload failed: ${uploadError.message}` }
    }

    // Get the public URL
    const { data: urlData } = supabase.storage
      .from('project-thumbnails')
      .getPublicUrl(uploadData.path)

    const thumbnailUrl = `${urlData.publicUrl}?t=${Date.now()}`

    // Update the project with the new thumbnail URL
    const { error: updateError } = await (supabase
      .from('projects') as any)
      .update({ thumbnail_url: thumbnailUrl })
      .eq('id', projectId)

    if (updateError) {
      return { success: false, error: `Failed to update project: ${updateError.message}` }
    }

    return {
      success: true,
      data: { thumbnail_url: thumbnailUrl },
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to upload thumbnail',
    }
  }
}
