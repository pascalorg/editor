import {
  type BlockNode,
  type BlockTopology,
  type DeclaredHostSurface,
  getBlockFaceFrame,
  type SurfaceProvider,
  surfaceRegionContainsPoint,
} from '@pascal-app/core'

const topSurfaces = new WeakMap<BlockTopology, DeclaredHostSurface[]>()

export function blockTopSurfaces(host: BlockNode): DeclaredHostSurface[] {
  const cached = topSurfaces.get(host.topology)
  if (cached) return cached
  const vertices = new Map(host.topology.vertices.map((v) => [v.id, v.position]))
  const surfaces = host.topology.faces.flatMap((face) => {
    const frame = getBlockFaceFrame(host.topology, face.id)
    if (!frame || frame.normal[1] < 0.75) return []
    return [
      {
        id: face.id,
        position: [0, frame.origin[1], 0] as const,
        normal: frame.normal,
        region: {
          kind: 'polygon' as const,
          points: face.vertexIds.map((id) => {
            const p = vertices.get(id)!
            return [p[0], p[2]] as const
          }),
        },
      },
    ]
  })
  topSurfaces.set(host.topology, surfaces)
  return surfaces
}

export const blockSurfaceProvider: SurfaceProvider = {
  childFrame: 'host-local',
  surfaces: (host) => blockTopSurfaces(host as BlockNode),
  resolveHit(rawHost, hit) {
    if (hit.normalWorldY < 0.75 || !hit.point.every(Number.isFinite)) return null
    const host = rawHost as BlockNode
    const candidates = blockTopSurfaces(host).filter((surface) =>
      surfaceRegionContainsPoint(surface.region, [hit.point[0], hit.point[2]]),
    )
    let nearest: DeclaredHostSurface | null = null
    let distance = Infinity
    for (const surface of candidates) {
      const face = getBlockFaceFrame(host.topology, surface.id)!
      const y =
        face.origin[1] -
        (face.normal[0] * (hit.point[0] - face.origin[0]) +
          face.normal[2] * (hit.point[2] - face.origin[2])) /
          face.normal[1]
      const delta = Math.abs(y - hit.point[1])
      if (delta < distance) {
        distance = delta
        nearest = { ...surface, position: [0, y, 0] }
      }
    }
    return nearest
  },
}
