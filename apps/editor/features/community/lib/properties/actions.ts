/**
 * Property actions - Server actions for property management
 * Uses Better Auth session + Supabase to query the same database as the monorepo
 */

'use server'

import { createServerSupabaseClient } from '../database/server'
import { getSession } from '../auth/server'
import { createId } from '../utils/id-generator'
import type { CreatePropertyParams, Property, Database } from './types'

export type ActionResult<T = unknown> = {
  success: boolean
  data?: T
  error?: string
  message?: string
}

/**
 * Fetch all properties for the current user
 */
export async function getUserProperties(): Promise<ActionResult<Property[]>> {
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

    // Query properties table with address relation
    const { data, error } = await supabase
      .from('properties')
      .select(`
        *,
        address:properties_addresses(*)
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
      data: data as Property[],
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch properties',
      data: [],
    }
  }
}

/**
 * Get a specific property by ID for the current user
 */
export async function getPropertyById(propertyId: string): Promise<ActionResult<Property | null>> {
  try {
    const session = await getSession()

    if (!session?.user) {
      return { success: false, error: 'Not authenticated', data: null }
    }

    const supabase = await createServerSupabaseClient()

    const { data, error } = await supabase
      .from('properties')
      .select(`*, address:properties_addresses(*)`)
      .eq('id', propertyId)
      .eq('owner_id', session.user.id)
      .single<Property>()

    if (error) {
      return { success: false, error: error.message, data: null }
    }

    return { success: true, data: data as Property }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch property',
      data: null,
    }
  }
}

/**
 * Get the active property for the current session
 */
export async function getActiveProperty(): Promise<ActionResult<Property | null>> {
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

    // Get session's active_property_id from sessions table
    const { data: sessionData, error: sessionError } = await supabase
      .from('auth_sessions')
      .select('active_property_id')
      .eq('user_id', session.user.id)
      .single<{ active_property_id: string | null }>()

    if (sessionError || !sessionData?.active_property_id) {
      return {
        success: true,
        data: null,
      }
    }

    // Get the property with address
    const { data, error } = await supabase
      .from('properties')
      .select(`
        *,
        address:properties_addresses(*)
      `)
      .eq('id', sessionData.active_property_id)
      .single<Property>()

    if (error) {
      return {
        success: false,
        error: error.message,
        data: null,
      }
    }

    return {
      success: true,
      data: data as Property,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch active property',
      data: null,
    }
  }
}

/**
 * Set the active property for the current session
 */
export async function setActiveProperty(propertyId: string | null): Promise<ActionResult> {
  try {
    const session = await getSession()

    if (!session?.user) {
      return {
        success: false,
        error: 'Not authenticated',
      }
    }

    const supabase = await createServerSupabaseClient()

    // Update session's active_property_id
    const { error } = await (supabase
      .from('auth_sessions') as any)
      .update({ active_property_id: propertyId })
      .eq('user_id', session.user.id)

    if (error) {
      return {
        success: false,
        error: error.message,
      }
    }

    return {
      success: true,
      message: propertyId ? 'Active property updated' : 'Active property cleared',
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to set active property',
    }
  }
}

/**
 * Create a new property
 */
export async function createProperty(params: CreatePropertyParams): Promise<ActionResult<Property>> {
  try {
    const session = await getSession()

    if (!session?.user) {
      return {
        success: false,
        error: 'Not authenticated',
      }
    }

    const supabase = await createServerSupabaseClient()

    // Generate IDs for address and property
    const addressId = createId('address')
    const propertyId = createId('property')

    // First, create the address
    const addressData = {
      id: addressId,
      street_number: params.streetNumber,
      route: params.route,
      city: params.city || '',
      state: params.state || '',
      postal_code: params.postalCode || '',
      country: params.country || 'US',
      latitude: params.center[1].toString(),
      longitude: params.center[0].toString(),
    }
    const { data: address, error: addressError } = (await (supabase
      .from('properties_addresses') as any)
      .insert(addressData)
      .select()
      .single()) as { data: Property['address'] | null; error: any }

    if (addressError || !address) {
      return {
        success: false,
        error: addressError?.message || 'Failed to create address',
      }
    }

    // Create the property
    const propertyData = {
      id: propertyId,
      name: params.name,
      address_id: address.id,
      owner_id: session.user.id,
      is_private: params.isPrivate !== undefined ? params.isPrivate : true,
      details_json: {
        coordinates: params.center,
        createdFrom: 'editor-app',
      },
    }
    const { data, error } = (await (supabase
      .from('properties') as any)
      .insert(propertyData)
      .select(`
        *,
        address:properties_addresses(*)
      `)
      .single()) as { data: Property | null; error: any }

    if (error) {
      return {
        success: false,
        error: error.message,
      }
    }

    // If scene graph is provided, create the model
    if (params.sceneGraph) {
      const modelId = createId('model')
      const { error: modelError } = await supabase.from('properties_models').insert({
        id: modelId,
        property_id: propertyId,
        version: 1,
        scene_graph: params.sceneGraph,
      } as any)

      if (modelError) {
        console.error('Failed to create model:', modelError)
        // Don't fail the property creation if model creation fails
      }
    }

    return {
      success: true,
      data: data as Property,
      message: 'Property created successfully',
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create property',
    }
  }
}

/**
 * Check if a property with the given address already exists
 */
export async function checkPropertyDuplicate(params: {
  streetNumber?: string
  route?: string
  city?: string
  state?: string
  postalCode?: string
}): Promise<
  ActionResult<{
    isDuplicate: boolean
    isUserProperty?: boolean
    existingProperty?: Property
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

    // Query for existing property with matching address
    const { data, error } = await supabase
      .from('properties')
      .select(`
        *,
        address:properties_addresses!inner(*)
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
      const existingProperty = data[0] as unknown as Property
      return {
        success: true,
        data: {
          isDuplicate: true,
          isUserProperty: existingProperty.owner_id === session.user.id,
          existingProperty,
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
 * Fetch public properties for community hub
 */
export async function getPublicProperties(): Promise<ActionResult<Property[]>> {
  try {
    const supabase = await createServerSupabaseClient()

    const { data, error } = await supabase
      .from('properties')
      .select(`
        *,
        address:properties_addresses(*)
      `)
      .eq('is_private', false)
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
      data: data as Property[],
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch public properties',
      data: [],
    }
  }
}

/**
 * Get a property model for viewing
 * Allows viewing if: property is public OR user owns the property
 */
export async function getPropertyModelPublic(propertyId: string): Promise<
  ActionResult<{ property: Property; model: any | null }>
> {
  try {
    const session = await getSession()
    const supabase = await createServerSupabaseClient()

    // Get the property (without privacy filter first)
    const { data: property, error: propertyError } = await supabase
      .from('properties')
      .select(`
        *,
        address:properties_addresses(*)
      `)
      .eq('id', propertyId)
      .single()

    if (propertyError || !property) {
      return {
        success: false,
        error: 'Property not found',
        data: undefined,
      }
    }

    // Check if user can view this property
    // Allow if: property is public OR user owns it
    const propertyData = property as any
    const isOwner = session?.user && propertyData.owner_id === session.user.id
    const isPublic = propertyData.is_private === false

    if (!isPublic && !isOwner) {
      return {
        success: false,
        error: 'Property is private',
        data: undefined,
      }
    }

    // Get the model
    const { data: model } = await supabase
      .from('properties_models')
      .select('*')
      .eq('property_id', propertyId)
      .is('deleted_at', null)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle()

    return {
      success: true,
      data: {
        property: propertyData as Property,
        model: model || null,
      },
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch property',
      data: undefined,
    }
  }
}

/**
 * Increment property view count
 */
export async function incrementPropertyViews(propertyId: string): Promise<ActionResult> {
  try {
    const supabase = await createServerSupabaseClient()

    const { error } = await supabase.rpc('increment_property_views', {
      property_id: propertyId,
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
 * Update property privacy setting
 */
export async function updatePropertyPrivacy(
  propertyId: string,
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
    const { data: property } = await supabase
      .from('properties')
      .select('owner_id')
      .eq('id', propertyId)
      .single()

    if ((property as any)?.owner_id !== session.user.id) {
      return {
        success: false,
        error: 'Unauthorized',
      }
    }

    // Update privacy
    const { error } = await (supabase
      .from('properties') as any)
      .update({ is_private: isPrivate })
      .eq('id', propertyId)

    if (error) {
      return {
        success: false,
        error: error.message,
      }
    }

    return {
      success: true,
      message: `Property is now ${isPrivate ? 'private' : 'public'}`,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update property privacy',
    }
  }
}

/**
 * Update property address
 */
export async function updatePropertyAddress(
  propertyId: string,
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
    const { data: property } = await supabase
      .from('properties')
      .select('owner_id, address_id')
      .eq('id', propertyId)
      .single()

    if (!property) {
      return {
        success: false,
        error: 'Property not found',
      }
    }

    if ((property as any).owner_id !== session.user.id) {
      return {
        success: false,
        error: 'Unauthorized',
      }
    }

    // Update address
    const { error } = await (supabase
      .from('properties_addresses') as any)
      .update(addressData)
      .eq('id', (property as any).address_id)

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
 * Migrate a local property to the cloud
 * Creates a new property with the local property's data
 */
export async function migrateLocalProperty(
  localProperty: {
    name: string
    scene_graph: any
  },
): Promise<ActionResult<{ id: string }>> {
  try {
    const session = await getSession()

    if (!session?.user) {
      return {
        success: false,
        error: 'Not authenticated',
      }
    }

    const supabase = await createServerSupabaseClient()

    // Create a default address (user can edit later via settings)
    const addressId = createId('address')
    const { error: addressError } = await (supabase.from('properties_addresses') as any).insert({
      id: addressId,
      country: 'US',
    })

    if (addressError) {
      return {
        success: false,
        error: addressError.message,
      }
    }

    // Create the property
    const propertyId = createId('property')
    const { error: propertyError } = await (supabase.from('properties') as any).insert({
      id: propertyId,
      name: localProperty.name,
      owner_id: session.user.id,
      address_id: addressId,
      is_private: true, // Default to private
    })

    if (propertyError) {
      return {
        success: false,
        error: propertyError.message,
      }
    }

    // Create the model with the scene graph
    if (localProperty.scene_graph) {
      const modelId = createId('model')
      const { error: modelError } = await (supabase.from('properties_models') as any).insert({
        id: modelId,
        property_id: propertyId,
        version: 1,
        scene_graph: localProperty.scene_graph,
      })

      if (modelError) {
        return {
          success: false,
          error: modelError.message,
        }
      }
    }

    return {
      success: true,
      data: { id: propertyId },
      message: 'Property migrated successfully',
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to migrate property',
    }
  }
}

/**
 * Delete a property
 * Only the owner can delete their property
 */
export async function deleteProperty(propertyId: string): Promise<ActionResult> {
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
    const { data: property } = await supabase
      .from('properties')
      .select('owner_id')
      .eq('id', propertyId)
      .single()

    if (!property) {
      return {
        success: false,
        error: 'Property not found',
      }
    }

    if ((property as any).owner_id !== session.user.id) {
      return {
        success: false,
        error: 'Unauthorized',
      }
    }

    // Delete the property (cascade will delete related records)
    const { error } = await supabase.from('properties').delete().eq('id', propertyId)

    if (error) {
      return {
        success: false,
        error: error.message,
      }
    }

    return {
      success: true,
      message: 'Property deleted successfully',
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete property',
    }
  }
}

/**
 * Check if the current user has liked specific properties
 * Returns a map of propertyId -> boolean
 */
export async function getUserPropertyLikes(
  propertyIds: string[],
): Promise<ActionResult<Record<string, boolean>>> {
  try {
    const session = await getSession()

    if (!session?.user || propertyIds.length === 0) {
      // Return empty map for unauthenticated users or no properties
      return {
        success: true,
        data: {},
      }
    }

    const supabase = await createServerSupabaseClient()

    const { data: likes, error } = await supabase
      .from('property_likes')
      .select('property_id')
      .eq('user_id', session.user.id)
      .in('property_id', propertyIds)

    if (error) {
      return {
        success: false,
        error: error.message,
        data: {},
      }
    }

    // Convert array to map
    const likeMap: Record<string, boolean> = {}
    propertyIds.forEach((id) => {
      likeMap[id] = likes?.some((like) => (like as any).property_id === id) || false
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
 * Toggle like on a property
 * Returns the new like state and updated like count
 */
export async function togglePropertyLike(
  propertyId: string,
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

    // Check if user has already liked this property
    const { data: existingLike } = await supabase
      .from('property_likes')
      .select('id')
      .eq('property_id', propertyId)
      .eq('user_id', userId)
      .maybeSingle()

    let liked = false

    if (existingLike) {
      // Unlike - remove the like
      const { error } = await (supabase
        .from('property_likes') as any)
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
      const { error } = await (supabase.from('property_likes') as any).insert({
        id: likeId,
        property_id: propertyId,
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
    const { data: likeCount } = await supabase.rpc('get_property_like_count', {
      property_id: propertyId,
    } as any)

    // Update the property's like count cache
    await (supabase
      .from('properties') as any)
      .update({ likes: likeCount || 0 })
      .eq('id', propertyId)

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
 * Upload a thumbnail image to Supabase Storage and update the property
 */
export async function uploadPropertyThumbnail(
  propertyId: string,
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

    // Verify the user owns this property
    const { data: property, error: propertyError } = await supabase
      .from('properties')
      .select('owner_id')
      .eq('id', propertyId)
      .single()

    if (propertyError || !property) {
      return { success: false, error: 'Property not found' }
    }

    if ((property as any).owner_id !== session.user.id) {
      return { success: false, error: 'Not authorized to update this property' }
    }

    // Generate a unique filename
    const timestamp = Date.now()
    const filename = `${propertyId}/${timestamp}.png`

    // Upload to Supabase Storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('property-thumbnails')
      .upload(filename, blob, {
        contentType: 'image/png',
        upsert: false,
      })

    if (uploadError) {
      return { success: false, error: `Upload failed: ${uploadError.message}` }
    }

    // Get the public URL
    const { data: urlData } = supabase.storage
      .from('property-thumbnails')
      .getPublicUrl(uploadData.path)

    const thumbnailUrl = urlData.publicUrl

    // Update the property with the new thumbnail URL
    const { error: updateError } = await (supabase
      .from('properties') as any)
      .update({ thumbnail_url: thumbnailUrl })
      .eq('id', propertyId)

    if (updateError) {
      return { success: false, error: `Failed to update property: ${updateError.message}` }
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
