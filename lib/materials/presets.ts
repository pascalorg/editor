import { COLORS } from './colors'
import type { MaterialDefinition, MaterialName } from './types'

/**
 * Predefined material definitions for common use cases
 */
export const MATERIAL_PRESETS: Record<MaterialName, MaterialDefinition> = {
  // === Preset states ===
  'preview-valid': {
    name: 'preview-valid',
    type: 'standard',
    color: COLORS.previewValid,
    opacity: 0.6,
    transparent: true,
    metalness: 0,
    roughness: 1,
    emissive: COLORS.previewValid,
    emissiveIntensity: 0.3,
  },
  'preview-invalid': {
    name: 'preview-invalid',
    type: 'standard',
    color: COLORS.previewInvalid,
    opacity: 0.6,
    transparent: true,
    metalness: 0,
    roughness: 1,
    emissive: COLORS.previewInvalid,
    emissiveIntensity: 0.3,
  },
  delete: {
    name: 'delete',
    type: 'standard',
    color: COLORS.delete,
    opacity: 0.8,
    transparent: true,
    metalness: 0,
    roughness: 1,
    emissive: COLORS.delete,
    emissiveIntensity: 0.5,
  },
  ghost: {
    name: 'ghost',
    type: 'standard',
    color: COLORS.ghost,
    opacity: 0.3,
    transparent: true,
    metalness: 0,
    roughness: 1,
  },
  glass: {
    name: 'glass',
    type: 'standard',
    color: COLORS.glass,
    opacity: 0.2,
    transparent: true,
    metalness: 0.4,
    roughness: 1,
    transmission: 0.95,
    thickness: 0.5,
    ior: 1.5,
    depthWrite: false,
  },

  // === Solid colors ===
  white: {
    name: 'white',
    type: 'standard',
    color: COLORS.white,
    metalness: 0,
    roughness: 0.8,
  },
  black: {
    name: 'black',
    type: 'standard',
    color: COLORS.black,
    metalness: 0,
    roughness: 0.8,
  },
  gray: {
    name: 'gray',
    type: 'standard',
    color: COLORS.gray,
    metalness: 0,
    roughness: 0.8,
  },
  pink: {
    name: 'pink',
    type: 'standard',
    color: COLORS.pink,
    metalness: 0,
    roughness: 0.8,
  },
  green: {
    name: 'green',
    type: 'standard',
    color: COLORS.green,
    metalness: 0,
    roughness: 0.8,
  },
  blue: {
    name: 'blue',
    type: 'standard',
    color: COLORS.blue,
    metalness: 0,
    roughness: 0.8,
  },
  red: {
    name: 'red',
    type: 'standard',
    color: COLORS.red,
    metalness: 0,
    roughness: 0.8,
  },
  orange: {
    name: 'orange',
    type: 'standard',
    color: COLORS.orange,
    metalness: 0,
    roughness: 0.8,
  },
  yellow: {
    name: 'yellow',
    type: 'standard',
    color: COLORS.yellow,
    metalness: 0,
    roughness: 0.8,
  },
  purple: {
    name: 'purple',
    type: 'standard',
    color: COLORS.purple,
    metalness: 0,
    roughness: 0.8,
  },

  // === Textured materials ===
  brick: {
    name: 'brick',
    type: 'standard',
    color: 0xaa_66_44,
    metalness: 0,
    roughness: 0.9,
    textureUrl: '/textures/brick/diffuse.jpg',
    normalMapUrl: '/textures/brick/normal.jpg',
    roughnessMapUrl: '/textures/brick/roughness.jpg',
  },
  wood: {
    name: 'wood',
    type: 'standard',
    color: 0xbb_88_55,
    metalness: 0,
    roughness: 0.7,
    textureUrl: '/textures/wood/diffuse.jpg',
    normalMapUrl: '/textures/wood/normal.jpg',
    roughnessMapUrl: '/textures/wood/roughness.jpg',
  },
  concrete: {
    name: 'concrete',
    type: 'standard',
    color: 0x99_99_99,
    metalness: 0,
    roughness: 0.95,
    textureUrl: '/textures/concrete/diffuse.jpg',
    normalMapUrl: '/textures/concrete/normal.jpg',
    roughnessMapUrl: '/textures/concrete/roughness.jpg',
  },
  tile: {
    name: 'tile',
    type: 'standard',
    color: 0xdd_dd_dd,
    metalness: 0.1,
    roughness: 0.3,
    textureUrl: '/textures/tile/diffuse.jpg',
    normalMapUrl: '/textures/tile/normal.jpg',
  },
  marble: {
    name: 'marble',
    type: 'standard',
    color: 0xf0_f0_f0,
    metalness: 0.2,
    roughness: 0.2,
    textureUrl: '/textures/marble/diffuse.jpg',
    normalMapUrl: '/textures/marble/normal.jpg',
  },
}

/**
 * Get a material definition by name
 */
export function getMaterialPreset(name: MaterialName): MaterialDefinition {
  return MATERIAL_PRESETS[name]
}
