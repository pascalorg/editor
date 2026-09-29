import {
  type GeometryContext,
  getFenceCenterlineFrameAt,
  getLevelElevations,
  getWallCurveFrameAt,
  type MeasurementFeature,
  measurementCentroid,
  nodeRegistry,
} from '@pascal-app/core'
import {
  composeFrames,
  type Frame,
  frame,
  IDENTITY_FRAME,
  nodeLevelFrame,
  transformPoint,
} from '@pascal-app/core/procedural-items'
import {
  AnyNode,
  type AnyNodeId,
  getRoofSegmentSurfaceY,
  nodeKindOf,
} from '@pascal-app/core/schema'
import type { Vec3 } from './geometry'
import { computeSegmentTransforms } from './scene-query'

type Nodes = Readonly<Record<string, AnyNode>>

function isVec3(value: unknown): value is Vec3 {
  return (
    Array.isArray(value) &&
    value.length >= 3 &&
    value.slice(0, 3).every((v) => typeof v === 'number' && Number.isFinite(v))
  )
}

function boundsCentre(points: readonly Vec3[]): Vec3 | null {
  if (points.length === 0) return null
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const p of points) {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i]!, p[i]!)
      max[i] = Math.max(max[i]!, p[i]!)
    }
  }
  return [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
}

/** Area centroid of a plan polygon at height `y`; the vertex average when degenerate. */
function polygonCentre(polygon: unknown, y: number): Vec3 | null {
  if (!Array.isArray(polygon) || polygon.length === 0) return null
  const points = (polygon as Array<[number, number]>).map(([x, z]) => [x, y, z] as Vec3)
  const centroid = measurementCentroid(points)
  if (centroid) return centroid
  let cx = 0
  let cz = 0
  for (const [x, , z] of points) {
    cx += x
    cz += z
  }
  return [cx / points.length, y, cz / points.length]
}

type FeatureReference = {
  nodeId: string
  featureId: string
  parameters?: Record<string, string | number | boolean>
}

function geometryContext(node: AnyNode, nodes: Nodes): GeometryContext {
  const lookup = (id: string) => nodes[id]
  const childIds = (n: AnyNode) =>
    'children' in n && Array.isArray(n.children) ? (n.children as string[]) : []
  const parent = node.parentId ? (lookup(node.parentId) ?? null) : null
  return {
    resolve: (<N = AnyNode>(id: AnyNodeId) =>
      lookup(id) as N | undefined) as GeometryContext['resolve'],
    parent,
    children: childIds(node)
      .map(lookup)
      .filter((child): child is AnyNode => child !== undefined),
    siblings: parent
      ? childIds(parent)
          .map(lookup)
          .filter((s): s is AnyNode => s !== undefined && s.type === node.type)
      : [],
  }
}

/** The point at parameter `t` (default 0.5) along a feature, by arc length. */
function featurePoint(feature: MeasurementFeature, reference: FeatureReference): Vec3 | null {
  const t = typeof reference.parameters?.t === 'number' ? reference.parameters.t : 0.5
  const geometry = feature.geometry
  if (geometry.kind === 'point') return geometry.point
  const points = geometry.kind === 'segment' ? [geometry.start, geometry.end] : geometry.points
  const closed =
    geometry.kind === 'polygon' || (geometry.kind === 'path' && geometry.closed === true)
  if (points.length === 0) return null
  const count = closed ? points.length : points.length - 1
  const lengths = Array.from({ length: Math.max(0, count) }, (_, i) => {
    const a = points[i]!
    const b = points[(i + 1) % points.length]!
    return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
  })
  const total = lengths.reduce((sum, length) => sum + length, 0)
  if (total <= 1e-9) return points[0]!
  let remaining = Math.max(0, Math.min(1, t)) * total
  for (let i = 0; i < count; i++) {
    const length = lengths[i]!
    if (remaining <= length || i === count - 1) {
      const a = points[i]!
      const b = points[(i + 1) % points.length]!
      const u = length <= 1e-9 ? 0 : remaining / length
      return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]
    }
    remaining -= length
  }
  return points[points.length - 1]!
}

/**
 * A measurement or dimension anchor as the viewer resolves it: a tuple is a
 * free point; a feature anchor follows its referenced node through that kind's
 * registered measurement contribution, and falls back to its stored point when
 * the node or the contribution is missing (`fallback: true`).
 */
function resolveAnchor(anchor: unknown, nodes: Nodes): { point: Vec3; fallback: boolean } | null {
  if (isVec3(anchor)) return { point: anchor, fallback: false }
  const feature = anchor as { reference?: FeatureReference; fallback?: unknown } | null
  if (!(feature?.reference && isVec3(feature.fallback))) return null
  const reference = feature.reference
  const referenced = nodes[reference.nodeId]
  const contribution = referenced ? nodeRegistry.get(referenced.type)?.measurement : undefined
  if (referenced && contribution) {
    const context = geometryContext(referenced, nodes)
    const resolved =
      contribution.resolve?.(referenced as never, context, reference as never) ??
      contribution.features(referenced as never, context).find((c) => c.id === reference.featureId)
    const point = resolved ? featurePoint(resolved, reference) : null
    if (point) return { point, fallback: false }
  }
  return { point: feature.fallback, fallback: true }
}

type AnchorSet = { anchors: unknown[]; shape: 'points' | 'area' | 'volume'; extrusion?: Vec3 }

/** The anchors a measurement or construction dimension draws from. */
function anchorSet(node: AnyNode): AnchorSet | null {
  if (node.type === 'construction-dimension') return { anchors: node.anchors, shape: 'points' }
  if (node.type !== 'measurement') return null
  const m = node.measurement as {
    kind: string
    points?: unknown[]
    base?: unknown[]
    extrusion?: unknown
  }
  if (m.kind === 'distance' || m.kind === 'angle')
    return { anchors: m.points ?? [], shape: 'points' }
  if (m.kind === 'volume' && isVec3(m.extrusion)) {
    return { anchors: m.base ?? [], shape: 'volume', extrusion: m.extrusion }
  }
  return { anchors: m.base ?? [], shape: 'area' }
}

/** Centre of a measurement or dimension: its points' centre, a base's area centroid, a prism's centre. */
function anchorCentre(set: AnchorSet, nodes: Nodes): Vec3 | null {
  const points = set.anchors
    .map((anchor) => resolveAnchor(anchor, nodes)?.point)
    .filter((p): p is Vec3 => p !== undefined)
  if (set.shape === 'points') return boundsCentre(points)
  const base = (measurementCentroid(points) as Vec3 | null) ?? boundsCentre(points)
  if (!base || set.shape === 'area' || !set.extrusion) return base
  return [
    base[0] + set.extrusion[0] / 2,
    base[1] + set.extrusion[1] / 2,
    base[2] + set.extrusion[2] / 2,
  ]
}

/**
 * Centre of the geometry a node stores in its own frame, before its transform:
 * mesh vertices, a segment, a path, a polygon or measurement anchors.
 */
function ownGeometryCentre(node: AnyNode, nodes: Nodes): Vec3 | null {
  const n = node as Record<string, unknown>
  if (node.type === 'block') {
    return boundsCentre(node.topology.vertices.map((v) => v.position as Vec3))
  }
  if (node.type === 'imported-mesh') {
    const points: Vec3[] = []
    for (const primitive of node.primitives) {
      for (let i = 0; i + 2 < primitive.positions.length; i += 3) {
        points.push([
          primitive.positions[i]!,
          primitive.positions[i + 1]!,
          primitive.positions[i + 2]!,
        ])
      }
    }
    return boundsCentre(points)
  }
  if (node.type === 'slab') return polygonCentre(node.polygon, node.elevation ?? 0)
  if (node.type === 'site') return polygonCentre(node.polygon?.points, 0)
  if (Array.isArray(n.polygon)) return polygonCentre(n.polygon, 0)
  if (Array.isArray(n.start) && Array.isArray(n.end)) {
    const [x1, z1] = n.start as [number, number]
    const [x2, z2] = n.end as [number, number]
    return [(x1 + x2) / 2, 0, (z1 + z2) / 2]
  }
  if (Array.isArray(n.path)) return boundsCentre((n.path as unknown[]).filter(isVec3))
  const anchors = anchorSet(node)
  return anchors ? anchorCentre(anchors, nodes) : null
}

/**
 * Stair segments render at the attachment chain, not at their stored
 * `position`, so resolve them from the stair frame like the stair system does.
 */
function stairSegmentFrame(node: AnyNode & { type: 'stair-segment' }, nodes: Nodes): Frame | null {
  const stair = node.parentId ? nodes[node.parentId] : undefined
  if (stair?.type !== 'stair') return null
  const segments = (stair.children ?? [])
    .map((id) => nodes[id])
    .filter((n): n is AnyNode & { type: 'stair-segment' } => n?.type === 'stair-segment')
  const index = segments.findIndex((segment) => segment.id === node.id)
  const transform = computeSegmentTransforms(segments)[index]
  if (!transform) return null
  return composeFrames(
    nodeLevelFrame(stair.id, nodes),
    frame(transform.position, [0, transform.rotation, 0]),
  )
}

/**
 * Built-in kinds the viewer lifts onto the slab under them through the
 * `floorPlaced` capability of their registered definition, and whose footprint
 * core cannot derive without it (core derives item, shelf and procedural-item
 * footprints from the node itself). Headless MCP does not load
 * `@pascal-app/nodes`, so their lift is unresolved and flagged, not guessed. A
 * test keeps this list in step with the definitions.
 */
export const HEADLESS_UNRESOLVED_FLOOR_LIFT_KINDS = [
  'block',
  'cabinet',
  'cabinet-module',
  'column',
  'duct-terminal',
  'hvac-equipment',
  'spawn',
  'stair',
] as const

const UNRESOLVED_FLOOR_LIFT = new Set<string>(HEADLESS_UNRESOLVED_FLOOR_LIFT_KINDS)
const CORE_KINDS = new Set<string>(AnyNode.options.map(nodeKindOf))

const FLOOR_LIFT_UNRESOLVED =
  'floor-lift-unresolved-headless: the viewer lifts this onto the slab or ground under it through a node definition this runtime has not registered; the point is on the level plane'

/**
 * The node on a level that carries `node`'s floor lift (itself or the host it
 * sits on), when that lift is resolved by a definition this runtime lacks: a
 * built-in floor-placed kind or a plugin kind, unregistered.
 */
function unresolvedFloorLiftHost(node: AnyNode, nodes: Nodes): AnyNode | undefined {
  const seen = new Set<string>()
  let current: AnyNode | undefined = node
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    const parent: AnyNode | undefined = current.parentId ? nodes[current.parentId] : undefined
    if (parent?.type === 'level') {
      if (nodeRegistry.get(current.type)) return undefined
      const unresolved =
        UNRESOLVED_FLOOR_LIFT.has(current.type) ||
        (!CORE_KINDS.has(current.type) && 'position' in current)
      return unresolved ? current : undefined
    }
    current = parent
  }
  return undefined
}

/**
 * Why a node's point is not where its renderer draws it: kinds whose renderer
 * derives the pose from data this resolver does not model, and floor lifts
 * owned by definitions not registered here. The point is then the stored
 * placement in its host's frame.
 */
function approximationReason(node: AnyNode, nodes: Nodes): string | undefined {
  if (unresolvedFloorLiftHost(node, nodes)) return FLOOR_LIFT_UNRESOLVED
  const anchors = anchorSet(node)
  if (anchors?.anchors.some((anchor) => resolveAnchor(anchor, nodes)?.fallback)) {
    return 'anchor-fallback: an anchor follows a referenced node whose measurement features are not registered here (or the node is gone); its stored fallback point is used'
  }
  const parent = node.parentId ? nodes[node.parentId] : undefined
  switch (node.type) {
    case 'downspout':
      return 'rendered at its gutter outlet below the eave; the point is its gutter or host placement'
    case 'gutter':
      return 'rendered at the roof segment eave height, not its stored height'
    case 'ridge-vent':
      return 'rendered along its roof segment ridge; the point is its stored placement'
    case 'fence':
      return 'floor-lift-unresolved-headless: the fence renderer lifts it onto its host slab or the ground; the point is on the level plane'
    case 'solar-panel':
    case 'skylight':
      return parent?.type === 'roof-segment'
        ? 'roof-surface: the viewer seats it on the finished outer roof surface (deck and shingles); the point is on the structural roof surface'
        : undefined
    case 'door':
    case 'window':
      if (node.roofSegmentId || (node.type === 'window' && node.dormerId)) {
        return 'hosted on a roof-segment or dormer wall face; the point ignores the face frame'
      }
      return undefined
    case 'lean-to-extension':
      return parent?.type === 'wall'
        ? 'placed along its host wall centreline; the point uses a straight wall frame'
        : undefined
    case 'item':
      return node.asset.attachTo === 'wall-side'
        ? 'rendered on the wall face (± half the wall thickness); the point is on the wall centreline'
        : undefined
    default:
      return undefined
  }
}

/**
 * The node's reference point in its level's frame (or in world space when it
 * has no level ancestor), or null for a container with no geometry of its own.
 */
function levelLocalPoint(node: AnyNode, nodes: Nodes): Vec3 | null {
  if (node.type === 'wall') {
    const { point } = getWallCurveFrameAt(node, 0.5)
    return [point.x, nodeLevelFrame(node.id, nodes).position[1], point.y]
  }
  if (node.type === 'fence') {
    // Arc or spline midpoint on the level plane; its lift is flagged.
    const { point } = getFenceCenterlineFrameAt(node, 0.5)
    return [point.x, 0, point.y]
  }
  if (node.type === 'stair-segment') {
    const segmentFrame = stairSegmentFrame(node, nodes)
    if (segmentFrame) return segmentFrame.position
  }
  const parent = node.parentId ? nodes[node.parentId] : undefined
  if (node.type === 'downspout' && node.gutterId && nodes[node.gutterId]?.type === 'gutter') {
    return levelLocalPoint(nodes[node.gutterId]!, nodes)
  }
  if (node.type === 'chimney' && parent?.type === 'roof-segment') {
    // The renderer ignores the stored Y and stands the chimney on the segment base.
    const [x, , z] = node.position
    return transformPoint(nodeLevelFrame(parent.id, nodes), [x, 0, z])
  }
  if (
    (node.type === 'solar-panel' || node.type === 'skylight') &&
    parent?.type === 'roof-segment'
  ) {
    // Both renderers ignore the stored Y and sit on the roof surface; the
    // finished surface (deck and shingles) is the viewer's, so this is flagged.
    const [x, , z] = node.position
    return transformPoint(nodeLevelFrame(parent.id, nodes), [
      x,
      getRoofSegmentSurfaceY(parent, x, z),
      z,
    ])
  }
  const own = nodeLevelFrame(node.id, nodes)
  const geometry = ownGeometryCentre(node, nodes)
  if (geometry) return transformPoint(own, geometry)
  if (isVec3((node as { position?: unknown }).position)) return own.position
  return null
}

function nearestLevelId(node: AnyNode, nodes: Nodes): string | null {
  const seen = new Set<string>()
  let current: AnyNode | undefined = node
  while (current && !seen.has(current.id)) {
    if (current.type === 'level') return current.id
    seen.add(current.id)
    current = current.parentId ? nodes[current.parentId] : undefined
  }
  return null
}

function hostOf(id: string, nodes: Nodes): AnyNode | undefined {
  const node = nodes[id]
  if (node?.parentId) return nodes[node.parentId]
  // The default scene links site → building → level through `children` only.
  return Object.values(nodes).find(
    (candidate) =>
      'children' in candidate &&
      Array.isArray(candidate.children) &&
      (candidate.children as unknown[]).some(
        (child) => child === id || (child as { id?: unknown } | null)?.id === id,
      ),
  )
}

/** A level's frame in world space: its building's transform, then its stacked base Y. */
function levelWorldFrame(levelId: string, nodes: Nodes): Frame {
  const baseY = getLevelElevations(nodes as Record<AnyNodeId, AnyNode>).get(levelId)?.baseY ?? 0
  const host = hostOf(levelId, nodes)
  const hostFrame = host ? nodeLevelFrame(host.id, nodes) : IDENTITY_FRAME
  return composeFrames(hostFrame, frame([0, baseY, 0]))
}

function childIdsOf(id: string, nodes: Nodes): string[] {
  const node = nodes[id]
  const ids = new Set<string>()
  if (node && 'children' in node && Array.isArray(node.children)) {
    for (const child of node.children as unknown[]) {
      const childId = typeof child === 'string' ? child : (child as { id?: unknown } | null)?.id
      if (typeof childId === 'string') ids.add(childId)
    }
  }
  if (node?.type === 'unit') for (const member of node.members) ids.add(member)
  for (const candidate of Object.values(nodes)) {
    if (candidate.parentId === id) ids.add(candidate.id)
  }
  return [...ids].filter((childId) => nodes[childId])
}

/**
 * World-space reference point of any node, following the frames the viewer
 * renders it in (core's `nodeLevelFrame`, the level's stacked base Y and its
 * building transform):
 * - a positioned node: its origin (an item's or column's base, a door's or
 *   window's centre), inside its host's frame;
 * - a wall or fence: the midpoint of its centreline (arc or spline) at its base;
 * - a grid line: its midpoint;
 * - a slab, ceiling, zone or site: its polygon centroid on its own plane;
 * - a block or imported mesh: the centre of its vertex bounds;
 * - a path or measurement: the centre of its points;
 * - a level: the plan centre of its content on its base plane;
 * - another container (a unit, …): the centre of its descendants' points,
 *   or its origin when it has none.
 * Kinds whose renderer derives the pose elsewhere (a downspout at its gutter
 * outlet, a gutter at the eave, …) are returned with an `approximate` reason.
 */
export type NodeWorldPoint = {
  point: Vec3
  /** Set when the renderer derives this kind's pose from data not modelled here. */
  approximate?: string
}

export function resolveNodeWorldPoint(id: string, nodes: Nodes): NodeWorldPoint | null {
  const linked = withParentIds(nodes)
  const point = worldPoint(id, linked, 0)
  if (!point) return null
  const approximate = approximationReason(linked[id]!, linked)
  return approximate ? { point, approximate } : { point }
}

/**
 * `nodes` with every missing `parentId` filled from the parent's `children`
 * array. The frame walk follows `parentId`, but scenes may link a subtree only
 * through `children` (the default site → building → level assembly does), as
 * SceneBridge's ancestry allows. Returns `nodes` itself when nothing is missing.
 */
function withParentIds(nodes: Nodes): Nodes {
  const parentOf = new Map<string, string>()
  for (const node of Object.values(nodes)) {
    if (!('children' in node) || !Array.isArray(node.children)) continue
    for (const child of node.children as unknown[]) {
      const childId = typeof child === 'string' ? child : (child as { id?: unknown } | null)?.id
      if (typeof childId === 'string' && !parentOf.has(childId)) parentOf.set(childId, node.id)
    }
  }
  let linked: Record<string, AnyNode> | null = null
  for (const node of Object.values(nodes)) {
    const parentId = parentOf.get(node.id)
    if (node.parentId || !parentId) continue
    linked ??= { ...nodes }
    linked[node.id] = { ...node, parentId } as AnyNode
  }
  return linked ?? nodes
}

function worldPoint(id: string, nodes: Nodes, depth: number): Vec3 | null {
  const node = nodes[id]
  if (!node || depth > 32) return null
  if (node.type === 'level') {
    return transformPoint(levelWorldFrame(node.id, nodes), levelPlanCentre(node.id, nodes))
  }
  const levelId = nearestLevelId(node, nodes)
  const toWorld = (point: Vec3) =>
    levelId ? transformPoint(levelWorldFrame(levelId, nodes), point) : point

  const local = levelLocalPoint(node, nodes)
  if (local) return toWorld(local)

  const points = childIdsOf(id, nodes)
    .map((childId) => worldPoint(childId, nodes, depth + 1))
    .filter((p): p is Vec3 => p !== null)
  if (points.length > 0) return boundsCentre(points)
  return toWorld(nodeLevelFrame(node.id, nodes).position)
}

/**
 * A level's plan centre on its base plane: the centre of its direct children's
 * level-local points. Read from their stored geometry and own transform only,
 * because resolving every wall's slab support makes a large level take seconds.
 */
function levelPlanCentre(levelId: string, nodes: Nodes): Vec3 {
  const points: Vec3[] = []
  for (const childId of childIdsOf(levelId, nodes)) {
    const child = nodes[childId]!
    const transform = child as { position?: unknown; rotation?: unknown }
    const position = isVec3(transform.position) ? transform.position : ([0, 0, 0] as Vec3)
    const rotation: Vec3 =
      typeof transform.rotation === 'number'
        ? [0, transform.rotation, 0]
        : isVec3(transform.rotation)
          ? transform.rotation
          : [0, 0, 0]
    const geometry = ownGeometryCentre(child, nodes)
    if (geometry) points.push(transformPoint(frame(position, rotation), geometry))
    else if (isVec3(transform.position)) points.push(position)
  }
  const centre = boundsCentre(points)
  return centre ? [centre[0], 0, centre[2]] : [0, 0, 0]
}
