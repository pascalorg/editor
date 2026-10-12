import type { WallMaterialsResolver } from '@pascal-app/viewer'
import { getCurtainAwareWallMaterials } from './curtain-wall-materials'

let resolver: WallMaterialsResolver = getCurtainAwareWallMaterials
const listeners = new Set<() => void>()

/**
 * Replaces the resolver `WallCutout` uses for every wall's material set
 * (visible / cut-away / translucent / delete variants). Hosts wrap
 * `getCurtainAwareWallMaterials` to restyle a variant, e.g. the cut-away look;
 * `null` restores the default.
 */
export function setWallMaterialsResolver(next: WallMaterialsResolver | null): void {
  resolver = next ?? getCurtainAwareWallMaterials
  for (const listener of listeners) listener()
}

export function getWallMaterialsResolver(): WallMaterialsResolver {
  return resolver
}

export function subscribeWallMaterialsResolver(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
