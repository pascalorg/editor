import {
  type AnyNode,
  type AnyNodeId,
  type DeclaredHostSurface,
  resolveWallFeaturePlacement,
  type SurfaceContext,
  type SurfaceProvider,
  surfaceRegionContainsPoint,
  type WallFeatureNode,
} from '@pascal-app/core'

export function wallFeatureLocalFrame(
  node: WallFeatureNode,
  context: {
    nodes: Readonly<Record<string, AnyNode>>
    planOnly: boolean
  },
) {
  const p = resolveWallFeaturePlacement(context.nodes, node)
  const parent = context.nodes[node.parentId ?? '']
  const host =
    parent?.type === 'wall-feature' ? resolveWallFeaturePlacement(context.nodes, parent) : null
  return {
    position: [
      p.bounds.u0 - (host?.bounds.u0 ?? 0),
      context.planOnly ? 0 : p.bottom - (host?.bottom ?? p.wallBase),
      p.surfaceOffset - (host?.surfaceOffset ?? 0),
    ] as const,
    rotation: [0, 0, 0] as const,
  }
}

export function wallFeatureSurfaces(
  host: AnyNode,
  ctx: SurfaceContext,
): readonly DeclaredHostSurface[] {
  if (host.type !== 'wall-feature') return []
  const nodes: Readonly<Record<string, AnyNode>> = ctx.scene.nodes()
  let ancestor: AnyNode | undefined = host
  const seen = new Set<string>()
  while (ancestor && !seen.has(ancestor.id)) {
    if (!ancestor.visible) return []
    seen.add(ancestor.id)
    ancestor = ancestor.parentId ? nodes[ancestor.parentId] : undefined
  }
  let p
  try {
    p = resolveWallFeaturePlacement(nodes, host)
  } catch {
    return []
  }
  const y = host.mode === 'bump' ? host.height : 0
  const centerZ = (p.mountOffset - p.surfaceOffset) / 2
  const holes: [number, number][][] = []
  const elevation = p.bottom + y
  for (const child of Object.values(nodes)) {
    if (
      child.parentId !== p.wall.id ||
      !child.visible ||
      (child.type !== 'door' && child.type !== 'window')
    )
      continue
    const bottom = p.wallBase + child.position[1] - child.height / 2
    if (elevation < bottom - 1e-6 || elevation >= bottom + child.height - 1e-6) continue
    const left = Math.max(p.bounds.u0, child.position[0] - child.width / 2) - p.u
    const right = Math.min(p.bounds.u1, child.position[0] + child.width / 2) - p.u
    if (right > left)
      holes.push([
        [left, -host.depth / 2],
        [right, -host.depth / 2],
        [right, host.depth / 2],
        [left, host.depth / 2],
      ])
  }
  if (host.mode === 'bump')
    for (const child of Object.values(nodes)) {
      if (
        child.type !== 'wall-feature' ||
        child.parentId !== host.id ||
        !child.visible ||
        child.mode !== 'niche'
      )
        continue
      const cut = resolveWallFeaturePlacement(nodes, child)
      if (cut.bounds.y1 < elevation - 1e-6) continue
      const left = cut.bounds.u0 - p.u,
        right = cut.bounds.u1 - p.u
      const near = Math.max(p.bounds.n0, cut.bounds.n0) - (p.mountOffset + p.surfaceOffset) / 2
      const far = Math.min(p.bounds.n1, cut.bounds.n1) - (p.mountOffset + p.surfaceOffset) / 2
      if (far > near)
        holes.push([
          [left, near],
          [right, near],
          [right, far],
          [left, far],
        ])
    }
  return [
    {
      id: 'resting',
      label: host.mode === 'bump' ? 'Bump top' : 'Niche shelf',
      position: [host.width / 2, y, centerZ],
      normal: [0, 1, 0],
      gridSnap: true,
      region: { kind: 'rect', size: [host.width / 2, host.depth / 2], holes },
    },
  ]
}

export const wallFeatureSurfaceProvider: SurfaceProvider = {
  childFrame: 'surface-local',
  surfaces: wallFeatureSurfaces,
  resolveHit(host, hit, ctx) {
    if (hit.normalWorldY < 0.75 || !hit.point.every(Number.isFinite)) return null
    return (
      wallFeatureSurfaces(host, ctx).find(
        (surface) =>
          Math.abs(hit.point[1] - surface.position[1]) < 0.02 &&
          surfaceRegionContainsPoint(surface.region, [
            hit.point[0] - surface.position[0],
            hit.point[2] - surface.position[2],
          ]),
      ) ?? null
    )
  },
  accepts: (_host, kind) => kind === 'item' || kind === 'procedural-item',
}

export function wallFeatureSupportHeight(
  host: AnyNode,
  x: number,
  z: number,
  context: { nodes: Readonly<Record<string, AnyNode>> },
) {
  if (host.type !== 'wall-feature') return null
  const surfaces = wallFeatureSurfaces(host, {
    scene: {
      nodes: () => context.nodes,
      get: <N extends AnyNode = AnyNode>(id: AnyNodeId) => context.nodes[id] as N | undefined,
    },
  })
  const surface = surfaces[0]
  if (!surface) return null
  const p = resolveWallFeaturePlacement(context.nodes, host)
  const dx = x - p.wall.start[0],
    dz = z - p.wall.start[1]
  const u = dx * p.tangent[0] + dz * p.tangent[2]
  const n = -dx * p.tangent[2] + dz * p.tangent[0]
  return surfaceRegionContainsPoint(surface.region, [
    u - p.u,
    n - (p.mountOffset + p.surfaceOffset) / 2,
  ])
    ? p.bottom + surface.position[1]
    : null
}
