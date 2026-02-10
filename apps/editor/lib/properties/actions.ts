/**
 * Property actions - API client for property management
 * Makes HTTP requests to the Pascal monorepo backend
 */

import type { CreatePropertyParams, Property } from './types'

export type ActionResult<T = unknown> = {
  success: boolean
  data?: T
  error?: string
  message?: string
}

/**
 * Get the backend API URL
 */
function getBackendURL(): string {
  if (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL
  }
  if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
    return 'http://localhost:3000'
  }
  return typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000'
}

/**
 * Fetch all properties for the current user
 */
export async function getUserProperties(): Promise<ActionResult<Property[]>> {
  try {
    const response = await fetch(`${getBackendURL()}/api/properties`, {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      const error = await response.text()
      return {
        success: false,
        error: error || 'Failed to fetch properties',
        data: [],
      }
    }

    const result = await response.json()
    return {
      success: true,
      data: result.data || [],
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
    const response = await fetch(`${getBackendURL()}/api/properties/active`, {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      const error = await response.text()
      return {
        success: false,
        error: error || 'Failed to fetch active property',
        data: null,
      }
    }

    const result = await response.json()
    return {
      success: true,
      data: result.data || null,
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
    const response = await fetch(`${getBackendURL()}/api/properties/active`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ propertyId }),
    })

    if (!response.ok) {
      const error = await response.text()
      return {
        success: false,
        error: error || 'Failed to set active property',
      }
    }

    const result = await response.json()
    return {
      success: true,
      message: result.message || (propertyId ? 'Active property updated' : 'Active property cleared'),
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to set active property',
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
    const response = await fetch(`${getBackendURL()}/api/properties/check-duplicate`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    })

    if (!response.ok) {
      const error = await response.text()
      return {
        success: false,
        error: error || 'Failed to check for duplicates',
      }
    }

    const result = await response.json()
    return {
      success: true,
      data: result.data || { isDuplicate: false },
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to check for duplicates',
    }
  }
}

/**
 * Create a new property
 */
export async function createProperty(params: CreatePropertyParams): Promise<ActionResult<Property>> {
  try {
    const response = await fetch(`${getBackendURL()}/api/properties`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    })

    if (!response.ok) {
      const error = await response.text()
      return {
        success: false,
        error: error || 'Failed to create property',
      }
    }

    const result = await response.json()
    return {
      success: true,
      data: result.data,
      message: result.message || 'Property created successfully',
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create property',
    }
  }
}
