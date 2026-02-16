/**
 * Local storage management for guest users
 * Stores properties and scenes in browser localStorage
 */

import { createId } from '../utils/id-generator'

export interface SceneGraph {
  nodes: Record<string, any>
  rootNodeIds: string[]
}

export interface LocalProperty {
  id: string // Format: 'local_property_xyz'
  name: string
  created_at: string
  updated_at: string
  scene_graph: SceneGraph | null
  is_local: true
}

const LOCAL_PROPERTIES_KEY = 'pascal_local_properties'

export function getLocalProperties(): LocalProperty[] {
  if (typeof window === 'undefined') return []

  try {
    const stored = localStorage.getItem(LOCAL_PROPERTIES_KEY)
    return stored ? JSON.parse(stored) : []
  } catch (error) {
    console.error('Failed to load local properties:', error)
    return []
  }
}

export function getLocalProperty(id: string): LocalProperty | null {
  const properties = getLocalProperties()
  return properties.find((p) => p.id === id) || null
}

export function saveLocalProperty(property: LocalProperty): void {
  const properties = getLocalProperties()
  const index = properties.findIndex((p) => p.id === property.id)

  if (index >= 0) {
    properties[index] = { ...property, updated_at: new Date().toISOString() }
  } else {
    properties.push(property)
  }

  localStorage.setItem(LOCAL_PROPERTIES_KEY, JSON.stringify(properties))
}

export function createLocalProperty(name: string): LocalProperty {
  const property: LocalProperty = {
    id: createId('local_property'),
    name,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    scene_graph: null,
    is_local: true,
  }

  saveLocalProperty(property)
  return property
}

export function deleteLocalProperty(id: string): void {
  const properties = getLocalProperties().filter((p) => p.id !== id)
  localStorage.setItem(LOCAL_PROPERTIES_KEY, JSON.stringify(properties))
}

export function updateLocalPropertyScene(id: string, sceneGraph: SceneGraph): void {
  const property = getLocalProperty(id)
  if (property) {
    property.scene_graph = sceneGraph
    saveLocalProperty(property)
  }
}

export function migrateLocalPropertiesToCloud(userId: string): LocalProperty[] {
  // Return local properties that need to be migrated
  // Actual migration handled by separate function
  return getLocalProperties()
}

export function clearLocalProperties(): void {
  localStorage.removeItem(LOCAL_PROPERTIES_KEY)
}
