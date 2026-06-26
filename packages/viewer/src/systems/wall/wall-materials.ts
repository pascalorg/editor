import {
  getEffectiveWallSurfaceMaterial,
  getMaterialPresetByRef,
  getWallSurfaceMaterialSignature,
  parseMaterialRef,
  resolveMaterial,
  type SceneMaterial,
  type SceneMaterialId,
  WALL_SLOT_DEFAULT,
  type WallNode,
  type WallSurfaceMaterialSpec,
  type WallSurfaceSide,
} from '@pascal-app/core'
import { Color, type Material } from 'three'
import { Fn, float, fract, length, mix, positionLocal, smoothstep, step, vec2 } from 'three/tsl'
import { MeshLambertNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu'
import {
  baseMaterial,
  type ColorPreset,
  createDefaultMaterial,
  createMaterial,
  createMaterialFromPresetRef,
  createSurfaceRoleMaterial,
  type RenderShading,
  resolveMaterialRef,
  resolveSurfaceColor,
} from '../../lib/materials'

type SceneMaterials = Record<SceneMaterialId, SceneMaterial> | undefined

const DEFAULT_WALL_COLOR = '#f2f0ed'

const WALL_HIGHLIGHT_PROFILES = {
  delete: {
    color: new Color('#dc2626'),
    blend: 0.76,
    emissiveBlend: 0.92,
    emissiveIntensity: 0.46,
  },
} as const

type WallHighlightKind = keyof typeof WALL_HIGHLIGHT_PROFILES

export type WallMaterialArray = [Material, Material, Material]

export interface WallMaterials {
  visible: WallMaterialArray
  invisible: WallMaterialArray
  translucent: WallMaterialArray
  deleteVisible: WallMaterialArray
  deleteInvisible: WallMaterialArray
  deleteTranslucent: WallMaterialArray
  materialHash: string
}

const wallMaterialCache = new Map<string, WallMaterials>()

const dotPattern = Fn(() => {
  const scale = float(0.1)
  const dotSize = float(0.3)

  const uv = vec2(positionLocal.x, positionLocal.y).div(scale)
  const gridUV = fract(uv)

  const dist = length(gridUV.sub(0.5))

  const dots = step(dist, dotSize.mul(0.5))

  const fadeHeight = float(2.5)
  const yFade = float(1).sub(smoothstep(float(0), fadeHeight, positionLocal.y))

  return dots.mul(yFade)
})

function getSurfaceVisibleMaterial(
  spec: WallSurfaceMaterialSpec,
  shading: RenderShading,
): Material {
  if (spec.materialPreset) {
    return createMaterialFromPresetRef(spec.materialPreset, shading) ?? baseMaterial(shading)
  }

  if (spec.material) {
    return createMaterial(spec.material, shading)
  }

  return baseMaterial(shading)
}

function hasExplicitMaterial(spec: WallSurfaceMaterialSpec): boolean {
  return Boolean(spec.materialPreset || spec.material)
}

// Resolve a wall face's declared default — a catalog `library:` finish or a
// flat colour — to a renderable material.
function resolveWallSlotDefault(slotDefault: string, shading: RenderShading): Material {
  if (parseMaterialRef(slotDefault)?.kind === 'library') {
    return createMaterialFromPresetRef(slotDefault, shading) ?? baseMaterial(shading)
  }
  return createDefaultMaterial(slotDefault, 0.9, shading)
}

// Slot-first resolution for one wall face, matching every other paintable kind:
//   node.slots[side] ref → legacy inline fields → declared slot default.
// A dangling `scene:` ref (material deleted / copied across scenes) falls back
// to the declared default — it never blocks rendering (the dangling-ref rule).
function resolveWallFaceMaterial(
  wallNode: WallNode,
  side: WallSurfaceSide,
  shading: RenderShading,
  sceneMaterials: SceneMaterials,
): Material {
  const ref = wallNode.slots?.[side]
  if (ref) {
    return (
      resolveMaterialRef(ref, sceneMaterials, shading) ??
      resolveWallSlotDefault(WALL_SLOT_DEFAULT[side], shading)
    )
  }

  const spec = getEffectiveWallSurfaceMaterial(wallNode, side)
  if (hasExplicitMaterial(spec)) {
    return getSurfaceVisibleMaterial(spec, shading)
  }

  return resolveWallSlotDefault(WALL_SLOT_DEFAULT[side], shading)
}

// Cache-key fragment for one face: the slot ref plus, for a `scene:` ref, the
// referenced material's *content* — so editing a scene material assigned to a
// wall invalidates the cache (a `library:` ref is static catalog content, so
// its id alone is enough). Falls back to the legacy signature when unmigrated.
function wallFaceMaterialSignature(
  wallNode: WallNode,
  side: WallSurfaceSide,
  sceneMaterials: SceneMaterials,
): string {
  const ref = wallNode.slots?.[side]
  if (ref) {
    const parsed = parseMaterialRef(ref)
    if (parsed?.kind === 'scene') {
      return JSON.stringify({
        ref,
        material: sceneMaterials?.[parsed.id as SceneMaterialId]?.material ?? null,
      })
    }
    return JSON.stringify({ ref })
  }
  return getWallSurfaceMaterialSignature(getEffectiveWallSurfaceMaterial(wallNode, side))
}

// Slot-first tint for the cutaway/invisible wall variant.
function resolveWallFaceColor(
  wallNode: WallNode,
  side: WallSurfaceSide,
  sceneMaterials: SceneMaterials,
  fallback: string,
): string {
  const ref = wallNode.slots?.[side]
  if (ref) {
    const parsed = parseMaterialRef(ref)
    if (parsed?.kind === 'library') {
      return getMaterialPresetByRef(ref)?.mapProperties?.color ?? fallback
    }
    if (parsed?.kind === 'scene') {
      const sceneMaterial = sceneMaterials?.[parsed.id as SceneMaterialId]
      return sceneMaterial ? resolveMaterial(sceneMaterial.material).color : fallback
    }
    return fallback
  }
  return getSurfaceColor(getEffectiveWallSurfaceMaterial(wallNode, side), fallback)
}

function getSurfaceColor(spec: WallSurfaceMaterialSpec, fallback = DEFAULT_WALL_COLOR): string {
  const preset = getMaterialPresetByRef(spec.materialPreset)
  if (preset?.mapProperties?.color) {
    return preset.mapProperties.color
  }

  if (spec.material) {
    return resolveMaterial(spec.material).color
  }

  return fallback
}

function getHighlightedColor(color: Color, kind: WallHighlightKind): Color {
  const profile = WALL_HIGHLIGHT_PROFILES[kind]
  return color.clone().lerp(profile.color, profile.blend)
}

function createHighlightedWallMaterial(material: Material, kind: WallHighlightKind): Material {
  const highlightedMaterial = material.clone() as Material & {
    color?: Color
    emissive?: Color
    emissiveIntensity?: number
    needsUpdate?: boolean
  }
  const profile = WALL_HIGHLIGHT_PROFILES[kind]

  if ('color' in highlightedMaterial && highlightedMaterial.color) {
    highlightedMaterial.color = getHighlightedColor(highlightedMaterial.color, kind)
  }
  if ('emissive' in highlightedMaterial && highlightedMaterial.emissive) {
    highlightedMaterial.emissive = highlightedMaterial.emissive
      .clone()
      .lerp(profile.color, profile.emissiveBlend)
  }
  if ('emissiveIntensity' in highlightedMaterial) {
    highlightedMaterial.emissiveIntensity = Math.max(
      highlightedMaterial.emissiveIntensity ?? 0,
      profile.emissiveIntensity,
    )
  }
  highlightedMaterial.needsUpdate = true

  return highlightedMaterial
}

// Light selection highlight for walls (walls are excluded from the generic
// editor selection highlight, so they need their own). Adds a gentle indigo
// emissive (no albedo tint) so the real material/texture stays readable with a
// soft "selected" glow. Two NodeMaterial-clone gotchas are handled:
//   1. `clone()` on the WebGPU backend drops the texture-map nodes → re-attach
//      them from the source (shared by reference).
//   2. The wall's finish texture loads async, so an early clone has no map yet →
//      cache keyed by the source `.map` and rebuild when it changes (self-heals
//      once the texture lands).
const SELECTION_HIGHLIGHT_COLOR = new Color('#818cf8')
const SELECTION_EMISSIVE_BLEND = 0.4
const SELECTION_EMISSIVE_INTENSITY = 0.12

const SELECTION_TEXTURE_MAP_KEYS = [
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'aoMap',
  'emissiveMap',
  'bumpMap',
  'displacementMap',
  'alphaMap',
  'lightMap',
] as const

const selectionHighlightCache = new WeakMap<Material, { clone: Material; map: unknown }>()

function getSelectionHighlightMaterial(base: Material): Material {
  const baseMap = (base as { map?: unknown }).map ?? null
  const cached = selectionHighlightCache.get(base)
  if (cached && cached.map === baseMap) return cached.clone

  const clone = base.clone() as Material & {
    emissive?: Color
    emissiveIntensity?: number
    needsUpdate?: boolean
  }
  // Re-attach texture maps the WebGPU NodeMaterial clone drops.
  const src = base as unknown as Record<string, unknown>
  const dst = clone as unknown as Record<string, unknown>
  for (const key of SELECTION_TEXTURE_MAP_KEYS) {
    if (src[key]) dst[key] = src[key]
  }
  if ('emissive' in clone && clone.emissive) {
    clone.emissive = clone.emissive
      .clone()
      .lerp(SELECTION_HIGHLIGHT_COLOR, SELECTION_EMISSIVE_BLEND)
  }
  if ('emissiveIntensity' in clone) {
    clone.emissiveIntensity = Math.max(clone.emissiveIntensity ?? 0, SELECTION_EMISSIVE_INTENSITY)
  }
  clone.needsUpdate = true
  selectionHighlightCache.set(base, { clone, map: baseMap })
  return clone
}

/** Lazy light-emissive selection variant of a wall's material array (keeps texture). */
export function getSelectionHighlightMaterials(materials: WallMaterialArray): WallMaterialArray {
  return materials.map(getSelectionHighlightMaterial) as WallMaterialArray
}

function createInvisibleWallMaterial(color: string, shading: RenderShading): Material {
  const material =
    shading === 'solid'
      ? new MeshLambertNodeMaterial({
          transparent: true,
          color,
          depthWrite: false,
          emissive: color,
        })
      : new MeshStandardNodeMaterial({
          transparent: true,
          color,
          depthWrite: false,
          emissive: color,
        })

  material.opacityNode = mix(float(0.0), float(0.24), dotPattern())
  return material
}

function createTranslucentWallMaterial(color: string, shading: RenderShading): Material {
  const material =
    shading === 'solid'
      ? new MeshLambertNodeMaterial({
          transparent: true,
          color,
          opacity: 0.35,
          depthWrite: false,
        })
      : new MeshStandardNodeMaterial({
          transparent: true,
          color,
          opacity: 0.35,
          depthWrite: false,
        })

  return material
}

function mapWallMaterialArray(
  materials: WallMaterialArray,
  iteratee: (material: Material, index: number) => Material,
): WallMaterialArray {
  return materials.map(iteratee) as WallMaterialArray
}

function disposeOwnedMaterials(materials: WallMaterialArray[]) {
  const owned = new Set<Material>()
  materials.forEach((entry) => {
    entry.forEach((material) => {
      owned.add(material)
    })
  })
  owned.forEach((material) => {
    material.dispose()
  })
}

export function getWallMaterialHash(
  wallNode: WallNode,
  shading: RenderShading,
  sceneMaterials?: SceneMaterials,
): string {
  return JSON.stringify({
    shading,
    interior: wallFaceMaterialSignature(wallNode, 'interior', sceneMaterials),
    exterior: wallFaceMaterialSignature(wallNode, 'exterior', sceneMaterials),
  })
}

export function getMaterialsForWall(
  wallNode: WallNode,
  shading: RenderShading = 'rendered',
  textures = true,
  colorPreset: ColorPreset = 'clay',
  sceneTheme?: string,
  sceneMaterials?: SceneMaterials,
): WallMaterials {
  const cacheKey = `${wallNode.id}-${shading}-${textures}-${colorPreset}-${sceneTheme ?? 'base'}`
  const materialHash = textures
    ? getWallMaterialHash(wallNode, shading, sceneMaterials)
    : JSON.stringify({ textures, colorPreset, sceneTheme })

  const existing = wallMaterialCache.get(cacheKey)
  if (existing && existing.materialHash === materialHash) {
    return existing
  }

  if (existing) {
    disposeOwnedMaterials([
      existing.invisible,
      existing.translucent,
      existing.deleteVisible,
      existing.deleteInvisible,
      existing.deleteTranslucent,
    ])
  }

  const wallRoleMaterial = createSurfaceRoleMaterial('wall', colorPreset, undefined, sceneTheme)

  // Colored mode: each face resolves slot-first (node.slots ref → legacy inline
  // fields → declared slot default, parity with the retired DEFAULT_WALL_MATERIAL).
  // Textures-off collapses every face to the themed wall role (the guaranteed
  // escape hatch). The edge/cap slot (index 0) stays role-based.
  const visible: WallMaterialArray = textures
    ? [
        wallRoleMaterial,
        resolveWallFaceMaterial(wallNode, 'interior', shading, sceneMaterials),
        resolveWallFaceMaterial(wallNode, 'exterior', shading, sceneMaterials),
      ]
    : [wallRoleMaterial, wallRoleMaterial, wallRoleMaterial]

  const wallRoleColor = resolveSurfaceColor('wall', colorPreset, sceneTheme)
  const invisible: WallMaterialArray = [
    createInvisibleWallMaterial(wallRoleColor, textures ? shading : 'solid'),
    createInvisibleWallMaterial(
      textures
        ? resolveWallFaceColor(wallNode, 'interior', sceneMaterials, wallRoleColor)
        : wallRoleColor,
      textures ? shading : 'solid',
    ),
    createInvisibleWallMaterial(
      textures
        ? resolveWallFaceColor(wallNode, 'exterior', sceneMaterials, wallRoleColor)
        : wallRoleColor,
      textures ? shading : 'solid',
    ),
  ]

  const translucent: WallMaterialArray = [
    createTranslucentWallMaterial(wallRoleColor, textures ? shading : 'solid'),
    createTranslucentWallMaterial(
      textures
        ? resolveWallFaceColor(wallNode, 'interior', sceneMaterials, wallRoleColor)
        : wallRoleColor,
      textures ? shading : 'solid',
    ),
    createTranslucentWallMaterial(
      textures
        ? resolveWallFaceColor(wallNode, 'exterior', sceneMaterials, wallRoleColor)
        : wallRoleColor,
      textures ? shading : 'solid',
    ),
  ]

  const deleteVisible = mapWallMaterialArray(visible, (material) =>
    createHighlightedWallMaterial(material, 'delete'),
  )
  const deleteInvisible = mapWallMaterialArray(invisible, (material) =>
    createHighlightedWallMaterial(material, 'delete'),
  )
  const deleteTranslucent = mapWallMaterialArray(translucent, (material) =>
    createHighlightedWallMaterial(material, 'delete'),
  )

  const result: WallMaterials = {
    visible,
    invisible,
    translucent,
    deleteVisible,
    deleteInvisible,
    deleteTranslucent,
    materialHash,
  }

  wallMaterialCache.set(cacheKey, result)
  return result
}

export function getVisibleWallMaterials(
  wallNode: WallNode,
  shading: RenderShading = 'rendered',
  textures = true,
  colorPreset: ColorPreset = 'clay',
  sceneTheme?: string,
  sceneMaterials?: SceneMaterials,
): WallMaterialArray {
  return getMaterialsForWall(wallNode, shading, textures, colorPreset, sceneTheme, sceneMaterials)
    .visible
}
