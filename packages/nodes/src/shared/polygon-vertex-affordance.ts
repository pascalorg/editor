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
 * Four affordances available:
 *
 * - `move-vertex` — drag an existing vertex.
 * - `add-vertex` — insert a new vertex at an edge midpoint, then drag
 *   it (click-without-drag reverts to the snapshot).
 * - `move-edge` — drag a whole edge perpendicular to itself (both
 *   endpoints translate by `normal * projection`).
 * - `delete-vertex` — remove a double-clicked vertex while preserving
 *   the minimum three-vertex ring.
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
  /**
   * `move-vertex` / `add-vertex`: the ring as the drag found it (the new vertex inserted) and the
   * dragged vertex's index in it, so a resolver can square the vertex to its neighbours.
   */
  ring?: ReadonlyArray<readonly [number, number]>
  vertexIndex?: number
}

export type PolygonEdgeSnapContext<N extends PolygonShape & { id: AnyNodeId }> = {
  node: N
  nodes: Record<AnyNodeId, AnyNode>
  /** Candidate edge (after the perpendicular translation), in ring order. */
  edge: [[number, number], [number, number]]
  rawPoint: WallPlanPoint
  modifiers: FloorplanAffordanceModifiers
  holeIndex?: number
}

export type PolygonAffordanceOptions<N extends PolygonShape & { id: AnyNodeId }> = {
  /** Data committed only when the outer boundary (not a hole) is edited. */
  boundaryCommitData?: Partial<N>
  resolvePlanPoint?: (context: PolygonAffordanceSnapContext<N>) => WallPlanPoint
  /**
   * `move-edge` only: absolute edge snap. The point-based resolver runs
   * on the CURSOR, so any grab offset between the pointer and the edge
   * line gets baked into a point snap; an edge that must land exactly on
   * a target line (wall centerline) snaps here instead — return the
   * translated edge, or `null` to keep the candidate.
   */
  snapEdge?: (context: PolygonEdgeSnapContext<N>) => [[number, number], [number, number]] | null
  /**
   * `move-edge`: the sides beside the dragged one keep their own angle, running on to meet it
   * where it goes; a side in line with it (a side split in two) gets a square jog instead, so
   * pulling out part of a side makes a bump-out. Off, both ends of the side translate square to
   * it and its neighbours pivot on their far ends.
   */
  keepNeighbourAngles?: boolean
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
  boundaryCommitData?: object,
): unknown {
  if (holeIndex === undefined) {
    return { ...boundaryCommitData, polygon: nextRing }
  }
  const nextHoles = (node.holes ?? []).map((hole, i) =>
    i === holeIndex ? nextRing : hole.map(([x, y]) => [x, y] as [number, number]),
  )
  return { holes: nextHoles }
}

/**
 * Commit a ring edit. A BOUNDARY reshape is the sanctioned conversion of a
 * reconciler-owned slab or ceiling into an authored surface, so it goes
 * through `detachDerivedNode` (which also carries the kind's own
 * `boundaryCommitData`). A HOLE edit only touches authored cut-outs, so it
 * stays an ordinary update and leaves the derivation in place.
 */
function commitRingPatch(id: AnyNodeId, holeIndex: number | undefined, patch: unknown) {
  const scene = useScene.getState()
  if (holeIndex === undefined) scene.detachDerivedNode(id, patch as Partial<AnyNode>)
  else scene.updateNodes([{ id, data: patch as Partial<unknown> as never }])
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
            ring: originalRing,
            vertexIndex,
          })
          const nextRing: [number, number][] = originalRing.map((p, i) =>
            i === vertexIndex ? [snapped[0], snapped[1]] : p,
          )
          const patch = buildRingPatch(node, holeIndex, nextRing, options?.boundaryCommitData)
          commitRingPatch(node.id, holeIndex, patch)
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
      const initialPatch = buildRingPatch(node, holeIndex, initialRing, options?.boundaryCommitData)
      commitRingPatch(node.id, holeIndex, initialPatch)

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
            ring: initialRing,
            vertexIndex: newVertexIndex,
          })
          const nextRing: [number, number][] = initialRing.map((p, i) =>
            i === newVertexIndex ? [snapped[0], snapped[1]] : p,
          )
          const patch = buildRingPatch(node, holeIndex, nextRing, options?.boundaryCommitData)
          commitRingPatch(node.id, holeIndex, patch)
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

export function createPolygonDeleteVertexAffordance<N extends PolygonShape & { id: AnyNodeId }>(
  kind: string,
  options?: PolygonAffordanceOptions<N>,
): FloorplanAffordance<N> {
  return {
    start({ node, payload }): FloorplanAffordanceSession {
      const { vertexIndex, holeIndex } = payload as PolygonVertexPayload
      const canDeleteCurrentVertex = () => {
        const current = useScene.getState().nodes[node.id] as N | undefined
        if (!current || (current as unknown as { type: string }).type !== kind) return false
        const ring = getRing(current, holeIndex)
        return Boolean(
          ring &&
            ring.length > 3 &&
            Number.isInteger(vertexIndex) &&
            vertexIndex >= 0 &&
            vertexIndex < ring.length,
        )
      }

      return {
        affectedIds: [node.id],
        apply() {},
        canCommit: canDeleteCurrentVertex,
        commit() {
          const current = useScene.getState().nodes[node.id] as N | undefined
          if (!current || (current as unknown as { type: string }).type !== kind) return
          const ring = getRing(current, holeIndex)
          if (
            !ring ||
            ring.length <= 3 ||
            !Number.isInteger(vertexIndex) ||
            vertexIndex < 0 ||
            vertexIndex >= ring.length
          ) {
            return
          }
          const nextRing = ring.filter((_, index) => index !== vertexIndex)
          const patch = buildRingPatch(current, holeIndex, nextRing, options?.boundaryCommitData)
          commitRingPatch(node.id, holeIndex, patch)
        },
      }
    },
  }
}

/** A neighbouring side within this sine of the dragged one's line is in line with it (a split side). */
const IN_LINE_SINE = 0.05

/**
 * `ring` with edge `edgeIndex` moved `distance` along `normal`, its neighbours keeping their angles
 * (`keepNeighbourAngles`): each end goes where the neighbouring side's line meets the moved edge's,
 * and a neighbour in line with the edge keeps its vertex, a square jog joining it to the moved end.
 */
export function movedEdgeKeepingNeighbours(
  ring: ReadonlyArray<readonly [number, number]>,
  edgeIndex: number,
  normal: readonly [number, number],
  distance: number,
): [number, number][] {
  const copy = ring.map(([x, y]) => [x, y] as [number, number])
  const count = ring.length
  // Under a millimetre the side has not moved: no jog a hair long.
  if (count < 3 || Math.abs(distance) < 1e-3) return copy
  const startIndex = edgeIndex
  const endIndex = (edgeIndex + 1) % count
  const start = ring[startIndex]!
  const end = ring[endIndex]!
  const moved = (p: readonly [number, number]): [number, number] => [
    p[0] + normal[0] * distance,
    p[1] + normal[1] * distance,
  ]
  /** Where the side from `neighbour` to `vertex` meets the moved edge; `null` in line with it. */
  const meet = (vertex: readonly [number, number], neighbour: readonly [number, number]) => {
    const dx = vertex[0] - neighbour[0]
    const dy = vertex[1] - neighbour[1]
    const length = Math.hypot(dx, dy)
    if (length < 1e-9) return null
    const along = (dx * normal[0] + dy * normal[1]) / length
    if (Math.abs(along) < IN_LINE_SINE) return null
    const target = moved(start)
    const t =
      ((target[0] - neighbour[0]) * normal[0] + (target[1] - neighbour[1]) * normal[1]) /
      (along * length)
    return [neighbour[0] + dx * t, neighbour[1] + dy * t] as [number, number]
  }
  const startMeet = meet(start, ring[(startIndex - 1 + count) % count]!)
  const endMeet = meet(end, ring[(endIndex + 1) % count]!)
  const startPoints: [number, number][] = startMeet
    ? [startMeet]
    : [[start[0], start[1]], moved(start)]
  const endPoints: [number, number][] = endMeet ? [endMeet] : [moved(end), [end[0], end[1]]]
  const out: [number, number][] = []
  for (let i = 0; i < count; i++) {
    if (i === startIndex) out.push(...startPoints)
    else if (i === endIndex) out.push(...endPoints)
    else out.push(copy[i]!)
  }
  return out
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
          let normalDistance =
            (snappedPoint[0] - startX) * normalX + (snappedPoint[1] - startY) * normalY
          if (options?.snapEdge) {
            const candidate: [[number, number], [number, number]] = [
              [
                startVertex[0] + normalX * normalDistance,
                startVertex[1] + normalY * normalDistance,
              ],
              [endVertex[0] + normalX * normalDistance, endVertex[1] + normalY * normalDistance],
            ]
            const snappedEdge = options.snapEdge({
              node,
              nodes,
              edge: candidate,
              rawPoint,
              modifiers,
              holeIndex,
            })
            if (snappedEdge) {
              // Measure the final travel from the ORIGINAL edge so the
              // stored edge lands exactly on the snapped line — grab
              // offset and pointer position drop out entirely.
              normalDistance =
                (snappedEdge[0][0] - startVertex[0]) * normalX +
                (snappedEdge[0][1] - startVertex[1]) * normalY
            }
          }
          const nextRing: [number, number][] = options?.keepNeighbourAngles
            ? movedEdgeKeepingNeighbours(
                originalRing,
                edgeIndex,
                [normalX, normalY],
                normalDistance,
              )
            : originalRing.map((p, i) => {
                if (i === edgeStartIndex || i === edgeEndIndex) {
                  return [p[0] + normalX * normalDistance, p[1] + normalY * normalDistance]
                }
                return [p[0], p[1]] as [number, number]
              })
          const patch = buildRingPatch(node, holeIndex, nextRing, options?.boundaryCommitData)
          commitRingPatch(node.id, holeIndex, patch)
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
