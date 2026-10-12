import {
  type AnyNode,
  computePlateSurfacePartition,
  type MaterialSchema,
  plateLevelContext,
  pointInPolygon2D,
  resolveSlabFeaturePlacement,
  SLAB_TOP_SLOT_DEFAULT,
  type SlabFeatureNode,
} from '@pascal-app/core'

export function slabFeatureFinish(
  node: SlabFeatureNode,
  nodes: Readonly<Record<string, AnyNode>>,
  omit?: string,
): string | MaterialSchema {
  let current: AnyNode | undefined = node
  while (current?.type === 'slab-feature') {
    if (current.id !== omit && current.slots?.surface) return current.slots.surface
    current = nodes[current.parentId ?? '']
  }
  const p = resolveSlabFeaturePlacement(nodes, node),
    slab = p.slab
  if (slab.boundary === 'auto') {
    const context = plateLevelContext(nodes[slab.parentId ?? ''] ?? null, (id) => nodes[id])
    const partition = computePlateSurfacePartition(slab, context)
    const cell = partition?.cells.find((cell) =>
      cell.polygons.some(
        (polygon) =>
          pointInPolygon2D([p.x, p.z], polygon.outer, { includeBoundary: true }) &&
          !polygon.holes.some((hole) =>
            pointInPolygon2D([p.x, p.z], hole, { includeBoundary: true }),
          ),
      ),
    )
    if (cell?.finish) return cell.finish as string | MaterialSchema
  }
  return slab.slots?.surface ?? slab.materialPreset ?? slab.material ?? SLAB_TOP_SLOT_DEFAULT
}
