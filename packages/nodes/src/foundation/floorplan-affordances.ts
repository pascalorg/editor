import { type AnyNode, type FoundationNode, resolveLevelId } from '@pascal-app/core'
import {
  createPolygonAddVertexAffordance,
  createPolygonDeleteVertexAffordance,
  createPolygonMoveEdgeAffordance,
  createPolygonVertexAffordance,
  type PolygonAffordanceSnapContext,
  type PolygonEdgeSnapContext,
} from '../shared/polygon-vertex-affordance'
import { snapEdgeToWallFaces, snapPointToWallFaces, wallFacesOf } from './wall-face-snap'

type P = readonly [number, number]

/** A corner's side within this angle of square (to the plan's axes) snaps square. */
const SQUARE_SNAP = Math.tan((10 * Math.PI) / 180)
/** The least reach of that snap, metres: close to a neighbour, a hand's width still counts. */
const SQUARE_SNAP_MIN = 0.12

/**
 * A dragged corner squared up: each of its coordinates locks onto a neighbour's, or onto its own
 * where the drag began, when the side to it stands within ~10° of square, so its sides run square
 * and a straight pull stays straight. A coordinate nothing locks takes `fallback`'s (the grid's).
 */
export function squareToNeighbours(
  raw: P,
  fallback: P,
  ring: ReadonlyArray<P>,
  index: number,
): [number, number] {
  const count = ring.length
  const anchors = [
    ring[(index - 1 + count) % count],
    ring[(index + 1) % count],
    ring[index],
  ].filter((anchor): anchor is P => anchor !== undefined)
  const lock = (axis: 0 | 1) => {
    let best: number | null = null
    let gap = Number.POSITIVE_INFINITY
    for (const anchor of anchors) {
      const reach = Math.max(
        SQUARE_SNAP_MIN,
        SQUARE_SNAP * Math.hypot(raw[0] - anchor[0], raw[1] - anchor[1]),
      )
      const off = Math.abs(raw[axis] - anchor[axis])
      if (off <= reach && off < gap) {
        best = anchor[axis]
        gap = off
      }
    }
    return best ?? fallback[axis]
  }
  return [lock(0), lock(1)]
}

/** The outside faces of the walls over `node`'s foundation (`wallFacesOf`). */
const facesFor = (node: FoundationNode, nodes: Record<string, AnyNode>) =>
  wallFacesOf(nodes, resolveLevelId(node, nodes))

/**
 * The foundation outline's plan edits, the slab's own (`move-vertex`, `add-vertex`, `move-edge`,
 * `delete-vertex`), snapping onto the walls' outside faces, where the foundation traced from them
 * runs: a corner onto a corner of them or a face, a side onto a face it runs with, when near, and
 * else to the grid. A dragged corner squares up to its neighbours; a dragged side keeps its
 * neighbours' angles, and pulling out part of a split side makes a square bump-out. Alt drags free
 * of both snaps.
 */
const foundationSnapOptions = {
  keepNeighbourAngles: true,
  resolvePlanPoint({
    node,
    nodes,
    rawPoint,
    fallbackPoint,
    modifiers,
    mode,
    ring,
    vertexIndex,
  }: PolygonAffordanceSnapContext<FoundationNode>) {
    if (mode === 'move-edge' || modifiers.altKey) return fallbackPoint
    const face = snapPointToWallFaces(facesFor(node, nodes as Record<string, AnyNode>), rawPoint)
    if (face) return face
    return ring && vertexIndex !== undefined
      ? squareToNeighbours(rawPoint, fallbackPoint, ring, vertexIndex)
      : fallbackPoint
  },
  snapEdge({ node, nodes, edge, modifiers }: PolygonEdgeSnapContext<FoundationNode>) {
    if (modifiers.altKey) return null
    return snapEdgeToWallFaces(facesFor(node, nodes as Record<string, AnyNode>), edge)
  },
}

export const foundationMoveVertexAffordance = createPolygonVertexAffordance<FoundationNode>(
  'foundation',
  foundationSnapOptions,
)
export const foundationAddVertexAffordance = createPolygonAddVertexAffordance<FoundationNode>(
  'foundation',
  foundationSnapOptions,
)
export const foundationMoveEdgeAffordance = createPolygonMoveEdgeAffordance<FoundationNode>(
  'foundation',
  foundationSnapOptions,
)
export const foundationDeleteVertexAffordance = createPolygonDeleteVertexAffordance<FoundationNode>(
  'foundation',
  foundationSnapOptions,
)
