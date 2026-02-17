/**
 * Project model actions - Server actions for scene loading/saving
 * Manages 3D models (scene graphs) stored in projects_models table
 */

'use server'

import type { AnyNode, AnyNodeId } from '@pascal-app/core'
import { createServerSupabaseClient } from '../database/server'
import { getSession } from '../auth/server'
import { createId } from '../utils/id-generator'
import type { ActionResult } from '../projects/actions'

export interface SceneGraph {
  nodes: Record<AnyNodeId, AnyNode>
  rootNodeIds: AnyNodeId[]
}

export interface ProjectModel {
  id: string
  name: string
  version: number
  draft: boolean
  project_id: string
  scene_graph: SceneGraph | null
  created_at: string
  updated_at: string
}

/**
 * Get the latest model for a project (highest version)
 */
export async function getProjectModel(projectId: string): Promise<ActionResult<ProjectModel | null>> {
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

    // Get the project to verify ownership
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id, owner_id')
      .eq('id', projectId)
      .single<{ id: string; owner_id: string }>()

    if (projectError || !project) {
      return {
        success: false,
        error: 'Project not found',
        data: null,
      }
    }

    // Verify ownership
    if (project.owner_id !== session.user.id) {
      return {
        success: false,
        error: 'Unauthorized',
        data: null,
      }
    }

    // Get the latest model (highest version, then most recent)
    const { data: model, error: modelError } = await supabase
      .from('projects_models')
      .select('*')
      .eq('project_id', projectId)
      .is('deleted_at', null)
      .order('version', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .single<ProjectModel>()

    console.log('[getProjectModel] Query result:', {
      projectId,
      hasModel: !!model,
      modelError: modelError?.message,
      errorCode: modelError?.code,
      modelKeys: model ? Object.keys(model) : [],
    })

    if (modelError) {
      // No model found is not an error - just return null
      if (modelError.code === 'PGRST116') {
        console.log('[getProjectModel] No model found (PGRST116), returning null')
        return {
          success: true,
          data: null,
        }
      }

      console.log('[getProjectModel] Database error:', modelError)
      return {
        success: false,
        error: modelError.message,
        data: null,
      }
    }

    console.log('[getProjectModel] Model found:', {
      id: model.id,
      version: model.version,
      hasSceneGraph: !!model.scene_graph,
    })

    return {
      success: true,
      data: model as ProjectModel,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch project model',
      data: null,
    }
  }
}

/**
 * Save or update a project model's scene graph
 * If a model exists, updates it. Otherwise creates a new one.
 */
export async function saveProjectModel(
  projectId: string,
  sceneGraph: SceneGraph,
): Promise<ActionResult<ProjectModel>> {
  try {
    const session = await getSession()

    if (!session?.user) {
      return {
        success: false,
        error: 'Not authenticated',
      }
    }

    const supabase = await createServerSupabaseClient()

    // Get the project to verify ownership
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id, owner_id, name')
      .eq('id', projectId)
      .single<{ id: string; owner_id: string; name: string }>()

    if (projectError || !project) {
      return {
        success: false,
        error: 'Project not found',
      }
    }

    // Verify ownership
    if (project.owner_id !== session.user.id) {
      return {
        success: false,
        error: 'Unauthorized',
      }
    }

    // Check if a model already exists
    const { data: existingModel } = await supabase
      .from('projects_models')
      .select('id, version')
      .eq('project_id', projectId)
      .is('deleted_at', null)
      .order('version', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .single<{ id: string; version: number }>()

    if (existingModel) {
      // Update existing model
      const updateData = {
        scene_graph: sceneGraph,
        updated_at: new Date().toISOString(),
      }
      const { data: updatedModel, error: updateError } = (await (supabase
        .from('projects_models') as any)
        .update(updateData)
        .eq('id', existingModel.id)
        .select()
        .single()) as { data: ProjectModel | null; error: any }

      if (updateError) {
        return {
          success: false,
          error: updateError.message,
        }
      }

      return {
        success: true,
        data: updatedModel as ProjectModel,
        message: 'Model updated successfully',
      }
    } else {
      // Create new model
      const modelId = createId('model')

      const insertData = {
        id: modelId,
        project_id: projectId,
        name: `${project.name} - Editor`,
        version: 1,
        draft: true,
        scene_graph: sceneGraph,
      }
      const { data: newModel, error: createError } = (await (supabase
        .from('projects_models') as any)
        .insert(insertData)
        .select()
        .single()) as { data: ProjectModel | null; error: any }

      if (createError) {
        return {
          success: false,
          error: createError.message,
        }
      }

      return {
        success: true,
        data: newModel as ProjectModel,
        message: 'Model created successfully',
      }
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to save project model',
    }
  }
}
