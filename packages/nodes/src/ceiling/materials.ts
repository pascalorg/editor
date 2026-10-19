import {
  getCatalogMaterialById,
  getMaterialPresetByRef,
  type MaterialSchema,
  parseMaterialColor,
  parseMaterialRef,
  resolveMaterial,
  type SceneMaterial,
  type SceneMaterialId,
} from '@pascal-app/core'
import { createMaterial, createMaterialFromPreset, type RenderShading } from '@pascal-app/viewer'
import type { Material } from 'three'
import { float, mix, positionWorld, smoothstep } from 'three/tsl'
import { BackSide, FrontSide, MeshBasicNodeMaterial } from 'three/webgpu'

/**
 * Ceiling material builders, shared by the renderer (mesh appearance) and the
 * paint capability (hover preview). The underside faces the room, while
 * the `top` carries a transparent TSL grid overlay used while placing /
 * selecting ceiling-hosted items. Only the overlay reduces a finish to colour;
 * the underside keeps its lighting, textures and physical properties.
 */

const gridScale = 5
const gridX = positionWorld.x.mul(gridScale).fract()
const gridY = positionWorld.z.mul(gridScale).fract()
const lineWidth = 0.05
const lineX = smoothstep(lineWidth, 0, gridX).add(smoothstep(1.0 - lineWidth, 1.0, gridX))
const lineY = smoothstep(lineWidth, 0, gridY).add(smoothstep(1.0 - lineWidth, 1.0, gridY))
const gridPattern = lineX.max(lineY)
const gridOpacity = mix(float(0.2), float(0.6), gridPattern)

export type CeilingMaterials = {
  topMaterial: MeshBasicNodeMaterial
  bottomMaterial: Material
}

function createCeilingGrid(color: string): MeshBasicNodeMaterial {
  const topMaterial = new MeshBasicNodeMaterial({
    color,
    transparent: true,
    depthWrite: false,
    side: FrontSide,
  })
  topMaterial.opacityNode = gridOpacity

  return topMaterial
}

const ceilingGridCache = new Map<string, MeshBasicNodeMaterial>()

export function getCeilingMaterials(
  color = '#999999',
  shading: RenderShading = 'rendered',
): CeilingMaterials {
  let topMaterial = ceilingGridCache.get(color)
  if (!topMaterial) {
    topMaterial = createCeilingGrid(color)
    ceilingGridCache.set(color, topMaterial)
  }
  return {
    topMaterial,
    bottomMaterial: createMaterial(
      {
        preset: 'custom',
        properties: {
          color,
          roughness: 0.9,
          metalness: 0,
          opacity: 1,
          transparent: false,
          side: 'back',
        },
      },
      shading,
    ),
  }
}

/** Resolve through the shared caches, without mutating another surface's material. */
export function resolveCeilingFinish(
  finish: MaterialSchema | string | undefined,
  sceneMaterials: Record<SceneMaterialId, SceneMaterial> | undefined,
  shading: RenderShading,
): Material | null {
  if (!finish) return null
  if (typeof finish !== 'string') {
    return createMaterial(
      { ...finish, properties: { ...resolveMaterial(finish), side: 'back' } },
      shading,
    )
  }
  const color = parseMaterialColor(finish)
  if (color)
    return resolveCeilingFinish(
      { properties: { ...resolveMaterial(), color } },
      sceneMaterials,
      shading,
    )
  const parsed = parseMaterialRef(finish)
  if (parsed?.kind === 'scene')
    return resolveCeilingFinish(
      sceneMaterials?.[parsed.id as SceneMaterialId]?.material,
      sceneMaterials,
      shading,
    )
  const preset = getMaterialPresetByRef(finish)
  return preset
    ? createMaterialFromPreset(
        { ...preset, mapProperties: { ...preset.mapProperties, side: BackSide } },
        shading,
      )
    : null
}

/**
 * Resolve a slot `MaterialRef` to a flat colour for the ceiling surface.
 * `library:` refs use the catalog preset's base colour; `scene:` refs use the
 * stored material's colour; a plain colour is itself. Returns null for a dangling / unparseable ref so
 * the caller falls back to its default.
 */
export function ceilingColorFromRef(
  ref: string | undefined,
  sceneMaterials: Record<SceneMaterialId, SceneMaterial> | undefined,
): string | null {
  const color = parseMaterialColor(ref)
  if (color) return color
  const parsed = parseMaterialRef(ref)
  if (!parsed) return null
  if (parsed.kind === 'library') {
    // A flat tint: the catalog's preview colour reads as the finish (a textured
    // preset's map colour is often plain white).
    return (
      getCatalogMaterialById(parsed.id)?.previewColor ??
      getMaterialPresetByRef(ref)?.mapProperties.color ??
      null
    )
  }
  const sceneMaterial = sceneMaterials?.[parsed.id as SceneMaterialId]
  if (!sceneMaterial) return null
  return resolveMaterial(sceneMaterial.material).color ?? null
}
