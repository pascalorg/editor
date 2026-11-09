import {
  type AnyNode,
  type AnyNodeId,
  findLevelBelowId,
  getEffectiveRoofSurfaceMaterial,
  getLevelElevations,
  getRoofWallBandMaterial,
  parseMaterialRef,
  type RoofNode,
  type RoofSegmentNode,
  type SceneMaterial,
  type SceneMaterialId,
  type WallNode,
  wallAssemblyFinishRef,
} from '@pascal-app/core'
import type * as THREE from 'three'
import {
  type ColorPreset,
  createMaterial,
  createSurfaceRoleMaterial,
  type RenderShading,
  resolveMaterialRef,
  resolveSlotDefaultMaterial,
} from '../../lib/materials'

type SceneMaterials = Record<SceneMaterialId, SceneMaterial> | undefined

// Declared catalog defaults for an unpainted roof, per the 4-slot layout
// (0 wall/trim · 1 deck · 2 interior soffit · 3 shingle top). The wall/trim
// band is bare drywall, the wall faces' default before they took the interior
// paint; over walls with a cladding it takes theirs (`levelWallCladdingRef`).
const ROOF_DEFAULT_REFS: [string, string, string, string] = [
  'library:concrete-drywall',
  'library:preset-softwhite',
  'library:preset-softwhite',
  'library:roof-terracottatiles',
]

/**
 * One material per roof mesh slot (`roof-material-slots.ts`): 0 wall / trim
 * (the edge role), 1 deck, 2 interior, 3 shingle top, 4 the heel band, 5 and
 * 6 the gable ends — the merged shell's gables are the edge role's.
 */
export type RoofMaterialArray = [
  THREE.Material,
  THREE.Material,
  THREE.Material,
  THREE.Material,
  THREE.Material,
  THREE.Material,
  THREE.Material,
]

const roofMaterialArrayCache = new Map<string, RoofMaterialArray>()

function getSurfaceMaterialSignature(
  spec: ReturnType<typeof getEffectiveRoofSurfaceMaterial>,
  sceneMaterials: SceneMaterials,
): string {
  const ref = parseMaterialRef(spec.materialPreset)
  return JSON.stringify({
    material: spec.material ?? null,
    materialPreset: spec.materialPreset ?? null,
    sceneMaterial:
      ref?.kind === 'scene'
        ? (sceneMaterials?.[ref.id as SceneMaterialId]?.material ?? null)
        : null,
  })
}

function createResolvedMaterial(
  material: RoofNode['material'] | RoofSegmentNode['material'] | undefined,
  materialPreset: string | undefined,
  sceneMaterials: SceneMaterials,
  shading: RenderShading,
): THREE.Material | null {
  // An unknown or dangling ref resolves to nothing: fall through to the
  // colour, then the slot default, as the segment renderer does.
  const preset = resolveMaterialRef(materialPreset, sceneMaterials, shading)
  if (preset) return preset

  if (material) {
    return createMaterial(material, shading)
  }

  return null
}

type LevelWallRefs = { cladding: string | null; face: string | null }

/** The most common ref, the first seen winning a tie; null when there is none. */
function mostCommonRef(refs: Iterable<string | null>): string | null {
  const counts = new Map<string, number>()
  for (const ref of refs) if (ref) counts.set(ref, (counts.get(ref) ?? 0) + 1)
  let best: string | null = null
  let bestCount = 0
  for (const [ref, count] of counts) {
    if (count > bestCount) {
      best = ref
      bestCount = count
    }
  }
  return best
}

// Every roof and segment renderer reads these on each store change: one scan per
// level per nodes snapshot, shared by all of them.
const levelWallRefsCache = new WeakMap<object, Map<string, LevelWallRefs>>()

function levelWallRefs(
  nodes: Readonly<Record<string, AnyNode | undefined>>,
  levelId: string,
): LevelWallRefs {
  let byLevel = levelWallRefsCache.get(nodes)
  if (!byLevel) {
    byLevel = new Map()
    levelWallRefsCache.set(nodes, byLevel)
  }
  const cached = byLevel.get(levelId)
  if (cached) return cached
  const wallsOn = (id: string | null) =>
    Object.values(nodes).filter(
      (node): node is WallNode => node?.type === 'wall' && node.parentId === id,
    )
  const own = wallsOn(levelId)
  const walls = own.length
    ? own
    : wallsOn(findLevelBelowId(levelId, getLevelElevations(nodes as Record<AnyNodeId, AnyNode>)))
  const refs: LevelWallRefs = {
    cladding: mostCommonRef(walls.map((wall) => wallAssemblyFinishRef(wall))),
    face: mostCommonRef(
      walls.map((wall) => {
        // Face a is the front (+normal) side; an unresolved wall's exterior is face b.
        const exterior = wall.frontSide === 'exterior' && wall.backSide !== 'exterior' ? 'a' : 'b'
        const painted = wall.slots?.[exterior]
        return typeof painted === 'string' ? painted : wallAssemblyFinishRef(wall)
      }),
    ),
  }
  byLevel.set(levelId, refs)
  return refs
}

/**
 * The cladding the walls under a roof declare through their ASSEMBLIES
 * (`wall.assembly.exterior.finish` → catalog ref), so the roof's gable band —
 * the triangle of wall above the plate that the roof kind builds — is skinned
 * like the walls it sits on instead of the bare drywall default. The walls are
 * the roof's level's, or for a roof on a level of its own (a building's roof
 * level), the storey's directly below. The most common ref among them wins;
 * null when none declares one.
 */
export function levelWallCladdingRef(
  nodes: Readonly<Record<string, AnyNode | undefined>>,
  roof: Pick<RoofNode, 'parentId'>,
): string | null {
  return roof.parentId ? levelWallRefs(nodes, roof.parentId).cladding : null
}

/**
 * What the walls under a roof show outside, for the heel band — the strip of
 * wall between their top plate and the eaves, which is wall, not trim: their
 * exterior face's paint, else the cladding their assembly declares
 * (`levelWallCladdingRef`'s walls). The most common wins; null when none has
 * either.
 */
export function levelWallFaceRef(
  nodes: Readonly<Record<string, AnyNode | undefined>>,
  roof: Pick<RoofNode, 'parentId'>,
): string | null {
  return roof.parentId ? levelWallRefs(nodes, roof.parentId).face : null
}

export function getRoofMaterialArray(
  node: RoofNode,
  shading: RenderShading = 'rendered',
  textures = true,
  colorPreset: ColorPreset = 'clay',
  sceneTheme?: string,
  /** Catalog ref for the gable/trim band when unpainted — see `levelWallCladdingRef`. */
  wallCladdingRef: string | null = null,
  sceneMaterials?: SceneMaterials,
  /** Catalog ref for the heel band when unpainted — see `levelWallFaceRef`. */
  wallFaceRef: string | null = null,
): RoofMaterialArray | null {
  const top = getEffectiveRoofSurfaceMaterial(node, 'top')
  const edge = getEffectiveRoofSurfaceMaterial(node, 'edge')
  const wall = getEffectiveRoofSurfaceMaterial(node, 'wall')
  const heel = getRoofWallBandMaterial(node, 'heel') ?? {
    material: undefined,
    materialPreset: undefined,
  }

  const cacheKey = JSON.stringify({
    shading,
    textures,
    colorPreset,
    sceneTheme,
    wallCladdingRef,
    wallFaceRef,
    heel: getSurfaceMaterialSignature(heel, sceneMaterials),
    top: getSurfaceMaterialSignature(top, sceneMaterials),
    edge: getSurfaceMaterialSignature(edge, sceneMaterials),
    wall: getSurfaceMaterialSignature(wall, sceneMaterials),
  })

  const cached = roofMaterialArrayCache.get(cacheKey)
  if (cached) return cached

  // Themed role colours: roof top/edge use the 'roof' role, the soffit/underside
  // uses 'ceiling'. These also fill any untextured slot so an untextured roof is
  // theme-coloured regardless of the textures toggle (no more white default).
  const roofMaterial = createSurfaceRoleMaterial('roof', colorPreset, undefined, sceneTheme)
  const ceilingMaterial = createSurfaceRoleMaterial('ceiling', colorPreset, undefined, sceneTheme)
  const roleArray: RoofMaterialArray = [
    roofMaterial,
    ceilingMaterial,
    ceilingMaterial,
    roofMaterial,
    // The bands drew in the wall/trim slot before they had slots of their own.
    roofMaterial,
    roofMaterial,
    roofMaterial,
  ]

  // Textures-off (monochrome) is the guaranteed escape hatch: themed role
  // colours, no catalog finishes.
  if (!textures) {
    roofMaterialArrayCache.set(cacheKey, roleArray)
    return roleArray
  }

  const resolve = (spec: typeof top) =>
    createResolvedMaterial(spec.material, spec.materialPreset, sceneMaterials, shading)
  const topMaterial = resolve(top)
  const edgeMaterial = resolve(edge)
  const wallMaterial = resolve(wall)
  const heelMaterial = resolve(heel)

  // Each slot resolves to its own role only, then the declared default — never
  // another role. Cross-role fallback here used to splatter a single painted
  // surface (e.g. the edge) across the shingle and soffit slots. The legacy
  // catch-all still fills every role because `getEffectiveRoofSurfaceMaterial`
  // returns it for top/edge/wall alike.
  // Resolve an unpainted slot's catalog default lazily: painted roofs must
  // not load unused finish assets (or make capture readiness depend on them).
  const trimDefaultRef = wallCladdingRef ?? ROOF_DEFAULT_REFS[0]
  const trim = edgeMaterial ?? resolveSlotDefaultMaterial(trimDefaultRef, shading)
  // The heel band is wall: unpainted, it follows the walls below, never the gable / fascia
  // trim. A roof with no edge paint over walls with no face paint draws it exactly as it did
  // when the band was part of the wall/trim slot — the very same material.
  const heelDefaultRef = wallFaceRef ?? trimDefaultRef
  const heelSlot =
    heelMaterial ??
    (!edgeMaterial && heelDefaultRef === trimDefaultRef
      ? trim
      : resolveSlotDefaultMaterial(heelDefaultRef, shading))
  const materialArray: RoofMaterialArray = [
    trim,
    wallMaterial ?? resolveSlotDefaultMaterial(ROOF_DEFAULT_REFS[1], shading),
    wallMaterial ?? resolveSlotDefaultMaterial(ROOF_DEFAULT_REFS[2], shading),
    topMaterial ?? resolveSlotDefaultMaterial(ROOF_DEFAULT_REFS[3], shading),
    heelSlot,
    trim,
    trim,
  ]

  roofMaterialArrayCache.set(cacheKey, materialArray)
  return materialArray
}
