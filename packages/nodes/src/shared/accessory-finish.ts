import type { SurfaceRole } from '@pascal-app/core'
import {
  type ColorPreset,
  createMaterial,
  createSurfaceRoleMaterial,
  type RenderShading,
  registerMaterialCacheCleanup,
  resolveSurfaceColor,
} from '@pascal-app/viewer'
import { FrontSide, type Material, type Side } from 'three'

export type AccessoryFinish = 'coated' | 'metal' | 'mineral'
const finishes = {
  coated: { roughness: 0.38, metalness: 0.12 },
  metal: { roughness: 0.3, metalness: 0.65 },
  mineral: { roughness: 0.88, metalness: 0 },
}
const glassCache = new Map<string, Material>()
registerMaterialCacheCleanup(() => {
  for (const material of glassCache.values()) material.dispose()
  glassCache.clear()
})

/** Unpainted finishes retain the active theme; explicit paint bypasses this cache. */
export function accessoryFinish(
  role: SurfaceRole,
  preset: ColorPreset,
  side: Side = FrontSide,
  theme?: string,
  shading: RenderShading = 'solid',
  finish: AccessoryFinish = role === 'wall' ? 'mineral' : 'coated',
): Material {
  if (shading === 'solid') return createSurfaceRoleMaterial(role, preset, side, theme)
  const color = resolveSurfaceColor(role, preset, theme)
  const glass = role === 'glazing'
  const material = createMaterial(
    {
      preset: glass ? 'glass' : 'custom',
      properties: {
        color,
        ...(glass ? { roughness: 0.12, metalness: 0 } : finishes[finish]),
        opacity: glass ? 0.25 : 1,
        transparent: glass,
        side: 'front',
      },
    },
    shading,
  )
  if (!glass) return material
  const existing = glassCache.get(color)
  if (existing) return existing
  // Glass must not occlude later transparent panes through depth writes.
  const glazing = material.clone()
  glazing.depthWrite = false
  glazing.userData.__pascalCachedMaterial = true
  glassCache.set(color, glazing)
  return glazing
}
