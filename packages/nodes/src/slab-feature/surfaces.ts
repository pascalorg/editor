import {
  type AnyNode,
  type DeclaredHostSurface,
  resolveSlabFeaturePlacement,
  type SlabFeatureNode,
  type SurfaceContext,
  type SurfaceProvider,
  surfaceRegionContainsPoint,
} from '@pascal-app/core'

export function slabFeatureLocalFrame(
  node: SlabFeatureNode,
  context: { nodes: Readonly<Record<string, AnyNode>>; planOnly: boolean },
) {
  const p = resolveSlabFeaturePlacement(context.nodes, node)
  const parent = context.nodes[node.parentId ?? '']
  const host =
    parent?.type === 'slab-feature' ? resolveSlabFeaturePlacement(context.nodes, parent) : null
  return {
    position: [
      p.x - (host?.x ?? 0),
      context.planOnly ? 0 : p.mount - (host?.mount ?? 0),
      p.z - (host?.z ?? 0),
    ] as const,
    rotation: [0, 0, 0] as const,
  }
}

export function slabFeatureSurfaces(
  host: AnyNode,
  ctx: SurfaceContext,
): readonly DeclaredHostSurface[] {
  if (host.type !== 'slab-feature') return []
  const nodes: Readonly<Record<string, AnyNode>> = ctx.scene.nodes()
  if (!host.visible || nodes[host.parentId ?? '']?.visible === false) return []
  const p = resolveSlabFeaturePlacement(nodes, host)
  if (!p.slab.visible) return []
  const holes: [number, number][][] = []
  for (const id of host.children) {
    const child = nodes[id]
    if (child?.type !== 'slab-feature' || !child.visible) continue
    holes.push([
      [child.x - child.width / 2, child.z - child.length / 2],
      [child.x + child.width / 2, child.z - child.length / 2],
      [child.x + child.width / 2, child.z + child.length / 2],
      [child.x - child.width / 2, child.z + child.length / 2],
    ])
  }
  return [
    {
      id: 'resting',
      label: host.mode === 'bump' ? 'Bump top' : 'Niche floor',
      position: [0, p.surface - p.mount, 0],
      normal: [0, 1, 0],
      gridSnap: true,
      region: { kind: 'rect', size: [host.width / 2, host.length / 2], holes },
    },
  ]
}

export const slabFeatureSurfaceProvider: SurfaceProvider = {
  childFrame: 'surface-local',
  surfaces: slabFeatureSurfaces,
  accepts: (_host, kind) => kind === 'item' || kind === 'procedural-item',
  resolveHit(host, hit, ctx) {
    if (hit.normalWorldY < 0.75) return null
    return (
      slabFeatureSurfaces(host, ctx).find(
        (surface) =>
          Math.abs(hit.point[1] - surface.position[1]) < 0.02 &&
          surfaceRegionContainsPoint(surface.region, [hit.point[0], hit.point[2]]),
      ) ?? null
    )
  },
}

export function slabFeatureSupportHeight(
  host: AnyNode,
  x: number,
  z: number,
  context: { nodes: Readonly<Record<string, AnyNode>> },
) {
  if (host.type !== 'slab-feature' || !host.visible) return null
  const p = resolveSlabFeaturePlacement(context.nodes, host)
  if (x < p.bounds.x0 || x > p.bounds.x1 || z < p.bounds.z0 || z > p.bounds.z1) return null
  for (const id of host.children) {
    const child = context.nodes[id]
    if (child?.type !== 'slab-feature' || !child.visible) continue
    const nested = resolveSlabFeaturePlacement(context.nodes, child)
    if (
      x >= nested.bounds.x0 &&
      x <= nested.bounds.x1 &&
      z >= nested.bounds.z0 &&
      z <= nested.bounds.z1
    )
      return null
  }
  return p.surface
}

export function slabFeatureTopAt(
  slab: import('@pascal-app/core').SlabNode,
  x: number,
  z: number,
  nodes: Readonly<Record<string, AnyNode>>,
) {
  let height: number | null = null
  for (const id of slab.children ?? []) {
    const feature = nodes[id]
    if (feature?.type !== 'slab-feature' || !feature.visible) continue
    const p = resolveSlabFeaturePlacement(nodes, feature)
    if (x < p.bounds.x0 || x > p.bounds.x1 || z < p.bounds.z0 || z > p.bounds.z1) continue
    height = p.surface
    for (const childId of feature.children) {
      const child = nodes[childId]
      if (child?.type !== 'slab-feature' || !child.visible) continue
      const nested = resolveSlabFeaturePlacement(nodes, child)
      if (
        x >= nested.bounds.x0 &&
        x <= nested.bounds.x1 &&
        z >= nested.bounds.z0 &&
        z <= nested.bounds.z1
      )
        height = nested.surface
    }
  }
  return height
}
