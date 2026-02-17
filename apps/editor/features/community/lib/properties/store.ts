/**
 * Property store - Zustand store for property state management
 */

import { create } from 'zustand'
import type { Property } from './types'
import {
  getActiveProperty,
  getUserProperties,
  getPropertyById,
} from './actions'

interface PropertyStore {
  // State
  activeProperty: Property | null
  properties: Property[]
  isLoading: boolean
  error: string | null

  // Actions
  fetchProperties: () => Promise<void>
  fetchActiveProperty: () => Promise<void>
  setActiveProperty: (propertyId: string) => Promise<void>
  initialize: () => Promise<void>
}

export const usePropertyStore = create<PropertyStore>((set, get) => ({
  // Initial state
  activeProperty: null,
  properties: [],
  isLoading: true,
  error: null,

  // Fetch all properties
  fetchProperties: async () => {
    const result = await getUserProperties()

    if (result.success) {
      set({ properties: result.data || [], error: null })
    } else {
      set({ error: result.error || 'Failed to fetch properties', properties: [] })
    }
  },

  // Fetch the active property from database
  fetchActiveProperty: async () => {
    set({ isLoading: true })

    const result = await getActiveProperty()

    if (result.success) {
      set({
        activeProperty: result.data || null,
        isLoading: false,
        error: null
      })
      // Note: Auto-select logic removed - now using URL-based routing
      // The URL parameter determines which property to load
    } else {
      set({
        error: result.error || 'Failed to fetch active property',
        activeProperty: null,
        isLoading: false
      })
    }
  },

  // Set active property by fetching it directly by ID (URL-based, no session update)
  setActiveProperty: async (propertyId: string) => {
    set({ isLoading: true })

    const result = await getPropertyById(propertyId)

    if (result.success && result.data) {
      set({ activeProperty: result.data, isLoading: false, error: null })
    } else {
      set({ isLoading: false, error: result.error || 'Property not found' })
    }
  },

  // Initialize - fetch both properties and active property
  initialize: async () => {
    set({ isLoading: true })
    await Promise.all([
      get().fetchProperties(),
      get().fetchActiveProperty(),
    ])
  },
}))
