/**
 * SITE ⇄ BUILDING-LOCAL frame conversion.
 *
 * WHY THIS EXISTS (read this before changing a coordinate anywhere in the
 * package). Utility nodes store SITE coordinates — x east, z south, y
 * elevation, origin the geocoded point — because that is the frame the site
 * plan, the parcel ring and the setback envelope live in (WS1 contract,
 * docs/construction-documents.md).
 *
 * But every surface that can actually DRAW them today is building-local:
 *   - 3D: `BuildingRenderer` (packages/nodes/src/building/renderer.tsx:16)
 *     mounts a `<group position={node.position} rotation={node.rotation}>`
 *     and renders `node.children` inside it, so a child's own coordinates
 *     are building-local. `LevelRenderer` adds NO transform of its own.
 *   - 2D floor plan: `FloorplanRegistryLayer` walks the ACTIVE LEVEL's
 *     subtree (plus `floorplanScope: 'building'` kinds parented to that
 *     level's building) and draws in level/building-local metres.
 *
 * So the kinds are parented to the BUILDING (`floorplanScope: 'building'`,
 * which makes them appear on every level's plan, not just one storey) and
 * both builders convert site → building-local through here.
 *
 * Rotation convention: three.js rotates about +Y as
 *   world.x = px + lx·cos + lz·sin
 *   world.z = pz − lx·sin + lz·cos
 * which is what the 3D scene actually does, so it is the convention used
 * here. NOTE (defect, not papered over): WS1's `levelFootprintLoops`
 * (packages/editor/src/lib/floorplan/site-plan/build-site-plan-drawing.ts:151)
 * uses the OPPOSITE sign — `[ox + x·cos − z·sin, oz + x·sin + z·cos]` — i.e.
 * a rotation by −yaw. The two agree only at yaw 0. One of them is wrong for
 * a rotated building; this package matches the 3D renderer, which is the
 * ground truth.
 */

export type LooseNode = Record<string, unknown>
export type LooseNodes = Readonly<Record<string, LooseNode>>

export type BuildingFrame = {
  id: string | null
  /** Building origin in site metres. */
  origin: [number, number, number]
  /** Building yaw about +Y, radians. */
  yaw: number
}

export const IDENTITY_FRAME: BuildingFrame = { id: null, origin: [0, 0, 0], yaw: 0 }

const asTriple = (value: unknown): [number, number, number] | null => {
  if (!Array.isArray(value) || value.length < 3) return null
  const [x, y, z] = value
  return typeof x === 'number' && typeof y === 'number' && typeof z === 'number' ? [x, y, z] : null
}

/** The building frame for a node parented to a building (or to one of its levels). */
export function buildingFrameOf(nodes: LooseNodes, building: LooseNode | null): BuildingFrame {
  if (!building) return IDENTITY_FRAME
  const origin = asTriple(building.position) ?? [0, 0, 0]
  const rotation = asTriple(building.rotation)
  return {
    id: typeof building.id === 'string' ? building.id : null,
    origin,
    yaw: rotation ? rotation[1] : 0,
  }
}

/** Walk up `parentId` until a `building` node is found. */
export function findBuildingAncestor(nodes: LooseNodes, startId: string | null): LooseNode | null {
  let cursor: string | null = startId
  for (let guard = 0; cursor && guard < 32; guard++) {
    const node: LooseNode | undefined = nodes[cursor]
    if (!node) return null
    if (node.type === 'building') return node
    cursor = typeof node.parentId === 'string' ? node.parentId : null
  }
  return null
}

/** First `building` node in the scene — the fallback when a node is unparented. */
export function findAnyBuilding(nodes: LooseNodes): LooseNode | null {
  for (const node of Object.values(nodes)) {
    if (node?.type === 'building') return node
  }
  return null
}

/** The frame a utility node should be drawn in, resolved from its parent chain. */
export function resolveFrame(nodes: LooseNodes, node: LooseNode): BuildingFrame {
  const parentId = typeof node.parentId === 'string' ? node.parentId : null
  const building = findBuildingAncestor(nodes, parentId) ?? findAnyBuilding(nodes)
  return buildingFrameOf(nodes, building)
}

/**
 * The frame, resolved through a `GeometryContext`-style `resolve` callback
 * instead of a node map. Walks `parentId` from `startId` to the first
 * `building`. Used by `def.floorplan` builders, which are handed `resolve`
 * rather than the scene.
 */
export function resolveFrameVia(
  resolve: (id: string) => LooseNode | undefined,
  startId: string | null | undefined,
): BuildingFrame {
  let cursor: string | null = startId ?? null
  for (let guard = 0; typeof cursor === 'string' && guard < 32; guard++) {
    const node: LooseNode | undefined = resolve(cursor)
    if (!node) break
    if (node.type === 'building') return buildingFrameOf({}, node)
    cursor = typeof node.parentId === 'string' ? node.parentId : null
  }
  return IDENTITY_FRAME
}

/** SITE `[x, y, z]` → building-local `[x, y, z]`. */
export function siteToLocal(
  frame: BuildingFrame,
  point: readonly [number, number, number],
): [number, number, number] {
  const dx = point[0] - frame.origin[0]
  const dz = point[2] - frame.origin[2]
  const cos = Math.cos(frame.yaw)
  const sin = Math.sin(frame.yaw)
  // Inverse of world = origin + Ry(yaw)·local.
  return [dx * cos - dz * sin, point[1] - frame.origin[1], dx * sin + dz * cos]
}

/** Building-local `[x, y, z]` → SITE `[x, y, z]`. */
export function localToSite(
  frame: BuildingFrame,
  point: readonly [number, number, number],
): [number, number, number] {
  const cos = Math.cos(frame.yaw)
  const sin = Math.sin(frame.yaw)
  return [
    frame.origin[0] + point[0] * cos + point[2] * sin,
    frame.origin[1] + point[1],
    frame.origin[2] - point[0] * sin + point[2] * cos,
  ]
}

/** SITE plan `[x, z]` → building-local plan `[x, z]` (the 2D floor-plan frame). */
export function siteToLocalPlan(
  frame: BuildingFrame,
  point: readonly [number, number],
): [number, number] {
  const local = siteToLocal(frame, [point[0], 0, point[1]])
  return [local[0], local[2]]
}

/** Building-local plan `[x, z]` → SITE plan `[x, z]`. */
export function localToSitePlan(
  frame: BuildingFrame,
  point: readonly [number, number],
): [number, number] {
  const site = localToSite(frame, [point[0], 0, point[1]])
  return [site[0], site[2]]
}
