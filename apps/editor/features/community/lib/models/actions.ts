/**
 * Property model actions - Server actions for scene loading/saving
 * Manages 3D models (scene graphs) stored in properties_models table
 */

'use server'

import type { AnyNode, AnyNodeId } from '@pascal-app/core'
import { createServerSupabaseClient } from '../database/server'
import { getSession } from '../auth/server'
import { createId } from '../utils/id-generator'
import type { ActionResult } from '../properties/actions'

export interface SceneGraph {
  nodes: Record<AnyNodeId, AnyNode>
  rootNodeIds: AnyNodeId[]
}

export interface PropertyModel {
  id: string
  name: string
  version: number
  draft: boolean
  property_id: string
  scene_graph: SceneGraph | null
  created_at: string
  updated_at: string
}

/**
 * Get the latest model for a property (highest version)
 */
export async function getPropertyModel(propertyId: string): Promise<ActionResult<PropertyModel | null>> {
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

    // Get the property to verify ownership
    const { data: property, error: propertyError } = await supabase
      .from('properties')
      .select('id, owner_id')
      .eq('id', propertyId)
      .single<{ id: string; owner_id: string }>()

    if (propertyError || !property) {
      return {
        success: false,
        error: 'Property not found',
        data: null,
      }
    }

    // Verify ownership
    if (property.owner_id !== session.user.id) {
      return {
        success: false,
        error: 'Unauthorized',
        data: null,
      }
    }

    // Get the latest model (highest version, then most recent)
    const { data: model, error: modelError } = await supabase
      .from('properties_models')
      .select('*')
      .eq('property_id', propertyId)
      .is('deleted_at', null)
      .order('version', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .single<PropertyModel>()

    console.log('[getPropertyModel] Query result:', {
      propertyId,
      hasModel: !!model,
      modelError: modelError?.message,
      errorCode: modelError?.code,
      modelKeys: model ? Object.keys(model) : [],
    })

    if (modelError) {
      // No model found is not an error - just return null
      if (modelError.code === 'PGRST116') {
        console.log('[getPropertyModel] No model found (PGRST116), returning null')
        return {
          success: true,
          data: null,
        }
      }

      console.log('[getPropertyModel] Database error:', modelError)
      return {
        success: false,
        error: modelError.message,
        data: null,
      }
    }

    console.log('[getPropertyModel] Model found:', {
      id: model.id,
      version: model.version,
      hasSceneGraph: !!model.scene_graph,
    })

    return {
      success: true,
      data: model as PropertyModel,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch property model',
      data: null,
    }
  }
}

/**
 * Save or update a property model's scene graph
 * If a model exists, updates it. Otherwise creates a new one.
 */
export async function savePropertyModel(
  propertyId: string,
  sceneGraph: SceneGraph,
): Promise<ActionResult<PropertyModel>> {
  try {
    const session = await getSession()

    if (!session?.user) {
      return {
        success: false,
        error: 'Not authenticated',
      }
    }

    const supabase = await createServerSupabaseClient()

    // Get the property to verify ownership
    const { data: property, error: propertyError } = await supabase
      .from('properties')
      .select('id, owner_id, name')
      .eq('id', propertyId)
      .single<{ id: string; owner_id: string; name: string }>()

    if (propertyError || !property) {
      return {
        success: false,
        error: 'Property not found',
      }
    }

    // Verify ownership
    if (property.owner_id !== session.user.id) {
      return {
        success: false,
        error: 'Unauthorized',
      }
    }

    // Check if a model already exists
    const { data: existingModel } = await supabase
      .from('properties_models')
      .select('id, version')
      .eq('property_id', propertyId)
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
        .from('properties_models') as any)
        .update(updateData)
        .eq('id', existingModel.id)
        .select()
        .single()) as { data: PropertyModel | null; error: any }

      if (updateError) {
        return {
          success: false,
          error: updateError.message,
        }
      }

      return {
        success: true,
        data: updatedModel as PropertyModel,
        message: 'Model updated successfully',
      }
    } else {
      // Create new model
      const modelId = createId('model')

      const insertData = {
        id: modelId,
        property_id: propertyId,
        name: `${property.name} - Editor`,
        version: 1,
        draft: true,
        scene_graph: sceneGraph,
      }
      const { data: newModel, error: createError } = (await (supabase
        .from('properties_models') as any)
        .insert(insertData)
        .select()
        .single()) as { data: PropertyModel | null; error: any }

      if (createError) {
        return {
          success: false,
          error: createError.message,
        }
      }

      return {
        success: true,
        data: newModel as PropertyModel,
        message: 'Model created successfully',
      }
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to save property model',
    }
  }
}
