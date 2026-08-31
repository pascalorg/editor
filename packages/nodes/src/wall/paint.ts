import {
  type AnyNode,
  type AnyNodeId,
  getEffectiveWallSurfaceMaterial,
  getWallBandSlotId,
  getWallFaceBandConfig,
  getWallFaceBandForHeight,
  getWallSurfaceSideFromBandSlot,
  type PaintCapability,
  type PaintPreviewArgs,
  parseMaterialRef,
  type SceneMaterialId,
  sceneRegistry,
  useScene,
  WALL_SURFACE_SLOT_DEFAULTS,
  type WallNode,
  type WallSurfaceSide,
  type WallSurfaceSlotId,
} from '@pascal-app/core'
import { type Material, type Mesh, type Object3D, type Ray, Raycaster } from 'three'
import {
  buildSlotPreviewMaterial,
  createSlotPaintCapability,
  previewSlotByUserData,
} from '../shared/slot-paint'
import { resolveWallOpeningCeiling } from '../shared/wall-opening-ceiling'

const WALL_SLOT_IDS = new Set<string>(Object.keys(WALL_SURFACE_SLOT_DEFAULTS))
const WALL_ARRAY_SLOT_INDEX: Partial<Record<WallSurfaceSlotId, number>> = {
  interior: 1,
  exterior: 2,
  lowerInterior: 3,
  middleInterior: 4,
  upperInterior: 5,
  topInterior: 6,
  lowerExterior: 7,
  middleExterior: 8,
  upperExterior: 9,
  topExterior: 10,
}
const WALL_INDEX_SLOT = new Map<number, WallSurfaceSlotId>(
  Object.entries(WALL_ARRAY_SLOT_INDEX).map(([slotId, index]) => [
    index,
    slotId as WallSurfaceSlotId,
  ]),
)
const wallSlotRaycaster = new Raycaster()

function resolveSideFromMaterialIndex(materialIndex: number | null): WallSurfaceSide | null {
  const slotId = materialIndex === null ? undefined : WALL_INDEX_SLOT.get(materialIndex)
  if (slotId) return getWallSurfaceSideFromBandSlot(slotId)
  return null
}

function resolveWallSlotByRay(node: WallNode, ray: Ray | undefined): WallSurfaceSlotId | null {
  if (!ray) return null
  const root = sceneRegistry.nodes.get(node.id as AnyNodeId)
  if (!root) return null

  wallSlotRaycaster.ray.copy(ray)
  const hits = wallSlotRaycaster.intersectObject(root, true)
  for (const hit of hits) {
    const slotId = (hit.object as Object3D).userData?.slotId
    if (typeof slotId === 'string' && WALL_SLOT_IDS.has(slotId)) {
      return slotId as WallSurfaceSlotId
    }
  }

  return null
}

/**
 * Resolve which wall face band the user clicked. The side comes from:
 *   1. Material-slot index from the renderer's groups. Cheap reference path.
 *   2. Falls back to the hit-surface normal + local-Z when the
 *      groups aren't conclusive. Front/back of the wall maps to the
 *      node's `frontSide` / `backSide` semantic; absent that, front
 *      → interior, back → exterior.
 *
 * Returns null when the click is too oblique (or lands on the wall's
 * end-cap, etc.) to confidently assign a side.
 */
export function resolveWallRole(args: {
  node: WallNode
  hitObject?: { userData?: { slotId?: unknown } }
  materialIndex: number | null
  normal: readonly [number, number, number] | undefined
  localPosition: readonly [number, number, number] | undefined
  ray?: Ray
}): string | null {
  const { node, hitObject, materialIndex, normal, localPosition, ray } = args
  const directSlotId = hitObject?.userData?.slotId
  if (typeof directSlotId === 'string' && WALL_SLOT_IDS.has(directSlotId)) {
    return directSlotId
  }

  const raySlotId = resolveWallSlotByRay(node, ray)
  if (raySlotId) return raySlotId

  const indexedSlotId = materialIndex === null ? undefined : WALL_INDEX_SLOT.get(materialIndex)
  const indexedSide = resolveSideFromMaterialIndex(materialIndex)
  const sideFromIndex = indexedSide ?? null
  if (indexedSlotId && indexedSlotId !== 'interior' && indexedSlotId !== 'exterior') {
    return indexedSlotId
  }

  if (sideFromIndex && localPosition) {
    const effectiveWallHeight = resolveWallOpeningCeiling(node, useScene.getState().nodes)
    const bands = getWallFaceBandConfig(node, effectiveWallHeight)
    if (!bands.enabled) return sideFromIndex
    return getWallBandSlotId(
      sideFromIndex,
      getWallFaceBandForHeight(node, localPosition[1], effectiveWallHeight),
    )
  }
  if (sideFromIndex) return sideFromIndex

  const normalZ = normal?.[2]
  const localZ = localPosition?.[2]
  const thickness = node.thickness ?? 0.1

  if (
    normalZ === undefined ||
    localZ === undefined ||
    localPosition === undefined ||
    Math.abs(normalZ) < 0.65 ||
    Math.abs(localZ) < Math.max(thickness * 0.2, 0.01)
  ) {
    return null
  }

  const hitFace = localZ >= 0 ? 'front' : 'back'
  const semantic = hitFace === 'front' ? node.frontSide : node.backSide

  if (semantic === 'interior' || semantic === 'exterior') {
    const effectiveWallHeight = resolveWallOpeningCeiling(node, useScene.getState().nodes)
    const bands = getWallFaceBandConfig(node, effectiveWallHeight)
    if (!bands.enabled) return semantic
    return getWallBandSlotId(
      semantic,
      getWallFaceBandForHeight(node, localPosition[1], effectiveWallHeight),
    )
  }

  const side = hitFace === 'front' ? 'interior' : 'exterior'
  const effectiveWallHeight = resolveWallOpeningCeiling(node, useScene.getState().nodes)
  const bands = getWallFaceBandConfig(node, effectiveWallHeight)
  if (!bands.enabled) return side
  return getWallBandSlotId(
    side,
    getWallFaceBandForHeight(node, localPosition[1], effectiveWallHeight),
  )
}

/**
 * Preview a wall paint by swapping just the painted face's entry in the wall
 * mesh's material array. The array is the shared cached `WallMaterials.visible`,
 * so we clone it before swapping and restore the original reference on cleanup
 * (never mutate the cache).
 */
function applyWallPreview(args: PaintPreviewArgs): (() => void) | null {
  const { role, material, materialPreset } = args
  if (!(role in WALL_ARRAY_SLOT_INDEX)) {
    return previewSlotByUserData(args)
  }

  const index = WALL_ARRAY_SLOT_INDEX[role as WallSurfaceSlotId]
  if (!index) return previewSlotByUserData(args)

  const mesh = sceneRegistry.nodes.get(args.node.id as AnyNodeId)
  if (!(mesh && (mesh as Mesh).isMesh)) return null
  const wallMesh = mesh as Mesh

  const current = wallMesh.material
  if (!Array.isArray(current)) return null

  const preview = buildSlotPreviewMaterial(material, materialPreset)
  if (!preview) return () => {}

  const previous = current as Material[]
  const next = previous.slice()
  next[index] = preview
  wallMesh.material = next

  return () => {
    wallMesh.material = previous
  }
}

/**
 * Capability binding for the wall kind on the unified slot model. Painting
 * writes `node.slots[bandSide]` (a `library:` ref or a minted `scene:`
 * material) exactly like every other kind; `legacyEffective` reads the
 * whole-side fallback so old scenes still show the current value.
 */
export const wallPaint: PaintCapability = createSlotPaintCapability({
  roomScope: true,
  resolveRole: ({ node, hitObject, materialIndex, normal, localPosition, ray }) =>
    resolveWallRole({
      node: node as WallNode,
      hitObject: hitObject as { userData?: { slotId?: unknown } } | undefined,
      materialIndex,
      normal,
      localPosition,
      ray,
    }),
  applyPreview: applyWallPreview,
  legacyEffective: (node: AnyNode, role: string) => {
    const side = getWallSurfaceSideFromBandSlot(role)
    if (!side && role in WALL_SURFACE_SLOT_DEFAULTS) {
      return {
        material: undefined,
        materialPreset: WALL_SURFACE_SLOT_DEFAULTS[role as WallSurfaceSlotId],
      }
    }
    if (!side) return null

    const sideRef = (node as WallNode).slots?.[side]
    const parsed = parseMaterialRef(sideRef)
    if (parsed?.kind === 'library') {
      return { material: undefined, materialPreset: sideRef }
    }
    if (parsed?.kind === 'scene') {
      const sceneMaterial = useScene.getState().materials[parsed.id as SceneMaterialId]
      if (sceneMaterial) return { material: sceneMaterial.material, materialPreset: undefined }
    }

    const spec = getEffectiveWallSurfaceMaterial(node as WallNode, side)
    if (spec.material === undefined && spec.materialPreset === undefined) return null
    return { material: spec.material, materialPreset: spec.materialPreset }
  },
})
