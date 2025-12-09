import type { Color, Texture } from 'three'

/**
 * Material preset names for special rendering states
 */
export type MaterialPreset = 'preview-valid' | 'preview-invalid' | 'delete' | 'ghost' | 'glass'

/**
 * Solid color material names
 */
export type MaterialColor =
  | 'white'
  | 'black'
  | 'gray'
  | 'pink'
  | 'green'
  | 'blue'
  | 'red'
  | 'orange'
  | 'yellow'
  | 'purple'

/**
 * Textured material names
 */
export type MaterialTexture = 'brick' | 'wood' | 'concrete' | 'tile' | 'marble'

/**
 * All available material names
 */
export type MaterialName = MaterialPreset | MaterialColor | MaterialTexture

/**
 * Material definition with all configurable properties
 */
export interface MaterialDefinition {
  name: MaterialName
  type: 'standard' | 'physical'
  color: string | number
  opacity?: number
  transparent?: boolean
  metalness?: number
  roughness?: number
  emissive?: string | number
  emissiveIntensity?: number
  // For textured materials
  textureUrl?: string
  normalMapUrl?: string
  roughnessMapUrl?: string
  // For glass/physical materials
  transmission?: number
  thickness?: number
  ior?: number
  clearcoat?: number
  clearcoatRoughness?: number
  depthWrite?: boolean
}

/**
 * Runtime material instance with Three.js types
 */
export interface MaterialInstance {
  definition: MaterialDefinition
  color: Color
  texture?: Texture
  normalMap?: Texture
  roughnessMap?: Texture
}
