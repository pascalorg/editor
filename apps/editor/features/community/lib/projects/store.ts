/**
 * Project store - Zustand store for project state management
 */

import { create } from 'zustand'
import type { Project } from './types'
import {
  getActiveProject,
  getUserProjects,
  getProjectById,
} from './actions'

interface ProjectStore {
  // State
  activeProject: Project | null
  projects: Project[]
  isLoading: boolean
  error: string | null

  // Actions
  fetchProjects: () => Promise<void>
  fetchActiveProject: () => Promise<void>
  setActiveProject: (projectId: string) => Promise<void>
  initialize: () => Promise<void>
  updateActiveThumbnail: (thumbnailUrl: string) => void
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  // Initial state
  activeProject: null,
  projects: [],
  isLoading: true,
  error: null,

  // Fetch all projects
  fetchProjects: async () => {
    const result = await getUserProjects()

    if (result.success) {
      set({ projects: result.data || [], error: null })
    } else {
      set({ error: result.error || 'Failed to fetch projects', projects: [] })
    }
  },

  // Fetch the active project from database
  fetchActiveProject: async () => {
    set({ isLoading: true })

    const result = await getActiveProject()

    if (result.success) {
      set({
        activeProject: result.data || null,
        isLoading: false,
        error: null
      })
      // Note: Auto-select logic removed - now using URL-based routing
      // The URL parameter determines which project to load
    } else {
      set({
        error: result.error || 'Failed to fetch active project',
        activeProject: null,
        isLoading: false
      })
    }
  },

  // Set active project by fetching it directly by ID (URL-based, no session update)
  setActiveProject: async (projectId: string) => {
    set({ isLoading: true })

    const result = await getProjectById(projectId)

    if (result.success && result.data) {
      set({ activeProject: result.data, isLoading: false, error: null })
    } else {
      set({ isLoading: false, error: result.error || 'Project not found' })
    }
  },

  // Patch the active project's thumbnail URL in place (no refetch)
  updateActiveThumbnail: (thumbnailUrl: string) => {
    set((state) => ({
      activeProject: state.activeProject
        ? { ...state.activeProject, thumbnail_url: thumbnailUrl }
        : null,
    }))
  },

  // Initialize - fetch both projects and active project
  initialize: async () => {
    set({ isLoading: true })
    await Promise.all([
      get().fetchProjects(),
      get().fetchActiveProject(),
    ])
  },
}))
