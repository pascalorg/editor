/**
 * Local storage management for guest users
 * Stores projects and scenes in browser localStorage
 */

import { createId } from '../utils/id-generator'

export interface SceneGraph {
  nodes: Record<string, any>
  rootNodeIds: string[]
}

export interface LocalProject {
  id: string // Format: 'local_project_xyz'
  name: string
  created_at: string
  updated_at: string
  scene_graph: SceneGraph | null
  is_local: true
}

const LOCAL_PROJECTS_KEY = 'pascal_local_projects'
// Keep old key for migration
const LEGACY_LOCAL_PROPERTIES_KEY = 'pascal_local_properties'

function migrateLegacyStorage(): void {
  if (typeof window === 'undefined') return

  try {
    const legacy = localStorage.getItem(LEGACY_LOCAL_PROPERTIES_KEY)
    if (legacy && !localStorage.getItem(LOCAL_PROJECTS_KEY)) {
      // Migrate old data to new key
      const parsed = JSON.parse(legacy)
      // Update IDs from local_property_* to local_project_*
      const migrated = parsed.map((p: any) => ({
        ...p,
        id: p.id.replace('local_property_', 'local_project_'),
      }))
      localStorage.setItem(LOCAL_PROJECTS_KEY, JSON.stringify(migrated))
      localStorage.removeItem(LEGACY_LOCAL_PROPERTIES_KEY)
    }
  } catch (error) {
    console.error('Failed to migrate legacy local properties:', error)
  }
}

export function getLocalProjects(): LocalProject[] {
  if (typeof window === 'undefined') return []

  migrateLegacyStorage()

  try {
    const stored = localStorage.getItem(LOCAL_PROJECTS_KEY)
    return stored ? JSON.parse(stored) : []
  } catch (error) {
    console.error('Failed to load local projects:', error)
    return []
  }
}

export function getLocalProject(id: string): LocalProject | null {
  const projects = getLocalProjects()
  return projects.find((p) => p.id === id) || null
}

export function saveLocalProject(project: LocalProject): void {
  const projects = getLocalProjects()
  const index = projects.findIndex((p) => p.id === project.id)

  if (index >= 0) {
    projects[index] = { ...project, updated_at: new Date().toISOString() }
  } else {
    projects.push(project)
  }

  localStorage.setItem(LOCAL_PROJECTS_KEY, JSON.stringify(projects))
}

export function createLocalProject(name: string): LocalProject {
  const project: LocalProject = {
    id: createId('local_project'),
    name,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    scene_graph: null,
    is_local: true,
  }

  saveLocalProject(project)
  return project
}

export function deleteLocalProject(id: string): void {
  const projects = getLocalProjects().filter((p) => p.id !== id)
  localStorage.setItem(LOCAL_PROJECTS_KEY, JSON.stringify(projects))
}

export function updateLocalProjectScene(id: string, sceneGraph: SceneGraph): void {
  const project = getLocalProject(id)
  if (project) {
    project.scene_graph = sceneGraph
    saveLocalProject(project)
  }
}

export function migrateLocalProjectsToCloud(userId: string): LocalProject[] {
  // Return local projects that need to be migrated
  // Actual migration handled by separate function
  return getLocalProjects()
}

export function clearLocalProjects(): void {
  localStorage.removeItem(LOCAL_PROJECTS_KEY)
}
