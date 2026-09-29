import {
  type AnyNode,
  type AnyNodeId,
  floorStepRole,
  generateSceneMaterialId,
  getWallLevelZones,
  getWallLocalFaceZ,
  getWallZoneSpans,
  type ItemNode,
  type MaterialSchema,
  nodeRegistry,
  parseFloorStepRole,
  parseRoomFinishRole,
  pointInPolygon2D,
  resolveLevelId,
  type SceneMaterial,
  type SceneMaterialId,
  type SlabNode,
  type Space,
  slotLabelFromId,
  toSceneMaterialRef,
  useScene,
  type WallNode,
  wallRoomFinishRole,
} from '@pascal-app/core'

/**
 * Painter application scope — how far one paint click spreads. The scope set is
 * DERIVED from the hovered node, not a per-kind table: any slot-model node with
 * more than one slot offers `object` (whole node); a node with an `asset` offers
 * `matching` (every instance of that asset); a kind that declares
 * `capabilities.paint.roomScope` offers `room`. One global mode (not per-tool),
 * defaulting to the narrowest `'single'`; the active interaction's HUD shows +
 * cycles it within the hovered node's set.
 */
export type PaintScope = 'single' | 'object' | 'matching' | 'room'

/** What the paint HUD needs to render + cycle the scope chip for a hover. */
export type PaintHoverInfo = {
  /** The scopes available for the hovered node, in cycle order (always ≥ 1). */
  scopes: PaintScope[]
  /** Display name of the hovered slot — the label for the `'single'` scope. */
  slotLabel: string
  /** Kind noun for the `'object'` label (e.g. "Whole shelf"). */
  nodeNoun: string
  /** Labels a surface names itself, per scope, over the generic ones. */
  labels?: Partial<Record<PaintScope, string>>
}

function nodeHasAsset(node: AnyNode): boolean {
  return Boolean((node as { asset?: { id?: string } }).asset?.id)
}

function nodeOffersRoomScope(node: AnyNode): boolean {
  return nodeRegistry.get(node.type)?.capabilities?.paint?.roomScope === true
}

const isFloorPlate = (node: AnyNode): boolean => node.type === 'slab' && node.boundary === 'auto'

const FOOTPRINT_FACE_LABELS: Record<string, string> = {
  edge: 'Floor edge · all around this floor',
  riser: 'Riser · all around this floor',
  underside: 'Underside · all of this floor',
  foundation: 'Foundation · all around this floor',
}

/**
 * The scopes a generated floor plate offers for the surface under the cursor.
 * A plate is not an object anyone paints whole: a room's floor is "this
 * surface" (the painted part under the cursor, else the room floor) or the
 * whole room; a step is its doorway or every step of the room; the footprint's
 * faces are one finish all around the floor, so they have nothing to cycle.
 */
export function platePaintScopes(
  node: AnyNode,
  role: string,
): { scopes: PaintScope[]; labels: Partial<Record<PaintScope, string>> } | null {
  if (node.type !== 'slab' || node.boundary !== 'auto') return null
  if (parseFloorStepRole(role))
    return {
      scopes: ['single', 'room'],
      labels: { single: 'This step', room: 'All steps in this room' },
    }
  if (parseRoomFinishRole(role))
    return { scopes: ['single', 'room'], labels: { single: 'This surface', room: 'Whole room' } }
  const fixed = node.plateRole === 'base' ? FOOTPRINT_FACE_LABELS[role] : undefined
  return { scopes: ['single'], labels: fixed ? { single: fixed } : {} }
}

/**
 * The scopes a hovered node offers, derived from the node itself: every node
 * paints `single`; > 1 slot adds `object`; an `asset` adds `matching`; a
 * `roomScope`-declaring kind adds `room`. `slotRoles` is the node's full slot set
 * (declared or mesh-derived), passed in by the caller. A floor plate's set
 * depends on the surface under the cursor (`role`).
 */
export function availablePaintScopes(args: {
  node: AnyNode
  slotRoles: string[]
  role?: string
}): PaintScope[] {
  // A wall paints the face under the cursor, or its room's walls: "whole wall"
  // (both faces of one wall, across two rooms) is nobody's surface.
  if (args.node.type === 'wall') return ['single', 'room']
  const plate = args.role === undefined ? null : platePaintScopes(args.node, args.role)
  if (plate) return plate.scopes
  const scopes: PaintScope[] = ['single']
  if (args.slotRoles.length > 1) scopes.push('object')
  if (nodeHasAsset(args.node)) scopes.push('matching')
  if (nodeOffersRoomScope(args.node)) scopes.push('room')
  return scopes
}

export function cyclePaintScope(scope: PaintScope, scopes: PaintScope[]): PaintScope {
  const list = scopes.length > 0 ? scopes : (['single'] as PaintScope[])
  const index = list.indexOf(scope)
  return list[(index + 1) % list.length] ?? 'single'
}

/** The chip's hover info for `role` on `node`: its scopes and what each is called. */
export function paintHoverInfo(node: AnyNode, role: string, slotRoles: string[]): PaintHoverInfo {
  return {
    scopes: availablePaintScopes({ node, slotRoles, role }),
    slotLabel: paintSurfaceLabel(node, role),
    nodeNoun: node.type,
    labels: platePaintScopes(node, role)?.labels,
  }
}

/** The scope a click applies: the chosen one when the hovered surface offers it. */
export function effectivePaintScope(scope: PaintScope, scopes: PaintScope[]): PaintScope {
  return scopes.includes(scope) ? scope : 'single'
}

export function paintScopeLabel(scope: PaintScope, info: PaintHoverInfo): string {
  const own = info.labels?.[scope]
  if (own) return own
  switch (scope) {
    case 'object':
      return `Whole ${info.nodeNoun}`
    case 'matching':
      return 'All matching'
    case 'room':
      return 'Room'
    default:
      return info.slotLabel || 'This surface'
  }
}

/**
 * All paintable slot roles of a node. Prefers the kind's declared
 * `capabilities.slots` (node-authored, stable); falls back to the runtime mesh
 * tags via the injected `meshSlotRoles` for kinds whose slots come from a GLB
 * (items) rather than a declaration.
 */
export function nodeSlotRoles(node: AnyNode, meshSlotRoles: (node: AnyNode) => string[]): string[] {
  const declared = nodeRegistry.get(node.type)?.capabilities?.slots?.(node)
  if (declared && declared.length > 0) return declared.map((slot) => slot.slotId)
  return meshSlotRoles(node)
}

/**
 * What the paint HUD calls the surface under the cursor: a wall face is the
 * "Face" (the narrow scope), a trim its own name, anything else its slot.
 */
export function paintSurfaceLabel(node: AnyNode, role: string): string {
  if (node.type === 'wall' && !WALL_TRIM_ROLE.test(role)) return 'Face'
  return slotDisplayLabel(node, role)
}

/** Display label for the hovered slot — declared label wins, else derived from the id. */
export function slotDisplayLabel(node: AnyNode, role: string): string {
  const capabilities = nodeRegistry.get(node.type)?.capabilities
  const declared = capabilities?.slots?.(node)?.find((slot) => slot.slotId === role)
  if (declared) return declared.label
  return capabilities?.paint?.roleLabel?.(node, role) ?? slotLabelFromId(role)
}

// ── Fan-out resolution ──────────────────────────────────────────────────────

type SlotsNode = AnyNode & { slots?: Record<string, string> }

export type WallPaintHit = {
  face: 'front' | 'back'
  point: [number, number]
}

type WallBoundaryFace = Space['boundaryFaces'][number]

function distanceToSegment(
  point: readonly [number, number],
  start: readonly [number, number],
  end: readonly [number, number],
): number {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const lengthSquared = dx * dx + dz * dz
  if (lengthSquared < 1e-12) return Math.hypot(point[0] - start[0], point[1] - start[1])
  const t = Math.max(
    0,
    Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / lengthSquared),
  )
  return Math.hypot(point[0] - (start[0] + dx * t), point[1] - (start[1] + dz * t))
}

function distanceToPolyline(
  point: readonly [number, number],
  points: ReadonlyArray<readonly [number, number]>,
): number {
  let distance = Number.POSITIVE_INFINITY
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]
    const end = points[index + 1]
    if (!(start && end)) continue
    distance = Math.min(distance, distanceToSegment(point, start, end))
  }
  return distance
}

const WALL_TRIM_ROLE = /^([ab])(Skirting|Crown|ChairRail)$/
const WALL_ROOM_FACE_ROLE = /^room:(.+)\/([ab])$/

/** The same surface on a boundary face: face slots and trims follow the physical face. */
function wallRoleForRoomFace(role: string, face: 'front' | 'back'): string | null {
  const physical = face === 'front' ? 'a' : 'b'
  if (role === 'a' || role === 'b') return physical
  const trim = WALL_TRIM_ROLE.exec(role)
  return trim ? `${physical}${trim[2]}` : null
}

/** The face a wall paint role sits on, when the role names one. */
function wallRoleFace(role: string): 'a' | 'b' | null {
  if (role === 'a' || role === 'b') return role
  return (WALL_TRIM_ROLE.exec(role)?.[1] ?? WALL_ROOM_FACE_ROLE.exec(role)?.[2] ?? null) as
    | 'a'
    | 'b'
    | null
}

/** The room (zone) a wall face borders at the hit point, from the zones' boundary spans. */
function zoneAtWallHit(
  wall: WallNode,
  face: 'a' | 'b',
  point: readonly [number, number],
  nodes: Record<string, AnyNode>,
): string | null {
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const lengthSquared = dx * dx + dz * dz
  if (lengthSquared < 1e-12) return null
  const t = ((point[0] - wall.start[0]) * dx + (point[1] - wall.start[1]) * dz) / lengthSquared
  const spans = getWallZoneSpans(wall, getWallLevelZones(wall, nodes))
  const span = spans.find(
    (candidate) =>
      candidate.face === face &&
      t >= candidate.t0 - 1e-6 &&
      (t < candidate.t1 || (candidate.t1 >= 1 && t <= 1 + 1e-6)),
  )
  return span?.zoneId ?? null
}

/**
 * Room scope on a wall face inside a room paints the room's wall finish: one
 * `room:<zoneId>` commit on the zone. Every wall bordering the room is listed so
 * each previews the change; trims fan out to the face each wall turns to the room.
 */
function wallRoomTargets(
  wall: WallNode,
  role: string,
  zoneId: string,
  nodes: Record<string, AnyNode>,
): Array<{ nodeId: AnyNodeId; role: string }> {
  const zone = nodes[zoneId]
  if (zone?.type !== 'zone') return []
  const walls = [
    wall,
    ...zone.boundaryWallIds
      .map((id) => nodes[id])
      .filter((node): node is WallNode => node?.type === 'wall' && node.id !== wall.id),
  ]
  const trim = WALL_TRIM_ROLE.exec(role)
  if (trim) {
    const targets = new Map<string, { nodeId: AnyNodeId; role: string }>()
    for (const target of walls) {
      for (const span of getWallZoneSpans(target, [zone])) {
        const targetRole = `${span.face}${trim[2]}`
        targets.set(`${target.id}:${targetRole}`, {
          nodeId: target.id as AnyNodeId,
          role: targetRole,
        })
      }
    }
    return [...targets.values()]
  }
  const roomRole = wallRoomFinishRole(zoneId)
  const targets = walls.map((target) => ({ nodeId: target.id as AnyNodeId, role: roomRole }))
  // A room bounded by one wall still commits through the fan-out path, which
  // routes the room role to the zone; the zone target itself previews nothing.
  if (targets.length === 1) targets.push({ nodeId: zone.id as AnyNodeId, role: roomRole })
  return targets
}

function resolveWallPaintSpace(args: {
  wall: WallNode
  wallHit: WallPaintHit
  nodes: Record<string, AnyNode>
  spaces: Record<string, Space>
}): Space | null {
  const { wall, wallHit, nodes, spaces } = args
  const levelId = wall.parentId ?? resolveLevelId(wall, nodes)
  const tolerance =
    getWallLocalFaceZ(
      { ...wall, thickness: wall.thickness ?? 0.2 },
      wallHit.face === 'front' ? 'a' : 'b',
    ) *
      (wallHit.face === 'front' ? 1 : -1) +
    0.08
  let best: { space: Space; distance: number } | null = null

  for (const space of Object.values(spaces)) {
    if (space.levelId !== levelId) continue
    for (const boundary of space.boundaryFaces) {
      if (boundary.wallId !== wall.id || boundary.face !== wallHit.face) continue
      const distance = distanceToPolyline(wallHit.point, boundary.points)
      if (distance > tolerance || (best && distance >= best.distance)) continue
      best = { space, distance }
    }
  }

  return best?.space ?? null
}

function boundaryPointKey(point: readonly [number, number]): string {
  return `${point[0].toFixed(3)},${point[1].toFixed(3)}`
}

function boundarySegmentKey(boundary: WallBoundaryFace): string {
  const forward = boundary.points.map(boundaryPointKey).join('|')
  const reverse = [...boundary.points].reverse().map(boundaryPointKey).join('|')
  return `${boundary.wallId}:${forward < reverse ? forward : reverse}`
}

function oppositeWallFace(face: 'front' | 'back'): 'front' | 'back' {
  return face === 'front' ? 'back' : 'front'
}

function connectedExteriorBoundaries(args: {
  wall: WallNode
  wallHit: WallPaintHit
  levelId: string
  spaces: Record<string, Space>
}): WallBoundaryFace[] {
  const { wall, wallHit, levelId, spaces } = args
  const occurrences = new Map<string, WallBoundaryFace[]>()

  for (const space of Object.values(spaces)) {
    if (space.levelId !== levelId) continue
    for (const boundary of space.boundaryFaces) {
      const key = boundarySegmentKey(boundary)
      const entries = occurrences.get(key) ?? []
      entries.push(boundary)
      occurrences.set(key, entries)
    }
  }

  const exterior = [...occurrences.values()].flatMap((entries) => {
    const boundary = entries.length === 1 ? entries[0] : undefined
    if (!boundary) return []
    return [{ ...boundary, face: oppositeWallFace(boundary.face) }]
  })
  const tolerance =
    getWallLocalFaceZ(
      { ...wall, thickness: wall.thickness ?? 0.2 },
      wallHit.face === 'front' ? 'a' : 'b',
    ) *
      (wallHit.face === 'front' ? 1 : -1) +
    0.08
  const seed = exterior
    .filter((boundary) => boundary.wallId === wall.id && boundary.face === wallHit.face)
    .map((boundary) => ({ boundary, distance: distanceToPolyline(wallHit.point, boundary.points) }))
    .filter((candidate) => candidate.distance <= tolerance)
    .sort((a, b) => a.distance - b.distance)[0]?.boundary
  if (!seed) return []

  const boundariesByEndpoint = new Map<string, WallBoundaryFace[]>()
  for (const boundary of exterior) {
    const first = boundary.points[0]
    const last = boundary.points[boundary.points.length - 1]
    for (const point of [first, last]) {
      if (!point) continue
      const key = boundaryPointKey(point)
      const entries = boundariesByEndpoint.get(key) ?? []
      entries.push(boundary)
      boundariesByEndpoint.set(key, entries)
    }
  }

  const connected: WallBoundaryFace[] = []
  const visited = new Set<string>()
  const queue = [seed]
  while (queue.length > 0) {
    const boundary = queue.shift()
    if (!boundary) continue
    const key = `${boundarySegmentKey(boundary)}:${boundary.face}`
    if (visited.has(key)) continue
    visited.add(key)
    connected.push(boundary)

    const first = boundary.points[0]
    const last = boundary.points[boundary.points.length - 1]
    for (const point of [first, last]) {
      if (!point) continue
      for (const neighbour of boundariesByEndpoint.get(boundaryPointKey(point)) ?? []) {
        queue.push(neighbour)
      }
    }
  }

  return connected
}

function wallTargetsForBoundaries(args: {
  boundaries: WallBoundaryFace[]
  role: string
  levelId: string
  nodes: Record<string, AnyNode>
}): Array<{ nodeId: AnyNodeId; role: string }> {
  const { boundaries, role, levelId, nodes } = args
  const targets = new Map<string, { nodeId: AnyNodeId; role: string }>()
  for (const boundary of boundaries) {
    const targetWall = nodes[boundary.wallId]
    if (
      targetWall?.type !== 'wall' ||
      (targetWall.parentId ?? resolveLevelId(targetWall, nodes)) !== levelId
    ) {
      continue
    }
    const targetRole = wallRoleForRoomFace(role, boundary.face)
    if (!targetRole) continue
    const key = `${targetWall.id}:${targetRole}`
    targets.set(key, { nodeId: targetWall.id as AnyNodeId, role: targetRole })
  }
  return [...targets.values()]
}

function polygonCentroid(
  points: ReadonlyArray<readonly [number, number]>,
): [number, number] | null {
  if (points.length === 0) return null
  let x = 0
  let z = 0
  for (const point of points) {
    x += point[0]
    z += point[1]
  }
  return [x / points.length, z / points.length]
}

/**
 * The role one paint click writes under `scope`: a floor step paints its own
 * doorway, and in the room scope every step of its room (`step:<zoneId>`); a
 * room's floor in the room scope is the whole room (`room:<zoneId>/*`).
 * Hover outline, preview and commit all start from this role.
 */
export function paintScopeRole(node: AnyNode, role: string, scope: PaintScope): string {
  if (node.type !== 'slab' || scope !== 'room') return role
  const step = parseFloorStepRole(role)
  if (step) return floorStepRole(step.zoneId)
  const floor = isFloorPlate(node) ? parseRoomFinishRole(role) : null
  return floor ? `room:${floor.zoneId}/*` : role
}

/**
 * Expand one paint hit (`node` + resolved `role`) into the full list of
 * (node, role) targets the current `scope` should paint. Returns just the
 * clicked surface for `'single'`, for any target whose scope set doesn't
 * include the current scope, and whenever the spread resolves to a single
 * element — so callers can keep the kind-specific single-node commit for that
 * case and only batch when there's genuinely more than one target.
 *
 * `slotRolesOf` enumerates the node's full slot set (declared or mesh-derived,
 * injected by the caller) for the whole-object scope.
 */
export function resolvePaintScopeTargets(args: {
  node: AnyNode
  role: string
  scope: PaintScope
  nodes: Record<string, AnyNode>
  spaces: Record<string, Space>
  slotRolesOf: (node: AnyNode) => string[]
  wallHit?: WallPaintHit
}): Array<{ nodeId: AnyNodeId; role: string }> {
  const { node, role, nodes, spaces, slotRolesOf, wallHit } = args
  const plateScopes = platePaintScopes(node, role)?.scopes
  const scope = plateScopes ? effectivePaintScope(args.scope, plateScopes) : args.scope
  const single = [{ nodeId: node.id as AnyNodeId, role }]
  if (node.type === 'slab' && parseFloorStepRole(role)) {
    // A room's steps are drawn by whichever plates carry them.
    const stepRole = paintScopeRole(node, role, scope)
    const targets = Object.values(nodes)
      .filter(
        (other) =>
          other.type === 'slab' && other.parentId === node.parentId && other.boundary === 'auto',
      )
      .map((other) => ({ nodeId: other.id, role: stepRole }))
    return targets.length ? targets : [{ nodeId: node.id as AnyNodeId, role: stepRole }]
  }
  if (scope === 'single') return single

  // Whole object: paint every slot of the clicked node. Generic across any
  // slot-model kind (item, shelf, door, …) — not item-specific.
  if (scope === 'object') {
    const roles = slotRolesOf(node)
    const set = roles.length > 0 ? roles : [role]
    return set.map((slotRole) => ({ nodeId: node.id as AnyNodeId, role: slotRole }))
  }

  // All matching: same slot across every instance of the node's asset (items).
  if (scope === 'matching') {
    const assetId = (node as ItemNode).asset?.id
    if (!assetId) return single
    return Object.values(nodes)
      .filter((other) => other.type === 'item' && (other as ItemNode).asset?.id === assetId)
      .map((other) => ({ nodeId: other.id as AnyNodeId, role }))
  }

  if (node.type === 'wall' && scope === 'room') {
    const wall = node as WallNode
    if (!wallHit) return single
    const levelId = wall.parentId ?? resolveLevelId(wall, nodes)
    if (!levelId) return single
    const face = wallRoleFace(role) ?? (wallHit.face === 'front' ? 'a' : 'b')
    const zoneId =
      WALL_ROOM_FACE_ROLE.exec(role)?.[1] ?? zoneAtWallHit(wall, face, wallHit.point, nodes)
    if (zoneId) {
      const targets = wallRoomTargets(wall, role, zoneId, nodes)
      if (targets.length > 0) return targets
    }
    const space = resolveWallPaintSpace({ wall, wallHit, nodes, spaces })
    const boundaries = space
      ? space.boundaryFaces
      : connectedExteriorBoundaries({ wall, wallHit, levelId, spaces })
    const targets = wallTargetsForBoundaries({ boundaries, role, levelId, nodes })
    return targets.length > 0 ? targets : single
  }

  if (node.type === 'slab' && scope === 'room') {
    // A room's floor in the room scope: every finish source of that room (its
    // floor, painted parts, steps and edge) on every plate of the level, as one
    // `room:<zoneId>/*` role the zone commits.
    const floor = parseRoomFinishRole(role)
    if (floor) {
      const roomWide = `room:${floor.zoneId}/*`
      const plates = Object.values(nodes).filter(
        (other) =>
          other.type === 'slab' && other.parentId === node.parentId && other.boundary === 'auto',
      )
      return (plates.length ? plates : [node]).map((plate) => ({
        nodeId: plate.id as AnyNodeId,
        role: roomWide,
      }))
    }
    // A floor plate's own faces have no room scope; below is the hand-drawn
    // slab's spread over the slabs of its room.
    if (isFloorPlate(node)) return single
    const centroid = polygonCentroid((node as SlabNode).polygon)
    if (!centroid) return single
    // Space polygons are per-level footprints, and stacked storeys share a
    // footprint — so the level has to gate both the space lookup and the fan-out
    // or one click paints the floor above too.
    const levelId = node.parentId ?? resolveLevelId(node, nodes)
    if (!levelId) return single
    const space = Object.values(spaces).find(
      (candidate) => candidate.levelId === levelId && pointInPolygon2D(centroid, candidate.polygon),
    )
    if (!space) return single
    return Object.values(nodes)
      .filter((other) => {
        if (other.type !== 'slab') return false
        if ((other.parentId ?? resolveLevelId(other, nodes)) !== levelId) return false
        const otherCentroid = polygonCentroid((other as SlabNode).polygon)
        return otherCentroid != null && pointInPolygon2D(otherCentroid, space.polygon)
      })
      .map((other) => ({ nodeId: other.id as AnyNodeId, role }))
  }

  return single
}

// ── Batched commit ──────────────────────────────────────────────────────────

// Structural equality for the one-off-colour dedup below. The slot model is
// uniform across item / wall / slab (`node.slots[role] = ref`), so the same
// matcher the per-kind commits use applies to the whole fan-out.
function materialsEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== typeof b || a === null || b === null) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!(Array.isArray(a) && Array.isArray(b)) || a.length !== b.length) return false
    return a.every((value, index) => materialsEqual(value, b[index]))
  }
  if (typeof a === 'object') {
    const aRecord = a as Record<string, unknown>
    const bRecord = b as Record<string, unknown>
    const aKeys = Object.keys(aRecord)
    if (aKeys.length !== Object.keys(bRecord).length) return false
    return aKeys.every(
      (key) => Object.hasOwn(bRecord, key) && materialsEqual(aRecord[key], bRecord[key]),
    )
  }
  return false
}

/**
 * Split a fan-out into slot writes and roles a kind routes elsewhere — a wall's
 * `room:<zoneId>` paints the zone, through the wall's own commit, once per role.
 * Targets without a paint capability (the zone listed for a one-wall room) only
 * ride along for the preview.
 */
function partitionFanout(targets: ReadonlyArray<{ nodeId: AnyNodeId; role: string }>) {
  const nodes = useScene.getState().nodes
  const routed = new Map<string, { nodeId: AnyNodeId; role: string }>()
  const slots: Array<{ nodeId: AnyNodeId; role: string }> = []
  for (const target of targets) {
    const node = nodes[target.nodeId]
    if (!node) continue
    const capabilities = nodeRegistry.get(node.type)?.capabilities
    const declared = capabilities?.slots?.(node)
    const isSlot = declared?.length
      ? declared.some((slot) => slot.slotId === target.role)
      : !target.role.includes(':')
    const key = target.role.includes(':') ? target.role : `${target.nodeId}:${target.role}`
    if (isSlot) slots.push(target)
    else if (capabilities?.paint?.commit && !routed.has(key)) routed.set(key, target)
  }
  return { routed: [...routed.values()], slots }
}

/**
 * Apply one paint to many slot-model targets in a single undo step. Resolves
 * the slot ref ONCE — a one-off colour creates a single shared scene material
 * for the whole fan-out, not one per node — then writes every `node.slots[role]`
 * (or deletes it, for the eraser) in one `useScene.setState`. Routed roles
 * (see `partitionFanout`) commit through their kind instead.
 */
export function commitPaintScopeFanout(
  fanout: ReadonlyArray<{ nodeId: AnyNodeId; role: string }>,
  material: MaterialSchema | undefined,
  materialPreset: string | undefined,
): void {
  const { routed, slots: targets } = partitionFanout(fanout)
  for (const { nodeId, role } of routed) {
    const node = useScene.getState().nodes[nodeId]
    const paint = node ? nodeRegistry.get(node.type)?.capabilities?.paint : undefined
    if (node && paint?.commit) paint.commit({ node, role, material, materialPreset })
  }
  if (targets.length === 0) return
  const state = useScene.getState()

  let ref: string | undefined
  let newSceneMaterial: SceneMaterial | null = null
  if (material === undefined && materialPreset === undefined) {
    ref = undefined // eraser → clear the slot back to its default
  } else if (materialPreset) {
    ref = materialPreset
  } else if (material) {
    const existing = Object.values(state.materials).find((scene) =>
      materialsEqual(scene.material, material),
    )
    if (existing) {
      ref = toSceneMaterialRef(existing.id)
    } else {
      const id = generateSceneMaterialId()
      newSceneMaterial = {
        id,
        name: `Material ${Object.keys(state.materials).length + 1}`,
        material,
      }
      ref = toSceneMaterialRef(id)
    }
  } else {
    return
  }

  useScene.setState((current) => {
    if (current.readOnly) return current
    const nextNodes = { ...current.nodes }
    let changed = false
    for (const { nodeId, role } of targets) {
      const node = nextNodes[nodeId] as SlotsNode | undefined
      if (!node) continue
      const nextSlots = { ...(node.slots ?? {}) }
      if (ref) nextSlots[role] = ref
      else delete nextSlots[role]
      nextNodes[nodeId] = { ...node, slots: nextSlots } as AnyNode
      changed = true
    }
    if (!changed) return current
    return {
      nodes: nextNodes,
      materials: newSceneMaterial
        ? { ...current.materials, [newSceneMaterial.id as SceneMaterialId]: newSceneMaterial }
        : current.materials,
    }
  })

  for (const { nodeId } of targets) state.markDirty(nodeId)
}
