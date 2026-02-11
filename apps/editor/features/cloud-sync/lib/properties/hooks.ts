'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getActiveProperty,
  getUserProperties,
  setActiveProperty as setActivePropertyAction,
} from './actions'
import type { Property } from './types'

interface UsePropertiesReturn {
  properties: Property[]
  isLoading: boolean
  error: string | null
  refetch: () => Promise<void>
}

/**
 * Hook to fetch and manage user properties
 */
export function useProperties(): UsePropertiesReturn {
  const [properties, setProperties] = useState<Property[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchProperties = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)

      const result = await getUserProperties()

      if (result.success) {
        setProperties(result.data || [])
      } else {
        setError(result.error || 'Failed to fetch properties')
        setProperties([])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred')
      setProperties([])
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchProperties()
  }, [fetchProperties])

  return {
    properties,
    isLoading,
    error,
    refetch: fetchProperties,
  }
}

/**
 * Hook to fetch a single property by ID
 */
export function useProperty(propertyId: string | undefined) {
  const [property, setProperty] = useState<Property | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!propertyId) {
      setProperty(null)
      setIsLoading(false)
      return
    }

    const fetchProperty = async () => {
      try {
        setIsLoading(true)
        setError(null)

        const result = await getUserProperties()

        if (result.success) {
          const found = result.data?.find((p) => p.id === propertyId)
          if (found) {
            setProperty(found)
          } else {
            setError('Property not found')
            setProperty(null)
          }
        } else {
          setError(result.error || 'Failed to fetch property')
          setProperty(null)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An unexpected error occurred')
        setProperty(null)
      } finally {
        setIsLoading(false)
      }
    }

    fetchProperty()
  }, [propertyId])

  return {
    property,
    isLoading,
    error,
  }
}

/**
 * Hook to manage the active property for the current session
 */
export function useActiveProperty() {
  const [activeProperty, setActivePropertyState] = useState<Property | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isPending, setIsPending] = useState(false)
  const isInitialFetchRef = useRef(true)

  const fetchActiveProperty = useCallback(async (allowAutoSelect = false) => {
    try {
      setIsLoading(true)
      setError(null)

      const result = await getActiveProperty()

      if (result.success) {
        setActivePropertyState(result.data || null)

        // If no active property is set, automatically set the first property as active
        // Only do this on initial mount to avoid interfering with property selection/creation
        if (!result.data && allowAutoSelect) {
          console.log('[useActiveProperty] No active property, checking if we should auto-select')
          const propertiesResult = await getUserProperties()

          if (
            propertiesResult.success &&
            propertiesResult.data &&
            propertiesResult.data.length > 0
          ) {
            console.log('[useActiveProperty] Found properties, auto-selecting first one')
            const firstProperty = propertiesResult.data[0]
            if (firstProperty) {
              const setActiveResult = await setActivePropertyAction(firstProperty.id)

              if (setActiveResult.success) {
                console.log('[useActiveProperty] Auto-selected property:', firstProperty.name)
                setActivePropertyState(firstProperty)
              }
            }
          }
        } else if (!result.data && !allowAutoSelect) {
          console.log('[useActiveProperty] No active property but auto-select is disabled')
        }
      } else {
        setError(result.error || 'Failed to fetch active property')
        setActivePropertyState(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred')
      setActivePropertyState(null)
    } finally {
      setIsLoading(false)
    }
  }, [])

  const changeActiveProperty = useCallback(
    async (propertyId: string | null) => {
      try {
        setIsPending(true)
        setIsLoading(true)
        const result = await setActivePropertyAction(propertyId)

        if (result.success) {
          if (propertyId) {
            // Fetch the property data and set it immediately
            console.log('[useActiveProperty] Fetching property data for ID:', propertyId)
            const propertiesResult = await getUserProperties()

            if (propertiesResult.success && propertiesResult.data) {
              const selectedProperty = propertiesResult.data.find(p => p.id === propertyId)
              if (selectedProperty) {
                console.log('[useActiveProperty] Found property, setting as active:', selectedProperty.name)
                console.log('[useActiveProperty] Current isLoading state:', isLoading)
                setActivePropertyState(selectedProperty)
                setIsLoading(false)
                console.log('[useActiveProperty] Set isLoading to false')
              } else {
                console.error('[useActiveProperty] Property not found in user properties')
                // Fall back to refetch
                await fetchActiveProperty(false)
              }
            } else {
              console.error('[useActiveProperty] Failed to fetch properties')
              // Fall back to refetch
              await fetchActiveProperty(false)
            }
          } else {
            setActivePropertyState(null)
            setIsLoading(false)
          }
        } else {
          console.error(result.error || 'Failed to update active property')
          setIsLoading(false)
        }
      } catch (err) {
        console.error(err instanceof Error ? err.message : 'An unexpected error occurred')
        setIsLoading(false)
      } finally {
        setIsPending(false)
      }
    },
    [fetchActiveProperty],
  )

  useEffect(() => {
    // Only allow auto-select on the initial mount
    const allowAutoSelect = isInitialFetchRef.current
    if (isInitialFetchRef.current) {
      isInitialFetchRef.current = false
    }
    fetchActiveProperty(allowAutoSelect)
  }, [fetchActiveProperty])

  return {
    activeProperty,
    isLoading,
    error,
    setActiveProperty: changeActiveProperty,
    isPending,
    refetch: fetchActiveProperty,
  }
}
