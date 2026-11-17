import type { FloorplanAffordance, RockNode } from '@pascal-app/core'
import { createRockPolygonSession } from './edit-session'
import { rockPlanToSite } from './floorplan-move'
import { snapRockPlacementPoint } from './placement'

type Point = [number, number]
type Mode = 'move-vertex' | 'add-vertex' | 'move-edge' | 'delete-vertex'

/** Site-space polygon edits, previewed without any scene write until pointer release. */
function rockAffordance(mode: Mode): FloorplanAffordance<RockNode> {
  return {
    start({ node, nodes, payload, initialPlanPoint }) {
      const { vertexIndex = -1, edgeIndex = -1 } = payload as {
        vertexIndex?: number
        edgeIndex?: number
      }
      const toSite = rockPlanToSite(node, nodes)
      const origin = toSite([initialPlanPoint[0], initialPlanPoint[1]])
      const ring = node.polygon.map(([x, z]): Point => [x, z])
      const session = createRockPolygonSession(node)
      const a = ring[edgeIndex]
      const b = ring[(edgeIndex + 1) % ring.length]
      let index = vertexIndex
      if (mode === 'add-vertex' && a && b) {
        index = edgeIndex + 1
        ring.splice(index, 0, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2])
      }
      if (mode === 'delete-vertex' && ring.length > 3 && ring[index]) {
        session.preview(ring.filter((_, i) => i !== index))
      }
      return {
        affectedIds: session.affectedIds,
        apply({ planPoint, modifiers }) {
          if (mode === 'delete-vertex') return
          const point = snapRockPlacementPoint(
            toSite([planPoint[0], planPoint[1]]),
            modifiers.altKey,
          )
          if (mode === 'move-edge') {
            if (!(a && b)) return
            const length = Math.hypot(b[0] - a[0], b[1] - a[1])
            if (length < 1e-6) return
            const normal: Point = [-(b[1] - a[1]) / length, (b[0] - a[0]) / length]
            const distance = (point[0] - origin[0]) * normal[0] + (point[1] - origin[1]) * normal[1]
            session.preview(
              ring.map(
                (p, i): Point =>
                  i === edgeIndex || i === (edgeIndex + 1) % ring.length
                    ? [p[0] + normal[0] * distance, p[1] + normal[1] * distance]
                    : p,
              ),
            )
          } else if (ring[index]) {
            session.preview(ring.map((p, i) => (i === index ? point : p)))
          }
        },
        canCommit: session.canCommit,
        commit: session.commit,
      }
    },
  }
}

export const rockMoveVertexAffordance = rockAffordance('move-vertex')
export const rockAddVertexAffordance = rockAffordance('add-vertex')
export const rockMoveEdgeAffordance = rockAffordance('move-edge')
export const rockDeleteVertexAffordance = rockAffordance('delete-vertex')
