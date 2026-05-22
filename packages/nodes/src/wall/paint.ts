import {
  type AnyNodeId,
  getEffectiveWallSurfaceMaterial,
  type MaterialSchema,
  type PaintCapability,
  sceneRegistry,
  type WallNode,
  type WallSurfaceSide,
} from '@pascal-app/core'
import { getVisibleWallMaterials } from '@pascal-app/viewer'
import type { Material, Mesh } from 'three'

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

export function buildWallSurfaceMaterialPatch(
  node: WallNode,
  targetSide: WallSurfaceSide,
  material: MaterialSchema | undefined,
  materialPreset: string | undefined,
): Partial<WallNode> {
  const nextSurfaceMaterial = { material, materialPreset }
  const nextInterior =
    targetSide === 'interior'
      ? nextSurfaceMaterial
      : getEffectiveWallSurfaceMaterial(node, 'interior')
  const nextExterior =
    targetSide === 'exterior'
      ? nextSurfaceMaterial
      : getEffectiveWallSurfaceMaterial(node, 'exterior')

  return {
    interiorMaterial: nextInterior.material,
    interiorMaterialPreset: nextInterior.materialPreset,
    exteriorMaterial: nextExterior.material,
    exteriorMaterialPreset: nextExterior.materialPreset,
    material: undefined,
    materialPreset: undefined,
  }
}

/**
 * Apply a preview to the wall's registered mesh by synthesising the
 * post-paint node, asking the viewer's `getVisibleWallMaterials` for
 * the corresponding material array, and swapping the mesh's
 * material assignment until the editor calls the returned cleanup.
 */
function applyWallPreview(
  node: WallNode,
  role: WallSurfaceSide,
  material: MaterialSchema | undefined,
  materialPreset: string | undefined,
): (() => void) | null {
  const mesh = sceneRegistry.nodes.get(node.id as AnyNodeId)
  if (!(mesh && (mesh as Mesh).isMesh)) return null
  const wallMesh = mesh as Mesh

  const previewNode: WallNode = {
    ...node,
    ...buildWallSurfaceMaterialPatch(node, role, material, materialPreset),
  }
  const nextMaterial = getVisibleWallMaterials(previewNode)
  if (!nextMaterial) return null

  const previousMaterial = wallMesh.material as Material | Material[]
  wallMesh.material = nextMaterial
  return () => {
    wallMesh.material = previousMaterial
  }
}

/**
 * Capability binding for the wall kind. The editor's
 * selection-manager invokes these in place of the legacy
 * `if (node.type === 'wall') { ... }` arms.
 */
export const wallPaint: PaintCapability = {
  resolveRole: ({ node, materialIndex, normal, localPosition }) =>
    resolveWallRole({ node: node as WallNode, materialIndex, normal, localPosition }),
  buildPatch: ({ node, role, material, materialPreset }) =>
    buildWallSurfaceMaterialPatch(
      node as WallNode,
      role as WallSurfaceSide,
      material,
      materialPreset,
    ),
  applyPreview: ({ node, role, material, materialPreset }) =>
    applyWallPreview(node as WallNode, role as WallSurfaceSide, material, materialPreset),
  getEffectiveMaterial: ({ node, role }) => {
    const spec = getEffectiveWallSurfaceMaterial(node as WallNode, role as WallSurfaceSide)
    return { material: spec.material, materialPreset: spec.materialPreset }
  },
}
