import {
  type AnyNodeId,
  type FenceNode,
  findLevelAncestorId,
  type GridEvent,
  projectPointToFence,
  sampleFenceCenterline,
  useScene,
} from '@pascal-app/core'
import { createSceneSupportHeightSampler, useViewer } from '@pascal-app/viewer'

export function pickFenceTarget(
  point: readonly [number, number],
  host?: FenceNode,
  ray?: GridEvent['localRay'],
) {
  const nodes = useScene.getState().nodes
  const levelId = useViewer.getState().selection.levelId
  let best: { fence: FenceNode; center: number; distance: number } | undefined
  for (const fence of host ? [nodes[host.id]] : Object.values(nodes)) {
    if (fence?.type !== 'fence' || fence.visible === false) continue
    if (!host && levelId && findLevelAncestorId(fence.id, nodes) !== levelId) continue
    if (ray && !host) {
      const points = sampleFenceCenterline(fence)
      const hostLevel = findLevelAncestorId(fence.id, nodes)
      if (!hostLevel) continue
      const support = createSceneSupportHeightSampler(
        nodes,
        hostLevel as AnyNodeId,
        fence.surfaceMode === 'selected'
          ? ((fence.supportSurfaceNodeId ?? fence.supportSlabId) as AnyNodeId | undefined)
          : undefined,
      )
      let along = 0
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1]!
        const b = points[i]!
        const sx = b.x - a.x
        const sz = b.y - a.y
        const span = Math.hypot(sx, sz)
        const [ox, oy, oz] = ray.origin
        const [dx, dy, dz] = ray.direction
        const denominator = dx * sz - dz * sx
        if (Math.abs(denominator) > 1e-8) {
          const t = ((a.x - ox) * sz - (a.y - oz) * sx) / denominator
          const u = ((a.x - ox) * dz - (a.y - oz) * dx) / denominator
          if (t >= 0 && u >= 0 && u <= 1) {
            const x = a.x + sx * u
            const z = a.y + sz * u
            const base =
              (fence.surfaceMode === 'level' ? support(...fence.start) : support(x, z)) +
              (fence.supportOffset ?? 0)
            const y = oy + dy * t
            if (y >= base - 0.1 && y <= base + fence.height + 0.2 && (!best || t < best.distance))
              best = { fence, center: along + span * u, distance: t }
          }
        }
        along += span
      }
    } else {
      const projection = projectPointToFence(fence, point)
      if ((!best || projection.distance < best.distance) && projection.distance <= 0.7)
        best = { fence, ...projection }
    }
  }
  return best ?? null
}
