/**
 * Property actions - Server actions for property management
 * Uses Better Auth session + Supabase to query the same database as the monorepo
 */

'use server'

import { createServerSupabaseClient } from '../database/server'
import { getSession } from '../auth/server'
import { createId } from '../utils/id-generator'
import type { CreatePropertyParams, Property } from './types'

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
