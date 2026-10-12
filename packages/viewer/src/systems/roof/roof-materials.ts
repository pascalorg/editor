import {
  type AnyNode,
  getEffectiveRoofSurfaceMaterial,
  parseMaterialRef,
  type RoofNode,
  type RoofSegmentNode,
  type RoofSurfaceMaterialRole,
  type SceneMaterial,
  type SceneMaterialId,
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

/**
 * The material slots of a roof's geometry and the surface role each one is
 * painted with: 0 the gables (the roof's own walls), 1 the fascia (eave and
 * rake ends of the overhang, fascia boards), 2 the inside, 3 the covering,
 * 4 the soffit (the underside of the deck).
 */
export const ROOF_SLOT_ROLES = [
  'edge',
  'fascia',
  'wall',
  'top',
  'soffit',
] as const satisfies readonly RoofSurfaceMaterialRole[]

// Declared catalog defaults for an unpainted roof, per slot. The gables, the
// fascia and the soffit mirror the wall kind's default (WALL_SLOT_DEFAULT =
// concrete-drywall) so a roof reads as continuous with the walls below it.
const ROOF_DEFAULT_REFS: readonly string[] = [
  'library:concrete-drywall',
  'library:concrete-drywall',
  'library:preset-softwhite',
  'library:roof-terracottatiles',
  'library:concrete-drywall',
]

export type RoofMaterialArray = THREE.Material[]

/**
 * A roof's per-slot material array from a per-role resolver: each slot takes
 * its own role's paint, else the slot's fallback — never another role's.
 */
export function buildRoofSlotMaterials(
  resolveRole: (role: RoofSurfaceMaterialRole) => THREE.Material | null,
  fallback: (slot: number) => THREE.Material,
): RoofMaterialArray {
  const byRole = new Map<RoofSurfaceMaterialRole, THREE.Material | null>()
  return ROOF_SLOT_ROLES.map((role, slot) => {
    if (!byRole.has(role)) byRole.set(role, resolveRole(role))
    return byRole.get(role) ?? fallback(slot)
  })
}

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

/**
 * The cladding the walls under a roof declare through their ASSEMBLIES
 * (`wall.assembly.exterior.finish` → catalog ref), so the roof's gable band —
 * the triangle of wall above the plate that the roof kind builds — is skinned
 * like the walls it sits on instead of the bare drywall default. The most
 * common ref among the level's walls wins; null when none declares one.
 */
export function levelWallCladdingRef(
  nodes: Readonly<Record<string, AnyNode | undefined>>,
  roof: Pick<RoofNode, 'parentId'>,
): string | null {
  const levelId = roof.parentId
  if (!levelId) return null
  const counts = new Map<string, number>()
  for (const node of Object.values(nodes)) {
    if (node?.type !== 'wall' || node.parentId !== levelId) continue
    const ref = wallAssemblyFinishRef(node)
    if (ref) counts.set(ref, (counts.get(ref) ?? 0) + 1)
  }
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

export function getRoofMaterialArray(
  node: RoofNode,
  shading: RenderShading = 'rendered',
  textures = true,
  colorPreset: ColorPreset = 'clay',
  sceneTheme?: string,
  /** Catalog ref for the gable/trim band when unpainted — see `levelWallCladdingRef`. */
  wallCladdingRef: string | null = null,
  sceneMaterials?: SceneMaterials,
): RoofMaterialArray | null {
  const specs = new Map(
    ROOF_SLOT_ROLES.map((role) => [role, getEffectiveRoofSurfaceMaterial(node, role)] as const),
  )

  const cacheKey = JSON.stringify({
    shading,
    textures,
    colorPreset,
    sceneTheme,
    wallCladdingRef,
    roles: [...specs.values()].map((spec) => getSurfaceMaterialSignature(spec, sceneMaterials)),
  })

  const cached = roofMaterialArrayCache.get(cacheKey)
  if (cached) return cached

  // Themed role colours: the covering, gables, fascia and soffit use the
  // 'roof' role, the inside uses 'ceiling'. These also fill any untextured
  // slot so an untextured roof is theme-coloured regardless of the textures
  // toggle (no more white default).
  const roofMaterial = createSurfaceRoleMaterial('roof', colorPreset, undefined, sceneTheme)
  const ceilingMaterial = createSurfaceRoleMaterial('ceiling', colorPreset, undefined, sceneTheme)
  const roleArray: RoofMaterialArray = ROOF_SLOT_ROLES.map((role) =>
    role === 'wall' ? ceilingMaterial : roofMaterial,
  )

  // Textures-off (monochrome) is the guaranteed escape hatch: themed role
  // colours, no catalog finishes.
  if (!textures) {
    roofMaterialArrayCache.set(cacheKey, roleArray)
    return roleArray
  }

  // Textures-on default appearance: catalog finishes per slot (terracotta
  // shingle, soft-white inside, wall-coloured gables, fascia and soffit).
  // Used both when the roof is unpainted and to fill any unpainted slot below.
  const defaultArray: RoofMaterialArray = ROOF_DEFAULT_REFS.map((ref, slot) =>
    resolveSlotDefaultMaterial(
      slot === 0 || slot === 1 || slot === 4 ? (wallCladdingRef ?? ref) : ref,
      shading,
    ),
  )

  const resolved = new Map(
    [...specs].map(
      ([role, spec]) =>
        [
          role,
          createResolvedMaterial(spec.material, spec.materialPreset, sceneMaterials, shading),
        ] as const,
    ),
  )

  if (![...resolved.values()].some(Boolean)) {
    roofMaterialArrayCache.set(cacheKey, defaultArray)
    return defaultArray
  }

  // Each slot resolves to its own role only, then the declared default — never
  // another role. The legacy catch-all still fills every role because
  // `getEffectiveRoofSurfaceMaterial` returns it for every role alike.
  const materialArray = buildRoofSlotMaterials(
    (role) => resolved.get(role) ?? null,
    (slot) => defaultArray[slot]!,
  )
  roofMaterialArrayCache.set(cacheKey, materialArray)
  return materialArray
}
