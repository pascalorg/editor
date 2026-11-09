import {
  type AnyNodeId,
  authorStairOpeningPatches,
  type FloorOpeningNode,
  type FloorplanAffordance,
  type FloorplanAffordanceSession,
  type FloorplanGeometry,
  type GeometryContext,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { getSegmentGridStep, snapPointToGrid, snapScalarToGrid } from '@pascal-app/editor'
import {
  createPolygonAddVertexAffordance,
  createPolygonDeleteVertexAffordance,
  createPolygonMoveEdgeAffordance,
  createPolygonVertexAffordance,
} from '../shared/polygon-vertex-affordance'

const COLOR = '#f59e0b'
/** A side of a stair opening never shrinks below this (metres). */
const MIN_OPENING_SIDE = 0.2

type Ring = [number, number][]

/**
 * A stair's opening: a box its stair cut, resized as a box. An elevator's opening keeps the free
 * polygon handles: its cut comes from the car, so a drawn shape would not stick.
 */
export function isOwnedOpening(node: FloorOpeningNode): boolean {
  return node.source === 'stair' && !!node.ownerId
}

/**
 * The square-cornered rectangle an owned opening is edited as: the ring itself when it already is
 * one, otherwise (an opening cut with rounded corners before they were square) the box around it,
 * aligned with its longest side.
 */
export function openingRectangle(polygon: ReadonlyArray<readonly [number, number]>): Ring {
  const ring = polygon.map(([x, z]) => [x, z] as [number, number])
  let longest = 0
  let axis: [number, number] = [1, 0]
  for (const [i, a] of ring.entries()) {
    const b = ring[(i + 1) % ring.length]!
    const length = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (length > longest) {
      longest = length
      axis = [(b[0] - a[0]) / length, (b[1] - a[1]) / length]
    }
  }
  const normal: [number, number] = [-axis[1], axis[0]]
  const along = ring.map(([x, z]) => x * axis[0] + z * axis[1])
  const across = ring.map(([x, z]) => x * normal[0] + z * normal[1])
  const [u0, u1, v0, v1] = [
    Math.min(...along),
    Math.max(...along),
    Math.min(...across),
    Math.max(...across),
  ]
  const at = (u: number, v: number): [number, number] => [
    u * axis[0] + v * normal[0],
    u * axis[1] + v * normal[1],
  ]
  return [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)]
}

/**
 * `rectangle` with corner `index` dragged to `point`: the opposite corner stays, the two sides
 * through the dragged corner keep their directions, so the box stays a box.
 */
export function resizeRectangleCorner(
  rectangle: Ring,
  index: number,
  point: readonly [number, number],
): Ring {
  const at = (offset: number) => rectangle[(index + offset) % 4]!
  const origin = at(2)
  const unit = (to: [number, number]) => {
    const dx = to[0] - origin[0]
    const dz = to[1] - origin[1]
    const length = Math.hypot(dx, dz) || 1
    return [dx / length, dz / length] as const
  }
  const a = unit(at(1))
  const b = unit(at(3))
  const dx = point[0] - origin[0]
  const dz = point[1] - origin[1]
  const sideA = Math.max(MIN_OPENING_SIDE, dx * a[0] + dz * a[1])
  const sideB = Math.max(MIN_OPENING_SIDE, dx * b[0] + dz * b[1])
  const next = [...rectangle] as Ring
  next[(index + 1) % 4] = [origin[0] + a[0] * sideA, origin[1] + a[1] * sideA]
  next[(index + 3) % 4] = [origin[0] + b[0] * sideB, origin[1] + b[1] * sideB]
  next[index] = [origin[0] + a[0] * sideA + b[0] * sideB, origin[1] + a[1] * sideA + b[1] * sideB]
  return next
}

/** `rectangle` with side `edgeIndex` moved parallel by `distance` along its outward normal. */
export function moveRectangleEdge(rectangle: Ring, edgeIndex: number, distance: number): Ring {
  const start = rectangle[edgeIndex]!
  const end = rectangle[(edgeIndex + 1) % 4]!
  const opposite = rectangle[(edgeIndex + 2) % 4]!
  const length = Math.hypot(end[0] - start[0], end[1] - start[1]) || 1
  let normal: [number, number] = [-(end[1] - start[1]) / length, (end[0] - start[0]) / length]
  // Point the normal away from the box, whichever way the ring winds.
  if ((opposite[0] - start[0]) * normal[0] + (opposite[1] - start[1]) * normal[1] > 0)
    normal = [-normal[0], -normal[1]]
  const depth = (opposite[0] - start[0]) * -normal[0] + (opposite[1] - start[1]) * -normal[1]
  const travel = Math.max(MIN_OPENING_SIDE - depth, distance)
  return rectangle.map((point, i) =>
    i === edgeIndex || i === (edgeIndex + 1) % 4
      ? ([point[0] + normal[0] * travel, point[1] + normal[1] * travel] as [number, number])
      : point,
  )
}

/** Every write for `ring` on a stair's opening: its floor and ceiling cuts take it as drawn. */
function ownedOpeningUpdates(id: AnyNodeId, ring: Ring) {
  const authored = authorStairOpeningPatches(useScene.getState().nodes, id, ring)
  return authored.length ? authored : [{ id, data: { polygon: ring } }]
}

function ownedOpeningSession(
  node: FloorOpeningNode,
  next: (rectangle: Ring, planPoint: readonly [number, number]) => Ring,
): FloorplanAffordanceSession {
  const rectangle = openingRectangle(node.polygon)
  const affectedIds = [
    ...new Set([
      node.id as AnyNodeId,
      ...authorStairOpeningPatches(useScene.getState().nodes, node.id, rectangle).map(
        (patch) => patch.id,
      ),
    ]),
  ]
  let ring: Ring | null = null
  // The drag previews through live overrides; the scene is written once, on release.
  return {
    affectedIds,
    apply({ planPoint }) {
      ring = next(rectangle, planPoint)
      useLiveNodeOverrides
        .getState()
        .setMany(
          ownedOpeningUpdates(node.id as AnyNodeId, ring).map(
            ({ id, data }) => [id, data as Record<string, unknown>] as const,
          ),
        )
    },
    canCommit: () => ring !== null,
    commit() {
      const overrides = useLiveNodeOverrides.getState()
      if (ring)
        useScene.getState().updateNodes(ownedOpeningUpdates(node.id as AnyNodeId, ring) as never)
      for (const id of affectedIds) overrides.clear(id)
    },
  }
}

/** Owned openings resize as a box; every other opening keeps the free polygon handles. */
function ownedOr(
  owned: FloorplanAffordance<FloorOpeningNode>['start'],
  free: FloorplanAffordance<FloorOpeningNode>,
): FloorplanAffordance<FloorOpeningNode> {
  return { start: (args) => (isOwnedOpening(args.node) ? owned(args) : free.start(args)) }
}

const inert = (node: FloorOpeningNode): FloorplanAffordanceSession => ({
  affectedIds: [node.id as AnyNodeId],
  apply() {},
  canCommit: () => false,
})

/**
 * A floor opening on the plan: a dashed amber outline (the void the surfaces
 * around it show), and — while selected — the same corner, midpoint and edge
 * handles slabs and zones use. A stair's opening is a box: its
 * selected outline is solid, its sides carry a grip each to move them
 * parallel and its corners resize it, all at a fixed screen size; it has no
 * midpoint handles to add a vertex.
 */
export function buildFloorOpeningFloorplan(
  node: FloorOpeningNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const owned = isOwnedOpening(node)
  const polygon = owned && ctx.viewState?.selected ? openingRectangle(node.polygon) : node.polygon
  if (polygon.length < 3) return null
  const selected = ctx.viewState?.selected ?? false
  const d = `M ${polygon.map(([x, z]) => `${x} ${z}`).join(' L ')} Z`
  const children: FloorplanGeometry[] = [
    {
      kind: 'path',
      d,
      fill: COLOR,
      fillOpacity: selected ? 0.22 : 0.1,
      stroke: COLOR,
      strokeWidth: selected ? (owned ? 0.06 : 0.04) : 0.03,
      strokeOpacity: 0.95,
      ...(selected && owned ? {} : { strokeDasharray: '0.12 0.08' }),
    },
  ]
  if (selected) {
    polygon.forEach((a, i) => {
      const b = polygon[(i + 1) % polygon.length]!
      children.push({
        kind: 'edge-handle',
        x1: a[0],
        y1: a[1],
        x2: b[0],
        y2: b[1],
        affordance: 'move-edge',
        payload: { edgeIndex: i },
      })
    })
    polygon.forEach((a, i) => {
      const b = polygon[(i + 1) % polygon.length]!
      const point: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
      children.push(
        owned
          ? {
              kind: 'endpoint-handle',
              point,
              state: 'idle',
              screenSized: true,
              affordance: 'move-edge',
              payload: { edgeIndex: i },
            }
          : {
              kind: 'midpoint-handle',
              point,
              affordance: 'add-vertex',
              payload: { edgeIndex: i },
            },
      )
    })
    polygon.forEach(([x, z], i) => {
      children.push({
        kind: 'endpoint-handle',
        point: [x, z],
        state: 'idle',
        ...(owned ? { screenSized: true } : {}),
        affordance: 'move-vertex',
        payload: { vertexIndex: i },
      })
    })
  }
  return { kind: 'group', children }
}

export const floorOpeningMoveVertexAffordance = ownedOr(({ node, payload }) => {
  const { vertexIndex } = payload as { vertexIndex: number }
  return ownedOpeningSession(node, (rectangle, planPoint) =>
    resizeRectangleCorner(
      rectangle,
      vertexIndex % 4,
      snapPointToGrid([planPoint[0], planPoint[1]], getSegmentGridStep()),
    ),
  )
}, createPolygonVertexAffordance<FloorOpeningNode>('floor-opening'))
export const floorOpeningAddVertexAffordance = ownedOr(
  ({ node }) => inert(node),
  createPolygonAddVertexAffordance<FloorOpeningNode>('floor-opening'),
)
export const floorOpeningMoveEdgeAffordance = ownedOr(({ node, payload, initialPlanPoint }) => {
  const { edgeIndex } = payload as { edgeIndex: number }
  return ownedOpeningSession(node, (rectangle, planPoint) => {
    const start = rectangle[edgeIndex % 4]!
    const end = rectangle[(edgeIndex + 1) % 4]!
    const opposite = rectangle[(edgeIndex + 2) % 4]!
    const length = Math.hypot(end[0] - start[0], end[1] - start[1]) || 1
    let normal: [number, number] = [-(end[1] - start[1]) / length, (end[0] - start[0]) / length]
    if ((opposite[0] - start[0]) * normal[0] + (opposite[1] - start[1]) * normal[1] > 0)
      normal = [-normal[0], -normal[1]]
    const distance = snapScalarToGrid(
      (planPoint[0] - initialPlanPoint[0]) * normal[0] +
        (planPoint[1] - initialPlanPoint[1]) * normal[1],
      getSegmentGridStep(),
    )
    return moveRectangleEdge(rectangle, edgeIndex % 4, distance)
  })
}, createPolygonMoveEdgeAffordance<FloorOpeningNode>('floor-opening'))
export const floorOpeningDeleteVertexAffordance = ownedOr(
  ({ node }) => inert(node),
  createPolygonDeleteVertexAffordance<FloorOpeningNode>('floor-opening'),
)
