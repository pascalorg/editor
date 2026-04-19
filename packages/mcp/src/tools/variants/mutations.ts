import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import type { AnyNode, AnyNodeId } from '@pascal-app/core/schema'

/** Mutation kinds handled by `applyMutation`. */
export type MutationKind =
  | 'wall-thickness'
  | 'wall-height'
  | 'zone-labels'
  | 'room-proportions'
  | 'open-plan'
  | 'door-positions'
  | 'fence-style'

/** Deterministic 32-bit RNG. */
export type Rng = () => number

/**
 * Tiny PRNG. Returns a function that produces uniformly distributed floats in
 * [0, 1). Source: https://stackoverflow.com/a/47593316/17118
 */
export function mulberry32(seed: number): Rng {
  let state = seed | 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Pick a random element from a non-empty array. */
function pickFrom<T>(rng: Rng, values: readonly T[]): T {
  const idx = Math.floor(rng() * values.length)
  return values[Math.min(idx, values.length - 1)] as T
}

/** Shallow clone a scene graph: nodes are copied one level deep, node dict is fresh. */
function cloneGraph(graph: SceneGraph): SceneGraph {
  const clonedNodes: Record<AnyNodeId, AnyNode> = {} as Record<AnyNodeId, AnyNode>
  for (const [id, node] of Object.entries(graph.nodes)) {
    // structuredClone so sub-objects (arrays, tuples, metadata) are independent.
    clonedNodes[id as AnyNodeId] = structuredClone(node) as AnyNode
  }
  return {
    nodes: clonedNodes,
    rootNodeIds: [...graph.rootNodeIds],
    ...(graph.collections ? { collections: structuredClone(graph.collections) } : {}),
  }
}

const WALL_THICKNESS_OPTIONS = [0.1, 0.15, 0.2, 0.25] as const
const WALL_HEIGHT_OPTIONS = [2.4, 2.6, 2.7, 3.0] as const
const FENCE_STYLES = ['privacy', 'slat', 'rail'] as const

/** Fisher–Yates shuffle in place using the provided RNG. */
function shuffleInPlace<T>(arr: T[], rng: Rng): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = arr[i] as T
    arr[i] = arr[j] as T
    arr[j] = tmp
  }
}

/**
 * Compute 2D bounds (min/max x/z) of the first `site` node's polygon points,
 * or `null` if no site is present.
 */
function siteBounds(
  graph: SceneGraph,
): { minX: number; maxX: number; minZ: number; maxZ: number } | null {
  for (const node of Object.values(graph.nodes)) {
    if (node.type !== 'site') continue
    const pts = (node as { polygon?: { points?: Array<[number, number]> } }).polygon?.points
    if (!pts || pts.length === 0) continue
    let minX = Infinity
    let maxX = -Infinity
    let minZ = Infinity
    let maxZ = -Infinity
    for (const [x, z] of pts) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (z < minZ) minZ = z
      if (z > maxZ) maxZ = z
    }
    if (!Number.isFinite(minX)) continue
    return { minX, maxX, minZ, maxZ }
  }
  return null
}

/**
 * Heuristic: a wall is a perimeter wall if either of its endpoints sits close
 * to the site polygon's bounding rectangle (within `epsilon`). Returns `false`
 * if there is no site polygon (treat everything as interior so the mutations
 * still exercise something on partial scenes).
 */
function isPerimeterWall(
  wall: AnyNode & { start?: [number, number]; end?: [number, number] },
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number } | null,
  epsilon = 0.01,
): boolean {
  if (!bounds || !wall.start || !wall.end) return false
  const onBound = (x: number, z: number): boolean =>
    Math.abs(x - bounds.minX) <= epsilon ||
    Math.abs(x - bounds.maxX) <= epsilon ||
    Math.abs(z - bounds.minZ) <= epsilon ||
    Math.abs(z - bounds.maxZ) <= epsilon
  const [sx, sz] = wall.start
  const [ex, ez] = wall.end
  return onBound(sx, sz) || onBound(ex, ez)
}

function applyWallThickness(graph: SceneGraph, rng: Rng): SceneGraph {
  const out = cloneGraph(graph)
  for (const node of Object.values(out.nodes)) {
    if (node.type !== 'wall') continue
    ;(node as { thickness?: number }).thickness = pickFrom(rng, WALL_THICKNESS_OPTIONS)
  }
  return out
}

function applyWallHeight(graph: SceneGraph, rng: Rng): SceneGraph {
  const out = cloneGraph(graph)
  for (const node of Object.values(out.nodes)) {
    if (node.type !== 'wall') continue
    ;(node as { height?: number }).height = pickFrom(rng, WALL_HEIGHT_OPTIONS)
  }
  return out
}

function applyZoneLabels(graph: SceneGraph, rng: Rng): SceneGraph {
  const out = cloneGraph(graph)
  const zoneNodes: Array<AnyNode & { name?: string }> = []
  for (const node of Object.values(out.nodes)) {
    if (node.type === 'zone') zoneNodes.push(node as AnyNode & { name?: string })
  }
  if (zoneNodes.length < 2) return out
  const labels = zoneNodes.map((z) => z.name ?? '')
  shuffleInPlace(labels, rng)
  for (let i = 0; i < zoneNodes.length; i++) {
    ;(zoneNodes[i] as { name?: string }).name = labels[i]
  }
  return out
}

function applyRoomProportions(graph: SceneGraph, rng: Rng): SceneGraph {
  const out = cloneGraph(graph)
  const bounds = siteBounds(out)
  for (const node of Object.values(out.nodes)) {
    if (node.type !== 'wall') continue
    const wall = node as AnyNode & {
      start?: [number, number]
      end?: [number, number]
    }
    if (!wall.start || !wall.end) continue
    if (isPerimeterWall(wall, bounds)) continue
    // Nudge each endpoint by ±10% of its current value.
    const nudge = (v: number): number => v * (1 + (rng() * 2 - 1) * 0.1)
    const clampX = (v: number): number =>
      bounds ? Math.min(bounds.maxX, Math.max(bounds.minX, v)) : v
    const clampZ = (v: number): number =>
      bounds ? Math.min(bounds.maxZ, Math.max(bounds.minZ, v)) : v
    const [sx, sz] = wall.start
    const [ex, ez] = wall.end
    wall.start = [clampX(nudge(sx)), clampZ(nudge(sz))]
    wall.end = [clampX(nudge(ex)), clampZ(nudge(ez))]
  }
  return out
}

function applyOpenPlan(graph: SceneGraph, rng: Rng): SceneGraph {
  const out = cloneGraph(graph)
  const bounds = siteBounds(out)
  const interiorWallIds: AnyNodeId[] = []
  for (const [id, node] of Object.entries(out.nodes)) {
    if (node.type !== 'wall') continue
    if (isPerimeterWall(node as AnyNode, bounds)) continue
    interiorWallIds.push(id as AnyNodeId)
  }
  if (interiorWallIds.length === 0) return out
  const targetId = interiorWallIds[Math.floor(rng() * interiorWallIds.length)] as AnyNodeId
  // Collect any openings attached to this wall so we can drop them too.
  const attached: AnyNodeId[] = []
  for (const [attId, node] of Object.entries(out.nodes)) {
    if ((node as { wallId?: string }).wallId === targetId) attached.push(attId as AnyNodeId)
  }
  const removal = new Set<AnyNodeId>([targetId, ...attached])
  // Drop from nodes.
  for (const id of removal) delete out.nodes[id]
  // Drop from rootNodeIds (unlikely for walls, but consistent).
  out.rootNodeIds = out.rootNodeIds.filter((id) => !removal.has(id))
  // Drop references from any parent's `children` array.
  for (const parent of Object.values(out.nodes)) {
    if (!('children' in parent) || !Array.isArray((parent as { children?: unknown[] }).children)) {
      continue
    }
    const children = (parent as { children: unknown[] }).children
    ;(parent as { children: unknown[] }).children = children.filter((child) => {
      if (typeof child === 'string') return !removal.has(child as AnyNodeId)
      if (child && typeof child === 'object' && 'id' in (child as Record<string, unknown>)) {
        return !removal.has((child as { id: AnyNodeId }).id)
      }
      return true
    })
  }
  return out
}

function applyDoorPositions(graph: SceneGraph, rng: Rng): SceneGraph {
  const out = cloneGraph(graph)
  // Group doors by their parent wall so we can space them out and skip collisions.
  const doorsByWall = new Map<string, Array<AnyNode & { wallT?: number; wallId?: string }>>()
  for (const node of Object.values(out.nodes)) {
    if (node.type !== 'door') continue
    const wallId = (node as { wallId?: string }).wallId
    if (!wallId) continue
    let list = doorsByWall.get(wallId)
    if (!list) {
      list = []
      doorsByWall.set(wallId, list)
    }
    list.push(node as AnyNode & { wallT?: number; wallId?: string })
  }
  for (const [, doors] of doorsByWall) {
    // Minimum separation along the parametric wall axis — rough keep-away to
    // avoid obvious overlaps.
    const minGap = 0.15
    const usedTs: number[] = []
    for (const door of doors) {
      let attempts = 0
      let t = 0.5
      while (attempts < 8) {
        t = 0.2 + rng() * 0.6 // [0.2, 0.8]
        const collides = usedTs.some((u) => Math.abs(u - t) < minGap)
        if (!collides) break
        attempts++
      }
      // If we still collide after 8 attempts, skip this door (leave it alone).
      if (usedTs.some((u) => Math.abs(u - t) < minGap)) continue
      usedTs.push(t)
      ;(door as { wallT?: number }).wallT = t
    }
  }
  return out
}

function applyFenceStyle(graph: SceneGraph, rng: Rng): SceneGraph {
  const out = cloneGraph(graph)
  let i = 0
  for (const node of Object.values(out.nodes)) {
    if (node.type !== 'fence') continue
    // Use rng to choose a rotation offset so each call can produce a different
    // starting point even when called multiple times with the same base.
    const offset = Math.floor(rng() * FENCE_STYLES.length)
    const style = FENCE_STYLES[(i + offset) % FENCE_STYLES.length]
    ;(node as { style?: string }).style = style
    i++
  }
  return out
}

/** Pure: apply a single mutation and return a fresh graph. */
export function applyMutation(graph: SceneGraph, rng: Rng, kind: MutationKind): SceneGraph {
  switch (kind) {
    case 'wall-thickness':
      return applyWallThickness(graph, rng)
    case 'wall-height':
      return applyWallHeight(graph, rng)
    case 'zone-labels':
      return applyZoneLabels(graph, rng)
    case 'room-proportions':
      return applyRoomProportions(graph, rng)
    case 'open-plan':
      return applyOpenPlan(graph, rng)
    case 'door-positions':
      return applyDoorPositions(graph, rng)
    case 'fence-style':
      return applyFenceStyle(graph, rng)
  }
}

/**
 * Human-readable summary of the mutations applied to a variant. Reads the
 * interesting fields from the graph (e.g. first wall's thickness/height).
 */
export function describeVariant(graph: SceneGraph, mutations: readonly MutationKind[]): string {
  const parts: string[] = []
  if (mutations.includes('wall-thickness')) {
    const t = firstWallField(graph, 'thickness')
    if (t !== null) parts.push(`wall thickness ${t}m`)
  }
  if (mutations.includes('wall-height')) {
    const h = firstWallField(graph, 'height')
    if (h !== null) parts.push(`wall height ${h}m`)
  }
  if (mutations.includes('zone-labels')) {
    const names: string[] = []
    for (const node of Object.values(graph.nodes)) {
      if (node.type === 'zone') names.push((node as { name?: string }).name ?? '')
    }
    if (names.length > 0) parts.push(`zones [${names.join(', ')}]`)
  }
  if (mutations.includes('room-proportions')) parts.push('room proportions nudged')
  if (mutations.includes('open-plan')) parts.push('open-plan')
  if (mutations.includes('door-positions')) parts.push('doors repositioned')
  if (mutations.includes('fence-style')) {
    const s = firstFenceField(graph, 'style')
    if (s !== null) parts.push(`fence style ${s}`)
  }
  return parts.length > 0 ? parts.join(', ') : 'no-op'
}

function firstWallField(graph: SceneGraph, field: 'thickness' | 'height'): number | null {
  for (const node of Object.values(graph.nodes)) {
    if (node.type !== 'wall') continue
    const v = (node as Record<string, unknown>)[field]
    if (typeof v === 'number') return v
  }
  return null
}

function firstFenceField(graph: SceneGraph, field: 'style'): string | null {
  for (const node of Object.values(graph.nodes)) {
    if (node.type !== 'fence') continue
    const v = (node as Record<string, unknown>)[field]
    if (typeof v === 'string') return v
  }
  return null
}
