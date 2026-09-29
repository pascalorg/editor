import {
  containsPoint,
  createZoneDivisionContext,
  DEFAULT_ANGLE_STEP,
  divideZone,
  generateId,
  type Point,
  type StructureNodes,
  type StructurePlan,
  snapPointAlongAngleRay,
  snapPointToGrid,
  snapZoneBoundary,
  useScene,
  type ZoneDivisionContext,
} from '@pascal-app/core'
import useEditor, {
  isAngleSnapActive,
  isGridSnapActive,
  isMagneticSnapActive,
} from '../store/use-editor'
import useInteractionScope from '../store/use-interaction-scope'
import useWallSnapIndicator from '../store/use-wall-snap-indicator'
import { beginGesture, type GestureHandle } from './gesture-lifecycle'
import { applyRoomPlan } from './room-structure-commands'
import { sfxEmitter } from './sfx-bus'

let cached: {
  nodes: StructureNodes
  zoneId: string
  revision: string
  context: ZoneDivisionContext
} | null = null

// Everything the division context is built from: the room's own outline and
// every wall / separator on its level. Intent edits (a name, a finish) leave it
// alone; any boundary move changes it.
function topologyRevision(
  nodes: StructureNodes,
  zone: Extract<StructureNodes[string], { type: 'zone' }>,
) {
  return JSON.stringify([
    zone.parentId,
    zone.polygon,
    zone.holes,
    Object.values(nodes).flatMap((node) =>
      node.parentId === zone.parentId && (node.type === 'wall' || node.type === 'separator')
        ? [
            [
              node.id,
              node.type,
              node.start,
              node.end,
              node.type === 'wall' ? [node.curveOffset, node.thickness, node.justification] : null,
            ],
          ]
        : [],
    ),
  ])
}

export function roomDivideContext(nodes: StructureNodes, zoneId: string) {
  if (cached?.nodes === nodes && cached.zoneId === zoneId) return cached.context
  const zone = nodes[zoneId]
  if (zone?.type !== 'zone') throw Error('The selected room no longer exists.')
  const revision = topologyRevision(nodes, zone)
  const context =
    cached?.zoneId === zoneId && cached.revision === revision
      ? cached.context
      : createZoneDivisionContext(nodes, zoneId)
  cached = { nodes, zoneId, revision, context }
  return context
}

// The topology the active session started on. Points, boundary ids and
// validity all refer to it, so the draft cannot outlive it.
let sessionRevision: string | null = null

/** Whether the room being divided is gone or its boundaries changed since the draft began. */
export function roomDivideTopologyChanged(nodes: StructureNodes) {
  const scope = useInteractionScope.getState().scope
  if (scope.kind !== 'room-divide') return false
  const zone = nodes[scope.nodeId]
  return zone?.type !== 'zone' || topologyRevision(nodes, zone) !== sessionRevision
}

// Short cursor-side wording, the way the wall tool labels a draft it cannot
// build. Keyed by the planner's conflict codes; anything else is generic.
const DIVIDE_MESSAGES: Record<string, string> = {
  'snap-distance': 'Move to an edge',
  'boundary-overlap': 'Already an edge',
  'short-cut': 'Too short',
  'outside-room': 'Leaves the room',
  'open-room': 'Room is open',
  'self-cross': 'Crosses itself',
  'self-intersection': 'Crosses itself',
  'small-island': 'Too small',
  'wall-clearance': 'Too close to a wall',
  'close-loop': 'Close the loop',
}
export function roomDivideMessage(code?: string) {
  return (code && DIVIDE_MESSAGES[code]) || "Can't divide here"
}

// A floor pointer this close to the boundary lands on it; a boundary surface
// hit (a wall face in 3D) always does. Past it the point is free, so a path can
// turn inside the room and an island can start there.
const EDGE_CAPTURE = 0.5
// A pointer this close to an island's first point closes the loop.
const CLOSE_CAPTURE = 0.3
// `lines` squares a segment to the edge / aligns a point with earlier points
// within this much.
const LINES_TOLERANCE = 0.15
const MIN_SEGMENT = 0.05

type DivideScope = Extract<
  ReturnType<typeof useInteractionScope.getState>['scope'],
  { kind: 'room-divide' }
>

/** Plans a divide along `path`: an open cut between two boundary points, or a closed island. */
function planRoomDivide(
  nodes: StructureNodes,
  zoneId: string,
  input: { path: Point[]; closed: boolean; startBoundaryId?: string; endBoundaryId?: string },
  context: ZoneDivisionContext,
  mintId: Parameters<typeof divideZone>[1]['mintId'],
): StructurePlan {
  return divideZone(nodes, { zoneId, ...input, mintId }, context)
}

// Previews mint throwaway ids — distinct ones, since a path mints one per segment.
function previewMint() {
  let n = 0
  return (kind: string) => `${kind}_preview_${n++}`
}

const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1])

// Proper crossing only: touching at an endpoint is not a crossing.
function segmentsCross(a: Point, b: Point, c: Point, d: Point) {
  const cross = (o: Point, p: Point, q: Point) =>
    (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0])
  const d1 = cross(c, d, a),
    d2 = cross(c, d, b),
    d3 = cross(a, b, c),
    d4 = cross(a, b, d)
  const eps = 1e-9
  return (
    ((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) &&
    ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps))
  )
}

type Face = NonNullable<ZoneDivisionContext['face']>
const rings = (face: Face) => [face.referencePolygon, ...face.holes]
const inside = (face: Face, point: Point) =>
  containsPoint([{ outer: face.referencePolygon, holes: face.holes }], point)

/** Why the segment `from → to` cannot join the path, or null when it can. */
function segmentConflict(face: Face, points: Point[], from: Point, to: Point) {
  if (distance(from, to) < MIN_SEGMENT) return 'short-cut'
  for (const ring of rings(face))
    for (let i = 0; i < ring.length; i++)
      if (segmentsCross(from, to, ring[i]!, ring[(i + 1) % ring.length]!)) return 'outside-room'
  if (!inside(face, [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2])) return 'outside-room'
  // Earlier segments, skipping the one sharing `from`.
  for (let i = 0; i < points.length - 2; i++)
    if (segmentsCross(from, to, points[i]!, points[i + 1]!)) return 'self-cross'
  return null
}

/** Aligns a free point with the x or z of an earlier point (`lines`). */
function alignToPoints(point: Point, points: Point[]): Point {
  let [x, z] = point
  let bestX = LINES_TOLERANCE,
    bestZ = LINES_TOLERANCE
  for (const other of points) {
    if (Math.abs(other[0] - point[0]) < bestX) {
      bestX = Math.abs(other[0] - point[0])
      x = other[0]
    }
    if (Math.abs(other[1] - point[1]) < bestZ) {
      bestZ = Math.abs(other[1] - point[1])
      z = other[1]
    }
  }
  return [x, z]
}

/**
 * The wall tool's snap beacon where the live point locks on: the first point
 * (closing an island) as a corner, a boundary (starting or finishing a cut)
 * as a point on that wall. Cleared anywhere else.
 */
function publishDivideSnap(
  end: Point | null,
  endKind?: DivideScope['endKind'],
  endBoundaryId?: string,
) {
  const indicator = useWallSnapIndicator.getState()
  if (end && endKind === 'close') indicator.set({ x: end[0], z: end[1], kind: 'endpoint' })
  else if (end && endBoundaryId && (endKind === 'edge' || endKind === 'start'))
    indicator.set({ x: end[0], z: end[1], kind: 'wall', wallIds: [endBoundaryId] })
  else if (indicator.point) indicator.clear()
}

function invalidPreview(code?: string, end: Point | null = null) {
  publishDivideSnap(null)
  useInteractionScope.getState().update({
    kind: 'room-divide',
    end,
    endKind: undefined,
    endBoundaryId: undefined,
    valid: false,
    message: roomDivideMessage(code),
  })
}

let lastPointer: { point: Point; boundaryId?: string } | null = null

// The last planner verdict. Snapping lands many pointer moves on the same
// candidate, and the planner is the expensive step, so an identical candidate
// on the same context reuses it.
let planMemo: { context: ZoneDivisionContext; key: string; conflict?: string } | null = null

function previewConflict(
  nodes: StructureNodes,
  zoneId: string,
  input: Parameters<typeof planRoomDivide>[2],
  context: ZoneDivisionContext,
) {
  const key = JSON.stringify(input)
  if (planMemo?.context === context && planMemo.key === key) return planMemo.conflict
  const conflict = planRoomDivide(nodes, zoneId, input, context, previewMint()).conflicts?.[0]?.code
  planMemo = { context, key, conflict }
  return conflict
}

let owner: GestureHandle | null = null

function resetSession() {
  cached = null
  lastPointer = null
  planMemo = null
  sessionRevision = null
  publishDivideSnap(null)
}

/**
 * Starts the draft under the gesture lifecycle owner: a mode, tool, level or
 * selection change, the scope replaced, the room's boundary changing under it
 * (undo, another tool) or its room deselected, and any history command end it.
 */
export function startRoomDivide(zoneId: string, levelId: string) {
  owner?.cancel()
  resetSession()
  const nodes: StructureNodes = useScene.getState().nodes
  const zone = nodes[zoneId]
  sessionRevision = zone?.type === 'zone' ? topologyRevision(nodes, zone) : null
  const handle = beginGesture({
    kind: 'room-divide',
    scope: { kind: 'room-divide', nodeId: zoneId, levelId, points: [], end: null, valid: false },
    stale: () =>
      useEditor.getState().room?.zoneId !== zoneId ||
      roomDivideTopologyChanged(useScene.getState().nodes),
    onCancel: () => {
      if (owner === handle) owner = null
      resetSession()
    },
  })
  owner = handle
}

/** Ends the draft (committed or dropped). Idempotent. */
export function cancelRoomDivide() {
  const current = owner
  owner = null
  resetSession()
  if (current?.active) current.cancel()
  else useInteractionScope.getState().endIf((scope) => scope.kind === 'room-divide')
}
/** Whether a plan point lies inside the room being divided (off its boundary). */
export function roomDivideContains(point: Point) {
  const scope = useInteractionScope.getState().scope
  if (scope.kind !== 'room-divide') return false
  try {
    const face = roomDivideContext(useScene.getState().nodes, scope.nodeId).face
    return !!face && inside(face, point)
  } catch {
    return false
  }
}

/**
 * Moves the live point. The first point snaps onto the room's boundary (or,
 * away from it, starts an island inside the room); later points are free,
 * placed by the active snapping mode — the wall tool's modes, cycled with
 * Shift — until the pointer reaches the boundary again (finishing the cut) or
 * an island's first point (closing the loop).
 */
export function previewRoomDivide(point: Point, boundaryId?: string) {
  const scope = useInteractionScope.getState().scope
  if (scope.kind !== 'room-divide') return
  lastPointer = { point, boundaryId }
  const hover: Point | null = point.every(Number.isFinite) ? point : null
  try {
    const nodes = useScene.getState().nodes
    const context = roomDivideContext(nodes, scope.nodeId)
    const face = context.face
    if (!face) return invalidPreview('open-room', hover)
    const { points, startBoundaryId } = scope
    const from = points.at(-1) ?? null
    const step = isGridSnapActive() ? useEditor.getState().gridSnapStep : 0

    const first = points[0]
    const island = !!first && points.length >= 3 && !startBoundaryId
    const close = () => {
      const conflict = previewConflict(nodes, scope.nodeId, { path: points, closed: true }, context)
      return update(scope, first!, 'close', undefined, conflict)
    }
    if (island && distance(point, first!) <= CLOSE_CAPTURE) return close()

    const destination = snapZoneBoundary(nodes, scope.nodeId, point, step, context, boundaryId)
    if (destination && (boundaryId || destination.distance <= EDGE_CAPTURE)) {
      if (!from) return update(scope, destination.point, 'start', destination.boundaryId)
      if (!startBoundaryId) return invalidPreview('close-loop', destination.point)
      const target = lockToEdge(nodes, scope, context, destination, from) ?? destination.point
      const path = [...points, target]
      const conflict = previewConflict(
        nodes,
        scope.nodeId,
        { path, closed: false, startBoundaryId, endBoundaryId: destination.boundaryId },
        context,
      )
      return update(scope, target, 'edge', destination.boundaryId, conflict)
    }

    let target = point
    if (from && isAngleSnapActive())
      target = snapPointAlongAngleRay(from, point, DEFAULT_ANGLE_STEP) as Point
    else if (step > 0) target = snapPointToGrid(point, step) as Point
    else if (isMagneticSnapActive()) target = alignToPoints(point, points)
    // The snapping mode can land the point on the island's start by itself.
    if (island && distance(target, first!) < 1e-6) return close()
    if (!inside(face, target)) return invalidPreview(from ? 'outside-room' : 'snap-distance', hover)
    const conflict = from ? segmentConflict(face, points, from, target) : null
    return update(scope, target, from ? 'point' : 'start', undefined, conflict ?? undefined)
  } catch {
    invalidPreview(undefined, hover)
  }
}

function update(
  scope: DivideScope,
  end: Point,
  endKind: NonNullable<DivideScope['endKind']>,
  endBoundaryId?: string,
  conflict?: string | null,
) {
  const valid = !conflict
  const message = conflict ? roomDivideMessage(conflict) : undefined
  publishDivideSnap(end, endKind, endBoundaryId)
  const moved = scope.end?.[0] !== end[0] || scope.end?.[1] !== end[1]
  // Unchanged preview: skip the store write and every overlay re-render.
  if (
    !moved &&
    scope.endKind === endKind &&
    scope.endBoundaryId === endBoundaryId &&
    scope.valid === valid &&
    scope.message === message
  )
    return
  // The wall draft's tick: the live point stepped to a new snapped spot.
  if (moved && scope.points.length) sfxEmitter.emit('sfx:grid-snap')
  useInteractionScope.getState().update({
    kind: 'room-divide',
    end,
    endKind,
    endBoundaryId,
    valid,
    message,
  })
}

/**
 * Where the last segment meets the boundary under the snapping mode: `lines`
 * squares it to the edge (to the start edge for a straight cut), `angles`
 * locks it to 15° rays from the previous point. Null keeps the pointer's own
 * boundary point.
 */
function lockToEdge(
  nodes: StructureNodes,
  scope: DivideScope,
  context: ZoneDivisionContext,
  destination: NonNullable<ReturnType<typeof snapZoneBoundary>>,
  from: Point,
): Point | null {
  // Where the ray from `from` along `direction` crosses the boundary the
  // pointer is on — kept only if it really lands on that boundary.
  const lock = (direction: Point): Point | null => {
    const along = destination.direction
    const denominator = direction[0] * along[1] - direction[1] * along[0]
    if (Math.abs(denominator) < 1e-8) return null
    const reach =
      ((destination.point[0] - from[0]) * along[1] - (destination.point[1] - from[1]) * along[0]) /
      denominator
    if (reach <= 0) return null
    const crossing: Point = [from[0] + direction[0] * reach, from[1] + direction[1] * reach]
    const snapped = snapZoneBoundary(nodes, scope.nodeId, crossing, 0, context)
    return snapped && snapped.boundaryId === destination.boundaryId && snapped.distance < 1e-6
      ? snapped.point
      : null
  }
  const target = destination.point
  if (isMagneticSnapActive()) {
    const straight = scope.points.length === 1
    const anchor = straight ? snapZoneBoundary(nodes, scope.nodeId, from, 0, context) : destination
    if (!anchor) return null
    const tangent = anchor.direction
    const offset = (target[0] - from[0]) * tangent[0] + (target[1] - from[1]) * tangent[1]
    if (Math.abs(offset) > LINES_TOLERANCE) return null
    const normal: Point = [-tangent[1], tangent[0]]
    const side = (target[0] - from[0]) * normal[0] + (target[1] - from[1]) * normal[1] < 0 ? -1 : 1
    return lock([normal[0] * side, normal[1] * side])
  }
  if (isAngleSnapActive()) {
    const angle = Math.atan2(target[1] - from[1], target[0] - from[0])
    const locked = Math.round(angle / DEFAULT_ANGLE_STEP) * DEFAULT_ANGLE_STEP
    return lock([Math.cos(locked), Math.sin(locked)])
  }
  return null
}

function commit(scope: DivideScope, context: ZoneDivisionContext) {
  const closed = scope.endKind === 'close'
  const path = closed ? scope.points : [...scope.points, scope.end!]
  const plan = planRoomDivide(
    useScene.getState().nodes,
    scope.nodeId,
    {
      path,
      closed,
      startBoundaryId: scope.startBoundaryId,
      endBoundaryId: closed ? undefined : scope.endBoundaryId,
    },
    context,
    generateId,
  )
  if (plan.conflicts?.length) {
    invalidPreview(plan.conflicts[0]?.code, scope.end)
    return false
  }
  // Out of the lifecycle before the write: the boundary it changes must not read as stale.
  const current = owner
  owner = null
  try {
    if (current) current.finish(() => applyRoomPlan(plan))
    else applyRoomPlan(plan)
  } finally {
    resetSession()
    useInteractionScope.getState().endIf((live) => live.kind === 'room-divide')
  }
  sfxEmitter.emit('sfx:structure-build')
  return true
}

/**
 * Places the live point: starts the path, adds a point, or — on the boundary
 * or an island's first point — commits the division. True once committed.
 */
export function clickRoomDivide() {
  const scope = useInteractionScope.getState().scope
  if (scope.kind !== 'room-divide' || !scope.end || !scope.valid) return false
  try {
    const context = roomDivideContext(useScene.getState().nodes, scope.nodeId)
    if (!context.face) {
      invalidPreview('open-room')
      return false
    }
    if (scope.endKind === 'edge' || scope.endKind === 'close') return commit(scope, context)
    if (!scope.points.length) sfxEmitter.emit('sfx:structure-build-start')
    useInteractionScope.getState().update({
      kind: 'room-divide',
      points: [...scope.points, scope.end],
      startBoundaryId: scope.points.length ? scope.startBoundaryId : scope.endBoundaryId,
      end: null,
      endKind: undefined,
      endBoundaryId: undefined,
      valid: false,
      message: undefined,
    })
    return false
  } catch {
    invalidPreview()
    return false
  }
}

/** Backspace: drops the last placed point and re-reads the pointer. */
export function removeLastRoomDividePoint() {
  const scope = useInteractionScope.getState().scope
  if (scope.kind !== 'room-divide' || !scope.points.length) return false
  const points = scope.points.slice(0, -1)
  useInteractionScope.getState().update({
    kind: 'room-divide',
    points,
    startBoundaryId: points.length ? scope.startBoundaryId : undefined,
    end: null,
    endKind: undefined,
    endBoundaryId: undefined,
    valid: false,
    message: undefined,
  })
  if (lastPointer) previewRoomDivide(lastPointer.point, lastPointer.boundaryId)
  return true
}

/** Enter: commits an open path whose live point sits on the boundary. */
export function finishRoomDivide() {
  const scope = useInteractionScope.getState().scope
  if (scope.kind !== 'room-divide' || scope.endKind !== 'edge' || !scope.valid) return false
  return clickRoomDivide()
}
