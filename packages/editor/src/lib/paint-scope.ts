import {
  type AnyNode,
  type AnyNodeId,
  generateSceneMaterialId,
  type ItemNode,
  type MaterialSchema,
  nodeRegistry,
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
}

function nodeHasAsset(node: AnyNode): boolean {
  return Boolean((node as { asset?: { id?: string } }).asset?.id)
}

function nodeOffersRoomScope(node: AnyNode): boolean {
  return nodeRegistry.get(node.type)?.capabilities?.paint?.roomScope === true
}

/**
 * The scopes a hovered node offers, derived from the node itself: every node
 * paints `single`; > 1 slot adds `object`; an `asset` adds `matching`; a
 * `roomScope`-declaring kind adds `room`. `slotRoles` is the node's full slot set
 * (declared or mesh-derived), passed in by the caller.
 */
export function availablePaintScopes(args: { node: AnyNode; slotRoles: string[] }): PaintScope[] {
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

export function paintScopeLabel(scope: PaintScope, info: PaintHoverInfo): string {
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

/** Display label for the hovered slot — declared label wins, else derived from the id. */
export function slotDisplayLabel(node: AnyNode, role: string): string {
  const declared = nodeRegistry
    .get(node.type)
    ?.capabilities?.slots?.(node)
    ?.find((slot) => slot.slotId === role)
  return declared?.label ?? slotLabelFromId(role)
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

function wallRoleForRoomFace(role: string, wall: WallNode, face: 'front' | 'back'): string | null {
  const semantic = face === 'front' ? wall.frontSide : wall.backSide
  const fallback = face === 'front' ? 'interior' : 'exterior'
  const side = semantic === 'interior' || semantic === 'exterior' ? semantic : fallback

  if (role === 'interior' || role === 'exterior') return side
  if (role.endsWith('Interior'))
    return `${role.slice(0, -'Interior'.length)}${side === 'interior' ? 'Interior' : 'Exterior'}`
  if (role.endsWith('Exterior'))
    return `${role.slice(0, -'Exterior'.length)}${side === 'interior' ? 'Interior' : 'Exterior'}`
  return null
}

function resolveWallPaintSpace(args: {
  wall: WallNode
  wallHit: WallPaintHit
  nodes: Record<string, AnyNode>
  spaces: Record<string, Space>
}): Space | null {
  const { wall, wallHit, nodes, spaces } = args
  const levelId = wall.parentId ?? resolveLevelId(wall, nodes)
  const tolerance = (wall.thickness ?? 0.2) / 2 + 0.08
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
  const tolerance = (wall.thickness ?? 0.2) / 2 + 0.08
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
    const targetRole = wallRoleForRoomFace(role, targetWall, boundary.face)
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
  const { node, role, scope, nodes, spaces, slotRolesOf, wallHit } = args
  const single = [{ nodeId: node.id as AnyNodeId, role }]
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
    const space = resolveWallPaintSpace({ wall, wallHit, nodes, spaces })
    const boundaries = space
      ? space.boundaryFaces
      : connectedExteriorBoundaries({ wall, wallHit, levelId, spaces })
    const targets = wallTargetsForBoundaries({ boundaries, role, levelId, nodes })
    return targets.length > 0 ? targets : single
  }

  if (node.type === 'slab' && scope === 'room') {
    const centroid = polygonCentroid((node as SlabNode).polygon)
    if (!centroid) return single
    const space = Object.values(spaces).find((candidate) =>
      pointInPolygon2D(centroid, candidate.polygon),
    )
    if (!space) return single
    return Object.values(nodes)
      .filter((other) => {
        if (other.type !== 'slab') return false
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
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
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
 * Apply one paint to many slot-model targets in a single undo step. Resolves
 * the slot ref ONCE — a one-off colour creates a single shared scene material
 * for the whole fan-out, not one per node — then writes every `node.slots[role]`
 * (or deletes it, for the eraser) in one `useScene.setState`. Only ever called
 * for item / wall / slab fan-outs, all of which use the unified slot model.
 */
export function commitPaintScopeFanout(
  targets: ReadonlyArray<{ nodeId: AnyNodeId; role: string }>,
  material: MaterialSchema | undefined,
  materialPreset: string | undefined,
): void {
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
