import {
  type AnyNode,
  type AnyNodeId,
  type FloorplanAffordance,
  type FloorplanAffordanceModifiers,
  type FloorplanAffordanceSession,
  useScene,
} from '@pascal-app/core'
import {
  getSegmentGridStep,
  snapPointToGrid,
  snapScalarToGrid,
  type WallPlanPoint,
} from '@pascal-app/editor'

/**
 * Shared "edit polygon" floor-plan affordances. Used by kinds whose
 * primary editable shape is a `polygon: [number, number][]` field
 * (slab, ceiling, site, zone) with optional `holes: [number, number][][]`.
 *
 * Each affordance accepts an optional `holeIndex` in its payload — when
 * present, the operation targets `node.holes[holeIndex]`; otherwise it
 * targets the outer `node.polygon`. The same factory wires both
 * boundary and hole interactions without duplicating the math.
 *
 * Three affordances available:
 *
 * - `move-vertex` — drag an existing vertex.
 * - `add-vertex` — insert a new vertex at an edge midpoint, then drag
 *   it (click-without-drag reverts to the snapshot).
 * - `move-edge` — drag a whole edge perpendicular to itself (both
 *   endpoints translate by `normal * projection`).
 */

export type PolygonVertexPayload = {
  /** Target a hole's polygon instead of the boundary. */
  holeIndex?: number
  vertexIndex: number
}

export type AddVertexPayload = {
  holeIndex?: number
  edgeIndex: number
}

export type EdgeDragPayload = {
  holeIndex?: number
  edgeIndex: number
}

type PolygonAffordanceMode = 'move-vertex' | 'add-vertex' | 'move-edge'

export type PolygonAffordanceSnapContext<N extends PolygonShape & { id: AnyNodeId }> = {
  node: N
  nodes: Record<AnyNodeId, AnyNode>
  rawPoint: WallPlanPoint
  fallbackPoint: WallPlanPoint
  modifiers: FloorplanAffordanceModifiers
  holeIndex?: number
  mode: PolygonAffordanceMode
}

type PolygonAffordanceOptions<N extends PolygonShape & { id: AnyNodeId }> = {
  resolvePlanPoint?: (context: PolygonAffordanceSnapContext<N>) => WallPlanPoint
}

type PolygonShape = {
  polygon: ReadonlyArray<readonly [number, number]>
  holes?: ReadonlyArray<ReadonlyArray<readonly [number, number]>>
}

function getRing(node: PolygonShape, holeIndex: number | undefined): [number, number][] | null {
  if (holeIndex === undefined) {
    return node.polygon.map(([x, y]) => [x, y] as [number, number])
  }
  const hole = node.holes?.[holeIndex]
  if (!hole) return null
  return hole.map(([x, y]) => [x, y] as [number, number])
}

/**
 * Returns a patch object that, when applied to the node, updates the
 * targeted ring (boundary polygon or specific hole) to `nextRing`. The
 * cast through `unknown → Partial<unknown> → never` satisfies the
 * generic `updateNodes` patch type without forcing every variant of
 * the kind union into scope here.
 */
function buildRingPatch(
  node: PolygonShape,
  holeIndex: number | undefined,
  nextRing: ReadonlyArray<[number, number]>,
): unknown {
  if (holeIndex === undefined) {
    return { polygon: nextRing }
  }
  const nextHoles = (node.holes ?? []).map((hole, i) =>
    i === holeIndex ? nextRing : hole.map(([x, y]) => [x, y] as [number, number]),
  )
  return { holes: nextHoles }
}

function resolveAffordancePlanPoint<N extends PolygonShape & { id: AnyNodeId }>(
  options: PolygonAffordanceOptions<N> | undefined,
  context: PolygonAffordanceSnapContext<N>,
): WallPlanPoint {
  return options?.resolvePlanPoint?.(context) ?? context.fallbackPoint
}

export function createPolygonVertexAffordance<N extends PolygonShape & { id: AnyNodeId }>(
  kind: string,
  options?: PolygonAffordanceOptions<N>,
): FloorplanAffordance<N> {
  return {
    start({ node, payload, nodes }): FloorplanAffordanceSession {
      const { vertexIndex, holeIndex } = payload as PolygonVertexPayload
      const originalRing = getRing(node, holeIndex)
      if (!originalRing) {
        return {
          affectedIds: [node.id],
          apply() {},
          canCommit() {
            return false
          },
        }
      }

      return {
        affectedIds: [node.id],
        apply({ planPoint, modifiers }) {
          const rawPoint: WallPlanPoint = [planPoint[0], planPoint[1]]
          // Mode-driven grid snap (matches the chip): `getSegmentGridStep()` is
          // 0 in any non-`grid` mode, so `lines` / `off` pass the raw point
          // through (the resolver's wall-snap/alignment handles `lines`); `grid`
          // quantizes to the live grid step. No Shift hold-to-bypass.
          const fallbackPoint = snapPointToGrid(rawPoint, getSegmentGridStep())
          const snapped = resolveAffordancePlanPoint(options, {
            node,
            nodes,
            rawPoint,
            fallbackPoint,
            modifiers,
            holeIndex,
            mode: 'move-vertex',
          })
          const nextRing: [number, number][] = originalRing.map((p, i) =>
            i === vertexIndex ? [snapped[0], snapped[1]] : p,
          )
          const patch = buildRingPatch(node, holeIndex, nextRing)
          useScene
            .getState()
            .updateNodes([{ id: node.id, data: patch as Partial<unknown> as never }])
        },
        canCommit() {
          const final = useScene.getState().nodes[node.id] as N | undefined
          if (!final || (final as unknown as { type: string }).type !== kind) return false
          const finalRing = holeIndex === undefined ? final.polygon : (final.holes ?? [])[holeIndex]
          return !!finalRing && finalRing.length >= 3
        },
      }
    },
  }
}

/**
 * Companion to `createPolygonVertexAffordance`. Inserts a new vertex at
 * the midpoint of edge `edgeIndex` (between vertices i and i+1) and
 * then drags that new vertex with the pointer. The dispatcher's
 * snapshot was taken **before** `start()` ran, so a pointer-up without
 * movement reverts to the pre-insert ring — "click without drag" is a
 * no-op, matching the legacy slab boundary editor.
 */
export function createPolygonAddVertexAffordance<N extends PolygonShape & { id: AnyNodeId }>(
  kind: string,
  options?: PolygonAffordanceOptions<N>,
): FloorplanAffordance<N> {
  return {
    start({ node, payload, nodes }): FloorplanAffordanceSession {
      const { edgeIndex, holeIndex } = payload as AddVertexPayload
      const originalRing = getRing(node, holeIndex)
      if (!originalRing) {
        return {
          affectedIds: [node.id],
          apply() {},
          canCommit() {
            return false
          },
        }
      }
      const a = originalRing[edgeIndex]
      const b = originalRing[(edgeIndex + 1) % originalRing.length]
      if (!a || !b) {
        return {
          affectedIds: [node.id],
          apply() {},
          canCommit() {
            return false
          },
        }
      }
      const midpoint: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
      const newVertexIndex = edgeIndex + 1
      const initialRing: [number, number][] = [
        ...originalRing.slice(0, newVertexIndex),
        midpoint,
        ...originalRing.slice(newVertexIndex),
      ]

      // Apply the insert immediately so the user sees the new vertex
      // before they even move.
      const initialPatch = buildRingPatch(node, holeIndex, initialRing)
      useScene
        .getState()
        .updateNodes([{ id: node.id, data: initialPatch as Partial<unknown> as never }])

      return {
        affectedIds: [node.id],
        apply({ planPoint, modifiers }) {
          const rawPoint: WallPlanPoint = [planPoint[0], planPoint[1]]
          // Mode-driven grid snap (matches the chip): `getSegmentGridStep()` is
          // 0 in any non-`grid` mode, so `lines` / `off` pass the raw point
          // through (the resolver's wall-snap/alignment handles `lines`); `grid`
          // quantizes to the live grid step. No Shift hold-to-bypass.
          const fallbackPoint = snapPointToGrid(rawPoint, getSegmentGridStep())
          const snapped = resolveAffordancePlanPoint(options, {
            node,
            nodes,
            rawPoint,
            fallbackPoint,
            modifiers,
            holeIndex,
            mode: 'add-vertex',
          })
          const nextRing: [number, number][] = initialRing.map((p, i) =>
            i === newVertexIndex ? [snapped[0], snapped[1]] : p,
          )
          const patch = buildRingPatch(node, holeIndex, nextRing)
          useScene
            .getState()
            .updateNodes([{ id: node.id, data: patch as Partial<unknown> as never }])
        },
        canCommit() {
          const final = useScene.getState().nodes[node.id] as N | undefined
          if (!final || (final as unknown as { type: string }).type !== kind) return false
          const finalRing = holeIndex === undefined ? final.polygon : (final.holes ?? [])[holeIndex]
          return !!finalRing && finalRing.length >= 3
        },
      }
    },
  }
}

/**
 * Edge-drag: move a whole edge perpendicular to itself. Both endpoints
 * translate by `edgeNormal * projectedDelta`. The other vertices of
 * the ring stay put — adjacent edges effectively pivot around their
 * far endpoints.
 *
 * Snap is grid-aligned on the projected scalar (so a Shift-free drag
 * lands on grid lines along the edge normal).
 */
export function createPolygonMoveEdgeAffordance<N extends PolygonShape & { id: AnyNodeId }>(
  kind: string,
  options?: PolygonAffordanceOptions<N>,
): FloorplanAffordance<N> {
  return {
    start({ node, payload, initialPlanPoint, nodes }): FloorplanAffordanceSession {
      const { edgeIndex, holeIndex } = payload as EdgeDragPayload
      const originalRing = getRing(node, holeIndex)
      if (!originalRing) {
        return {
          affectedIds: [node.id],
          apply() {},
          canCommit() {
            return false
          },
        }
      }
      const startVertex = originalRing[edgeIndex]
      const endVertex = originalRing[(edgeIndex + 1) % originalRing.length]
      if (!startVertex || !endVertex) {
        return {
          affectedIds: [node.id],
          apply() {},
          canCommit() {
            return false
          },
        }
      }
      const dx = endVertex[0] - startVertex[0]
      const dy = endVertex[1] - startVertex[1]
      const len = Math.hypot(dx, dy)
      if (len < 1e-6) {
        return {
          affectedIds: [node.id],
          apply() {},
          canCommit() {
            return false
          },
        }
      }
      // Perpendicular unit normal (rotate 90° CCW).
      const normalX = -dy / len
      const normalY = dx / len
      const startX = initialPlanPoint[0]
      const startY = initialPlanPoint[1]
      const edgeStartIndex = edgeIndex
      const edgeEndIndex = (edgeIndex + 1) % originalRing.length

      return {
        affectedIds: [node.id],
        apply({ planPoint, modifiers }) {
          // Project the pointer delta onto the edge normal — that's the
          // signed perpendicular distance the edge should travel.
          const rawPoint: WallPlanPoint = [planPoint[0], planPoint[1]]
          const deltaX = rawPoint[0] - startX
          const deltaY = rawPoint[1] - startY
          // Mode-driven snap of the perpendicular distance (matches the chip):
          // `getSegmentGridStep()` is 0 in non-`grid` modes, so `snapScalarToGrid`
          // passes the raw projection through; `grid` quantizes to the live step.
          const projection = snapScalarToGrid(
            deltaX * normalX + deltaY * normalY,
            getSegmentGridStep(),
          )
          const fallbackPoint: WallPlanPoint = [
            startX + normalX * projection,
            startY + normalY * projection,
          ]
          const snappedPoint = resolveAffordancePlanPoint(options, {
            node,
            nodes,
            rawPoint,
            fallbackPoint,
            modifiers,
            holeIndex,
            mode: 'move-edge',
          })
          const normalDistance =
            (snappedPoint[0] - startX) * normalX + (snappedPoint[1] - startY) * normalY
          const nextRing: [number, number][] = originalRing.map((p, i) => {
            if (i === edgeStartIndex || i === edgeEndIndex) {
              return [p[0] + normalX * normalDistance, p[1] + normalY * normalDistance]
            }
            return [p[0], p[1]] as [number, number]
          })
          const patch = buildRingPatch(node, holeIndex, nextRing)
          useScene
            .getState()
            .updateNodes([{ id: node.id, data: patch as Partial<unknown> as never }])
        },
        canCommit() {
          const final = useScene.getState().nodes[node.id] as N | undefined
          if (!final || (final as unknown as { type: string }).type !== kind) return false
          const finalRing = holeIndex === undefined ? final.polygon : (final.holes ?? [])[holeIndex]
          return !!finalRing && finalRing.length >= 3
        },
      }
    },
  }
}
