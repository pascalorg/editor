import { Color, DoubleSide, FrontSide, MeshPhysicalMaterial, MeshStandardMaterial } from 'three'
import { depth } from 'three/src/nodes/TSL.js'
import { getMaterialPreset } from './presets'
import type { MaterialDefinition, MaterialName } from './types'

type MaterialResult = MeshStandardMaterial | MeshPhysicalMaterial

/**
 * Singleton cache for materials - created lazily on first use
 */
const materialCache = new Map<MaterialName, MaterialResult>()

/**
 * Create a Three.js material from a MaterialDefinition (internal use)
 */
function createMaterial(definition: MaterialDefinition): MaterialResult {
  const baseProps = {
    name: definition.name,
    color: new Color(definition.color),
    side: FrontSide,
    opacity: definition.opacity ?? 1,
    transparent:
      definition.transparent ?? (definition.opacity !== undefined && definition.opacity < 1),
    metalness: definition.metalness ?? 0,
    roughness: definition.roughness ?? 0.5,
    emissive: definition.emissive ? new Color(definition.emissive) : undefined,
    emissiveIntensity: definition.emissiveIntensity,
    depthWrite: definition.depthWrite ?? true,
  }

  if (definition.type === 'physical') {
    return new MeshPhysicalMaterial({
      ...baseProps,
      transmission: definition.transmission,
      thickness: definition.thickness,
      ior: definition.ior,
      clearcoat: definition.clearcoat,
      clearcoatRoughness: definition.clearcoatRoughness,
    })
  }

  return new MeshStandardMaterial(baseProps)
}

/**
 * Get a material by preset name (singleton, lazily created on first use)
 * Falls back to 'white' if the name is not a valid preset
 */
export function getMaterial(name: string): MaterialResult {
  const materialName = name as MaterialName
  let material = materialCache.get(materialName)
  if (!material) {
    const definition = getMaterialPreset(materialName)
    material = createMaterial(definition)
    materialCache.set(materialName, material)
  }
  return material
}

/**
 * Hook to get a material by preset name
 * Materials are singletons - same instance returned for same name
 */
export function useMaterial(name: string): MaterialResult {
  return getMaterial(name)
}

/**
 * Get material props for use with react-three-fiber meshStandardMaterial JSX
 * Use this when you need to spread props onto a material component
 */
export function getMaterialProps(name: MaterialName): {
  color: string
  opacity?: number
  transparent?: boolean
  metalness?: number
  roughness?: number
  emissive?: string
  emissiveIntensity?: number
} {
  const definition = getMaterialPreset(name)
  return {
    color: `#${new Color(definition.color).getHexString()}`,
    opacity: definition.opacity,
    transparent:
      definition.transparent ?? (definition.opacity !== undefined && definition.opacity < 1),
    metalness: definition.metalness,
    roughness: definition.roughness,
    emissive: definition.emissive ? `#${new Color(definition.emissive).getHexString()}` : undefined,
    emissiveIntensity: definition.emissiveIntensity,
  }
}
