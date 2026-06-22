import {
  getMaterialPresetByRef,
  parseMaterialRef,
  resolveMaterial,
  type SceneMaterial,
  type SceneMaterialId,
} from '@pascal-app/core'
import { float, mix, positionWorld, smoothstep } from 'three/tsl'
import { BackSide, FrontSide, MeshBasicNodeMaterial } from 'three/webgpu'

/**
 * Ceiling material builders, shared by the renderer (mesh appearance) and the
 * paint capability (hover preview). A ceiling is a flat tinted surface: the
 * underside (`bottom`, seen from inside the room, `BackSide`) is opaque, while
 * the `top` carries a transparent TSL grid overlay used while placing /
 * selecting ceiling-hosted items. Both derive from a single colour, so slot
 * painting resolves a colour and rebuilds these — it never applies a PBR map.
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
  bottomMaterial: MeshBasicNodeMaterial
}

function createCeilingMaterials(color = '#999999'): CeilingMaterials {
  const topMaterial = new MeshBasicNodeMaterial({
    color,
    transparent: true,
    depthWrite: false,
    side: FrontSide,
  })
  topMaterial.opacityNode = gridOpacity

  const bottomMaterial = new MeshBasicNodeMaterial({
    color,
    transparent: true,
    side: BackSide,
  })

  return { topMaterial, bottomMaterial }
}

const ceilingMaterialCache = new Map<string, CeilingMaterials>()

export function getCeilingMaterials(color = '#999999'): CeilingMaterials {
  const cached = ceilingMaterialCache.get(color)
  if (cached) return cached
  const materials = createCeilingMaterials(color)
  ceilingMaterialCache.set(color, materials)
  return materials
}

/**
 * Resolve a slot `MaterialRef` to a flat colour for the ceiling surface.
 * `library:` refs use the catalog preset's base colour; `scene:` refs use the
 * stored material's colour. Returns null for a dangling / unparseable ref so
 * the caller falls back to its default.
 */
export function ceilingColorFromRef(
  ref: string | undefined,
  sceneMaterials: Record<SceneMaterialId, SceneMaterial> | undefined,
): string | null {
  const parsed = parseMaterialRef(ref)
  if (!parsed) return null
  if (parsed.kind === 'library') {
    return getMaterialPresetByRef(ref)?.mapProperties.color ?? null
  }
  const sceneMaterial = sceneMaterials?.[parsed.id as SceneMaterialId]
  if (!sceneMaterial) return null
  return resolveMaterial(sceneMaterial.material).color ?? null
}
