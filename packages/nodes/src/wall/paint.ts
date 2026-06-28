import {
  type AnyNode,
  type AnyNodeId,
  getEffectiveWallSurfaceMaterial,
  type PaintCapability,
  type PaintPreviewArgs,
  sceneRegistry,
  type WallNode,
  type WallSurfaceSide,
} from '@pascal-app/core'
import type { Material, Mesh } from 'three'
import { buildSlotPreviewMaterial, createSlotPaintCapability } from '../shared/slot-paint'

/**
 * Resolve which side of a wall the user clicked. Walls expose two
 * paintable surfaces — interior + exterior — split by:
 *   1. Material-slot index from the renderer's groups (1 = interior,
 *      2 = exterior). Cheap reference-equality path.
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
  materialIndex: number | null
  normal: readonly [number, number, number] | undefined
  localPosition: readonly [number, number, number] | undefined
}): WallSurfaceSide | null {
  const { node, materialIndex, normal, localPosition } = args
  if (materialIndex === 1) return 'interior'
  if (materialIndex === 2) return 'exterior'

  const normalZ = normal?.[2]
  const localZ = localPosition?.[2]
  const thickness = node.thickness ?? 0.1

  if (
    normalZ === undefined ||
    localZ === undefined ||
    Math.abs(normalZ) < 0.65 ||
    Math.abs(localZ) < Math.max(thickness * 0.2, 0.01)
  ) {
    return null
  }

  const hitFace = localZ >= 0 ? 'front' : 'back'
  const semantic = hitFace === 'front' ? node.frontSide : node.backSide

  if (semantic === 'interior' || semantic === 'exterior') {
    return semantic
  }

  return hitFace === 'front' ? 'interior' : 'exterior'
}

// The wall's 3-material array maps side → group index (see
// `getVisibleWallMaterials`): 0 = edge/cap, 1 = interior, 2 = exterior.
const WALL_SIDE_MATERIAL_INDEX: Record<WallSurfaceSide, 1 | 2> = {
  interior: 1,
  exterior: 2,
}

/**
 * Preview a wall paint by swapping just the painted face's entry in the wall
 * mesh's material array. The array is the shared cached `WallMaterials.visible`,
 * so we clone it before swapping and restore the original reference on cleanup
 * (never mutate the cache).
 */
function applyWallPreview(args: PaintPreviewArgs): (() => void) | null {
  const { role, material, materialPreset } = args
  const side = role as WallSurfaceSide
  const index = WALL_SIDE_MATERIAL_INDEX[side]
  if (!index) return null

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
 * writes `node.slots[interior|exterior]` (a `library:` ref or a minted
 * `scene:` material) exactly like every other kind; `legacyEffective` reads
 * the retired inline `interiorMaterial*` / `exteriorMaterial*` fields so the
 * picker still shows the current value on a pre-migration scene.
 */
export const wallPaint: PaintCapability = createSlotPaintCapability({
  roomScope: true,
  resolveRole: ({ node, materialIndex, normal, localPosition }) =>
    resolveWallRole({ node: node as WallNode, materialIndex, normal, localPosition }),
  applyPreview: applyWallPreview,
  legacyEffective: (node: AnyNode, role: string) => {
    const spec = getEffectiveWallSurfaceMaterial(node as WallNode, role as WallSurfaceSide)
    if (spec.material === undefined && spec.materialPreset === undefined) return null
    return { material: spec.material, materialPreset: spec.materialPreset }
  },
})
