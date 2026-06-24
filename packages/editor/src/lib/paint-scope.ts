import {
  type AnyNode,
  type AnyNodeId,
  generateSceneMaterialId,
  type ItemNode,
  type MaterialSchema,
  nodeRegistry,
  pointInPolygon2D,
  pointOnSegment,
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

// Room polygons are built from wall *centerline* endpoints (see
// `extractRoomPolygons`), so a wall's `start`/`end` are exact polygon vertices —
// a small tolerance only absorbs float round-trips. `Space.wallIds` is always
// empty, so room membership is resolved geometrically here instead.
const WALL_ON_BOUNDARY_TOLERANCE = 0.05

function pointOnPolygonBoundary(
  point: readonly [number, number],
  polygon: ReadonlyArray<readonly [number, number]>,
  tolerance: number,
): boolean {
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i]
    const b = polygon[(i + 1) % polygon.length]
    if (
      a &&
      b &&
      pointOnSegment(
        point as [number, number],
        a as [number, number],
        b as [number, number],
        tolerance,
      )
    ) {
      return true
    }
  }
  return false
}

// A wall bounds a room when both its endpoints lie on the room polygon's
// boundary (a shared wall lies on two rooms' boundaries; a wall radiating out of
// a corner has only one endpoint on it and is correctly excluded).
function wallBoundsRoom(
  wall: WallNode,
  polygon: ReadonlyArray<readonly [number, number]>,
): boolean {
  return (
    pointOnPolygonBoundary(wall.start, polygon, WALL_ON_BOUNDARY_TOLERANCE) &&
    pointOnPolygonBoundary(wall.end, polygon, WALL_ON_BOUNDARY_TOLERANCE)
  )
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
}): Array<{ nodeId: AnyNodeId; role: string }> {
  const { node, role, scope, nodes, spaces, slotRolesOf } = args
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
    const space = Object.values(spaces).find((candidate) => wallBoundsRoom(wall, candidate.polygon))
    if (!space) return single
    return Object.values(nodes)
      .filter((other) => other.type === 'wall' && wallBoundsRoom(other as WallNode, space.polygon))
      .map((other) => ({ nodeId: other.id as AnyNodeId, role }))
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
