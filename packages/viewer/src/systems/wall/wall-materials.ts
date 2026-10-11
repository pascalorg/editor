import {
  getEffectiveWallFaceMaterial,
  getMaterialPresetByRef,
  getWallSurfaceMaterialSignature,
  parseMaterialColor,
  parseMaterialRef,
  resolveMaterial,
  resolveWallExteriorSide,
  resolveWallFaceChain,
  type SceneMaterial,
  type SceneMaterialId,
  WALL_SLOT_DEFAULT,
  type WallFace,
  type WallNode,
  type WallSurfaceMaterialSpec,
  wallAssemblyFinishRef,
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
  materialPresetRefSignature,
  type RenderShading,
  resolveMaterialRef,
  resolveSlotDefaultRef,
  resolveSurfaceColor,
} from '../../lib/materials'

type SceneMaterials = Record<SceneMaterialId, SceneMaterial> | undefined

const DEFAULT_WALL_COLOR = '#e9e7e3'

const WALL_HIGHLIGHT_PROFILES = {
  delete: {
    color: new Color('#dc2626'),
    blend: 0.76,
    emissiveBlend: 0.92,
    emissiveIntensity: 0.46,
  },
} as const

type WallHighlightKind = keyof typeof WALL_HIGHLIGHT_PROFILES

export type WallMaterialArray = Material[]

export interface WallMaterials {
  visible: WallMaterialArray
  invisible: WallMaterialArray
  translucent: WallMaterialArray
  deleteVisible: WallMaterialArray
  deleteInvisible: WallMaterialArray
  deleteTranslucent: WallMaterialArray
  materialHash: string
  ownedVisible?: Material[]
}

export type WallMaterialOverride = {
  hash: string
  create: () => { visible: WallMaterialArray; owned?: Material[] }
}

export type WallMaterialsResolver = (
  wallNode: WallNode,
  shading?: RenderShading,
  textures?: boolean,
  colorPreset?: ColorPreset,
  sceneTheme?: string,
  sceneMaterials?: SceneMaterials,
  finishRefs?: readonly string[],
) => WallMaterials

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

// Resolve a wall face's declared default — a catalog `library:` finish or a
// flat colour — to a renderable material.
function resolveWallSlotDefault(declaredDefault: string, shading: RenderShading): Material {
  const slotDefault = resolveSlotDefaultRef(declaredDefault)
  if (parseMaterialRef(slotDefault)?.kind === 'library') {
    return createMaterialFromPresetRef(slotDefault, shading) ?? baseMaterial(shading)
  }
  return createDefaultMaterial(slotDefault, 0.9, shading)
}

// The assembly cladding's ref when `face` is the wall's exterior face (a is the
// +normal face; an unresolved side keeps the cladding on b, as legacy did).
function wallAssemblyFaceFinishRef(wallNode: WallNode, face: WallFace): string | null {
  const exteriorFace = resolveWallExteriorSide(wallNode) === 1 ? 'a' : 'b'
  return face === exteriorFace ? wallAssemblyFinishRef(wallNode) : null
}

// Slot-first resolution for one wall face, matching every other paintable kind:
//   node.slots[face] ref → legacy inline finish → declared slot default.
// A dangling `scene:` ref (material deleted / copied across scenes) falls back
// to the declared default — it never blocks rendering (the dangling-ref rule).
function resolveWallFaceMaterial(
  wallNode: WallNode,
  face: WallFace,
  shading: RenderShading,
  sceneMaterials: SceneMaterials,
): Material {
  const finish = resolveWallFaceChain(wallNode, face)
  if (finish.kind === 'ref') {
    return (
      resolveMaterialRef(finish.ref, sceneMaterials, shading) ??
      resolveWallSlotDefault(WALL_SLOT_DEFAULT[face], shading)
    )
  }
  if (finish.kind === 'legacy') return getSurfaceVisibleMaterial(finish.spec, shading)
  // No paint on this face: the wall ASSEMBLY's cladding (WS5) skins the
  // exterior — a "2x6 lap siding" wall reads as lap siding without the user
  // painting it. Painting the face still wins.
  const assemblyRef = wallAssemblyFaceFinishRef(wallNode, face)
  return resolveWallSlotDefault(assemblyRef ?? finish.ref, shading)
}

// A region or room finish: its ref, else the face default (same dangling rule).
function resolveWallFinishMaterial(
  ref: string,
  shading: RenderShading,
  sceneMaterials: SceneMaterials,
): Material {
  return (
    resolveMaterialRef(ref, sceneMaterials, shading) ??
    resolveWallSlotDefault(WALL_SLOT_DEFAULT.a, shading)
  )
}

// Cache-key fragment for a ref: for a `scene:` ref, the referenced material's
// *content* — so editing a scene material assigned to a wall invalidates the
// cache. A `library:` ref carries its resolution state instead: AI-generated
// materials register asynchronously, and a dangling ref resolved to the slot
// default must not stay cached once the library lands.
function refMaterialSignature(ref: string, sceneMaterials: SceneMaterials): string {
  const parsed = parseMaterialRef(ref)
  if (parsed?.kind === 'scene') {
    return JSON.stringify({
      ref,
      material: sceneMaterials?.[parsed.id as SceneMaterialId]?.material ?? null,
    })
  }
  return JSON.stringify({ ref: materialPresetRefSignature(ref) })
}

// Falls back to the legacy signature when the face has no slot ref.
function wallFaceMaterialSignature(
  wallNode: WallNode,
  face: WallFace,
  sceneMaterials: SceneMaterials,
): string {
  const ref = wallNode.slots?.[face]
  if (ref) return refMaterialSignature(ref, sceneMaterials)
  return JSON.stringify({
    legacy: getWallSurfaceMaterialSignature(getEffectiveWallFaceMaterial(wallNode, face)),
    // Changing the assembly's cladding must re-skin the face.
    assemblyFinish: wallAssemblyFaceFinishRef(wallNode, face),
  })
}

function resolveRefColor(ref: string, sceneMaterials: SceneMaterials, fallback: string): string {
  const color = parseMaterialColor(ref)
  if (color) return color
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

// Slot-first tint for the cutaway/invisible wall variant.
function resolveWallFaceColor(
  wallNode: WallNode,
  face: WallFace,
  sceneMaterials: SceneMaterials,
  fallback: string,
): string {
  const ref = wallNode.slots?.[face]
  if (ref) return resolveRefColor(ref, sceneMaterials, fallback)
  const spec = getEffectiveWallFaceMaterial(wallNode, face)
  const assemblyRef = wallAssemblyFaceFinishRef(wallNode, face)
  if (assemblyRef && !(spec.materialPreset || spec.material)) {
    return getMaterialPresetByRef(assemblyRef)?.mapProperties?.color ?? fallback
  }
  return getSurfaceColor(spec, fallback)
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

// Softer sibling of the selection glow, for HOVERING a hidden wall (the
// X-ray nearest-first selection made hidden walls hover targets; without a
// material affordance the only thing lighting up was the furniture behind
// them). Same indigo so hover reads as "this will select", weaker so a
// hovered-then-selected wall still steps up on click.
const HOVER_EMISSIVE_BLEND = 0.4
const HOVER_EMISSIVE_INTENSITY = 0.2

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
const hoverHighlightCache = new WeakMap<Material, { clone: Material; map: unknown }>()

function getEmissiveHighlightMaterial(
  base: Material,
  cache: WeakMap<Material, { clone: Material; map: unknown }>,
  emissiveBlend: number,
  emissiveIntensity: number,
): Material {
  const baseMap = (base as { map?: unknown }).map ?? null
  const cached = cache.get(base)
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
    clone.emissive = clone.emissive.clone().lerp(SELECTION_HIGHLIGHT_COLOR, emissiveBlend)
  }
  if ('emissiveIntensity' in clone) {
    clone.emissiveIntensity = Math.max(clone.emissiveIntensity ?? 0, emissiveIntensity)
  }
  clone.needsUpdate = true
  cache.set(base, { clone, map: baseMap })
  return clone
}

/** Lazy light-emissive selection variant of a wall's material array (keeps texture). */
export function getSelectionHighlightMaterials(materials: WallMaterialArray): WallMaterialArray {
  return materials.map((material) =>
    getEmissiveHighlightMaterial(
      material,
      selectionHighlightCache,
      SELECTION_EMISSIVE_BLEND,
      SELECTION_EMISSIVE_INTENSITY,
    ),
  ) as WallMaterialArray
}

/**
 * Softer hover sibling of the selection variant — the affordance for a
 * hovered HIDDEN wall (`WallCutout` applies it to the invisible stipple
 * film so the wall the click would select reads under the cursor).
 */
export function getHoverHighlightMaterials(materials: WallMaterialArray): WallMaterialArray {
  return materials.map((material) =>
    getEmissiveHighlightMaterial(
      material,
      hoverHighlightCache,
      HOVER_EMISSIVE_BLEND,
      HOVER_EMISSIVE_INTENSITY,
    ),
  ) as WallMaterialArray
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
  finishRefs: readonly string[] = [],
  overrideHash?: string,
): string {
  return JSON.stringify({
    shading,
    overrideHash,
    a: wallFaceMaterialSignature(wallNode, 'a', sceneMaterials),
    b: wallFaceMaterialSignature(wallNode, 'b', sceneMaterials),
    finishes: finishRefs.map((ref) => refMaterialSignature(ref, sceneMaterials)),
  })
}

/**
 * A wall's material palette: 0 caps/edges (themed role), 1 face a, 2 face b,
 * then one entry per `finishRefs` — the region and room finishes the built
 * geometry's groups point at (`getWallFinishRefs(mesh.geometry)`).
 */
export function getMaterialsForWall(
  wallNode: WallNode,
  shading: RenderShading = 'rendered',
  textures = true,
  colorPreset: ColorPreset = 'clay',
  sceneTheme?: string,
  sceneMaterials?: SceneMaterials,
  finishRefs: readonly string[] = [],
  override?: WallMaterialOverride,
): WallMaterials {
  const cacheKey = `${wallNode.id}-${shading}-${textures}-${colorPreset}-${sceneTheme ?? 'base'}`
  const materialHash = textures
    ? getWallMaterialHash(wallNode, shading, sceneMaterials, finishRefs, override?.hash)
    : JSON.stringify({ textures, colorPreset, sceneTheme, finishes: finishRefs.length })

  const existing = wallMaterialCache.get(cacheKey)
  if (existing && existing.materialHash === materialHash) {
    return existing
  }

  if (existing) {
    disposeOwnedMaterials([
      ...(existing.ownedVisible ? [existing.ownedVisible] : []),
      existing.invisible,
      existing.translucent,
      existing.deleteVisible,
      existing.deleteInvisible,
      existing.deleteTranslucent,
    ])
  }

  const wallRoleMaterial = createSurfaceRoleMaterial('wall', colorPreset, undefined, sceneTheme)
  const resolvedOverride = textures ? override?.create() : undefined

  // Colored mode: each face resolves slot-first (node.slots ref → legacy inline
  // fields → declared slot default, parity with the retired DEFAULT_WALL_MATERIAL).
  // Textures-off collapses every face to the themed wall role (the guaranteed
  // escape hatch). The edge/cap slot (index 0) stays role-based.
  const visible: WallMaterialArray = resolvedOverride
    ? resolvedOverride.visible
    : textures
      ? [
          wallRoleMaterial,
          resolveWallFaceMaterial(wallNode, 'a', shading, sceneMaterials),
          resolveWallFaceMaterial(wallNode, 'b', shading, sceneMaterials),
          ...finishRefs.map((ref) => resolveWallFinishMaterial(ref, shading, sceneMaterials)),
        ]
      : Array.from({ length: 3 + finishRefs.length }, () => wallRoleMaterial)

  const wallRoleColor = resolveSurfaceColor('wall', colorPreset, sceneTheme)
  const variantShading = textures ? shading : 'solid'
  const paletteColors = [
    wallRoleColor,
    ...(['a', 'b'] as const).map((face) =>
      textures
        ? resolveWallFaceColor(wallNode, face, sceneMaterials, wallRoleColor)
        : wallRoleColor,
    ),
    ...finishRefs.map((ref) =>
      textures ? resolveRefColor(ref, sceneMaterials, wallRoleColor) : wallRoleColor,
    ),
  ]
  const invisible: WallMaterialArray = paletteColors.map((color) =>
    createInvisibleWallMaterial(color, variantShading),
  )
  const translucent: WallMaterialArray = paletteColors.map((color) =>
    createTranslucentWallMaterial(color, variantShading),
  )

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
    ownedVisible: resolvedOverride?.owned,
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
  finishRefs: readonly string[] = [],
): WallMaterialArray {
  return getMaterialsForWall(
    wallNode,
    shading,
    textures,
    colorPreset,
    sceneTheme,
    sceneMaterials,
    finishRefs,
  ).visible
}
