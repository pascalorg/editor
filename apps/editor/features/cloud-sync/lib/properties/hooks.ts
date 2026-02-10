'use client'

import { useCallback, useEffect, useState } from 'react'
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

  const fetchActiveProperty = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)

      const result = await getActiveProperty()

      if (result.success) {
        setActivePropertyState(result.data || null)

        // If no active property is set, automatically set the first property as active
        if (!result.data) {
          const propertiesResult = await getUserProperties()

          if (
            propertiesResult.success &&
            propertiesResult.data &&
            propertiesResult.data.length > 0
          ) {
            const firstProperty = propertiesResult.data[0]
            if (firstProperty) {
              const setActiveResult = await setActivePropertyAction(firstProperty.id)

              if (setActiveResult.success) {
                setActivePropertyState(firstProperty)
              }
            }
          }
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
        const result = await setActivePropertyAction(propertyId)

        if (result.success) {
          // Fetch the updated active property
          if (propertyId) {
            await fetchActiveProperty()
          } else {
            setActivePropertyState(null)
          }
        } else {
          console.error(result.error || 'Failed to update active property')
        }
      } catch (err) {
        console.error(err instanceof Error ? err.message : 'An unexpected error occurred')
      } finally {
        setIsPending(false)
      }
    },
    [fetchActiveProperty],
  )

  useEffect(() => {
    fetchActiveProperty()
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
