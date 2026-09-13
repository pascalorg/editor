/**
 * The cover-sheet camera pose.
 *
 * A cover shot is a DRAWING, not a screenshot: it must look the same every
 * time the set is regenerated, so it is computed from the model and never
 * from wherever the user happens to have left the camera. The standard pose
 * is "three-quarter view of the front door":
 *
 *   1. the building footprint comes from the walls of the lowest level;
 *   2. exterior walls are the ones sitting on the footprint boundary;
 *   3. the front door is the exterior door nearest the site's front edge
 *      (`site.frontEdge` / `site.polygon`, WS1) — with no site, the door on
 *      the most north-facing exterior wall (world +z is south, so north is
 *      the minimum-z side);
 *   4. the camera stands outside that wall, swung 30° in yaw toward the side
 *      of the wall the door sits on, 25° above the horizon, far enough back
 *      that the whole building bounding sphere fits a 60° frame — the
 *      thumbnail camera's FOV (`thumbnail-generator.tsx`).
 *
 * All pure functions over a node map so the geometry is testable without a
 * scene store.
 */

export type PoseNodes = Record<string, (Record<string, unknown> & { id: string; type: string }) | undefined>

export type Vec3 = [number, number, number]
export type Pose = { position: Vec3; target: Vec3 }

export type Bounds2 = { minX: number; minZ: number; maxX: number; maxZ: number }

const DEFAULT_WALL_HEIGHT_M = 2.7
const YAW_DEG = 30
const ELEVATION_DEG = 25
const THUMBNAIL_FOV_DEG = 60
/** A little air around the bounding sphere so the building never kisses the frame. */
const FIT_MARGIN = 1.15

type Wall = {
  id: string
  levelId: string
  start: [number, number]
  end: [number, number]
  height: number
}

export function collectWalls(nodes: PoseNodes, levelId?: string): Wall[] {
  const out: Wall[] = []
  for (const node of Object.values(nodes)) {
    if (!node || node.type !== 'wall') continue
    const parentId = typeof node.parentId === 'string' ? node.parentId : ''
    if (levelId && parentId !== levelId) continue
    const start = node.start as [number, number] | undefined
    const end = node.end as [number, number] | undefined
    if (!Array.isArray(start) || !Array.isArray(end)) continue
    out.push({
      id: node.id,
      levelId: parentId,
      start: [start[0], start[1]],
      end: [end[0], end[1]],
      height: typeof node.height === 'number' ? node.height : DEFAULT_WALL_HEIGHT_M,
    })
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

export function lowestLevelId(nodes: PoseNodes): string | undefined {
  const levels = Object.values(nodes).filter((n) => n?.type === 'level')
  if (levels.length === 0) return undefined
  levels.sort((a, b) => (((a?.level as number) ?? 0) - ((b?.level as number) ?? 0)))
  return levels[0]?.id
}

export function wallBounds(walls: readonly Wall[]): Bounds2 | null {
  if (walls.length === 0) return null
  let minX = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxZ = -Infinity
  for (const w of walls) {
    for (const [x, z] of [w.start, w.end]) {
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minZ = Math.min(minZ, z)
      maxZ = Math.max(maxZ, z)
    }
  }
  return { minX, minZ, maxX, maxZ }
}

/**
 * Exterior = the wall's midpoint sits on the footprint boundary. A tolerance
 * of 12% of the smaller footprint dimension (never below 0.6 m) keeps bay
 * windows and slightly inset front walls in, and interior partitions out.
 * Stated plainly: this is a heuristic, not a topological outside test — a
 * courtyard house's courtyard walls would read as interior.
 */
export function isExteriorWall(wall: Wall, bounds: Bounds2): boolean {
  const mid = midpoint(wall)
  const spanX = bounds.maxX - bounds.minX
  const spanZ = bounds.maxZ - bounds.minZ
  const tol = Math.max(0.6, Math.min(spanX, spanZ) * 0.12)
  return (
    Math.abs(mid[0] - bounds.minX) <= tol ||
    Math.abs(mid[0] - bounds.maxX) <= tol ||
    Math.abs(mid[1] - bounds.minZ) <= tol ||
    Math.abs(mid[1] - bounds.maxZ) <= tol
  )
}

function midpoint(w: Wall): [number, number] {
  return [(w.start[0] + w.end[0]) / 2, (w.start[1] + w.end[1]) / 2]
}

/**
 * World XZ of a door/window hosted on a wall. `position[0]` is the distance
 * from the wall's START along its direction — the same expression the host's
 * own plan code uses (`buildOpeningMarkAnnotation` in
 * `packages/nodes/src/shared/opening-documentation.ts`), not an offset from
 * the midpoint.
 */
export function openingWorldPoint(
  opening: Record<string, unknown>,
  wall: Wall,
): [number, number] {
  const p = opening.position as [number, number, number] | undefined
  const u = Array.isArray(p) && typeof p[0] === 'number' ? p[0] : 0
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const len = Math.hypot(dx, dz) || 1
  return [wall.start[0] + (dx / len) * u, wall.start[1] + (dz / len) * u]
}

/** Unit normal of a wall pointing AWAY from a reference point (the centroid). */
export function outwardNormal(wall: Wall, away: [number, number]): [number, number] {
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const len = Math.hypot(dx, dz) || 1
  let nx = -dz / len
  let nz = dx / len
  const mid = midpoint(wall)
  if ((mid[0] - away[0]) * nx + (mid[1] - away[1]) * nz < 0) {
    nx = -nx
    nz = -nz
  }
  return [nx, nz]
}

/**
 * The site's street-facing edge midpoint, when WS1 resolved one. `frontEdge`
 * indexes `site.polygon.points`; absent, the most north-facing edge (world +z
 * is south) is used, matching the site contract's own wording.
 */
export function siteFrontPoint(nodes: PoseNodes): [number, number] | null {
  const site = Object.values(nodes).find((n) => n?.type === 'site')
  const polygon = site?.polygon as { points?: [number, number][] } | undefined
  const points = polygon?.points
  if (!Array.isArray(points) || points.length < 3) return null
  const index =
    typeof site?.frontEdge === 'number'
      ? (site.frontEdge as number) % points.length
      : mostNorthEdge(points)
  const a = points[index]
  const b = points[(index + 1) % points.length]
  if (!a || !b) return null
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
}

function mostNorthEdge(points: readonly [number, number][]): number {
  let best = 0
  let bestZ = Infinity
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    if (!a || !b) continue
    const z = (a[1] + b[1]) / 2
    if (z < bestZ) {
      bestZ = z
      best = i
    }
  }
  return best
}

export type FrontDoor = {
  doorId: string
  wall: Wall
  point: [number, number]
  normal: [number, number]
}

/** The exterior door the cover shot should face. */
export function findFrontDoor(nodes: PoseNodes, levelId?: string): FrontDoor | null {
  const level = levelId ?? lowestLevelId(nodes)
  const walls = collectWalls(nodes, level)
  const bounds = wallBounds(walls)
  if (!bounds) return null
  const centroid: [number, number] = [
    (bounds.minX + bounds.maxX) / 2,
    (bounds.minZ + bounds.maxZ) / 2,
  ]
  const byId = new Map(walls.map((w) => [w.id, w]))
  const front = siteFrontPoint(nodes)

  const candidates: (FrontDoor & { score: number })[] = []
  for (const node of Object.values(nodes)) {
    if (!node || node.type !== 'door') continue
    const wallId = typeof node.wallId === 'string' ? node.wallId : (node.parentId as string)
    const wall = byId.get(wallId)
    if (!wall || !isExteriorWall(wall, bounds)) continue
    const point = openingWorldPoint(node, wall)
    const normal = outwardNormal(wall, centroid)
    // Nearest the street when we know where the street is; otherwise the
    // most north-facing door (world +z is south).
    const score = front ? Math.hypot(point[0] - front[0], point[1] - front[1]) : point[1]
    candidates.push({ doorId: node.id, wall, point, normal, score })
  }
  if (candidates.length === 0) return null
  candidates.sort((a, b) => a.score - b.score || a.doorId.localeCompare(b.doorId))
  const best = candidates[0]
  if (!best) return null
  return { doorId: best.doorId, wall: best.wall, point: best.point, normal: best.normal }
}

/**
 * The standard cover pose. With no walls at all there is nothing to frame and
 * the caller should skip the capture — hence `null`.
 */
export function coverFrontPose(nodes: PoseNodes, levelId?: string): Pose | null {
  const level = levelId ?? lowestLevelId(nodes)
  const walls = collectWalls(nodes, level)
  const bounds = wallBounds(collectWalls(nodes))
  if (!bounds || walls.length === 0) return null

  const centre: [number, number] = [
    (bounds.minX + bounds.maxX) / 2,
    (bounds.minZ + bounds.maxZ) / 2,
  ]
  const height = Math.max(...collectWalls(nodes).map((w) => w.height), DEFAULT_WALL_HEIGHT_M)
  const door = findFrontDoor(nodes, level)

  // View direction, in plan: straight out of the front wall, or — with no
  // front door to find — from the north-west so the building reads in three
  // quarters rather than flat-on.
  let dir: [number, number] = door ? door.normal : [-0.7071, -0.7071]
  if (door) {
    // Swing toward the side of the wall the door sits on so the entry stays
    // visible rather than being hidden by the wall's own foreshortening.
    const mid: [number, number] = [
      (door.wall.start[0] + door.wall.end[0]) / 2,
      (door.wall.start[1] + door.wall.end[1]) / 2,
    ]
    const along = [door.wall.end[0] - mid[0], door.wall.end[1] - mid[1]] as [number, number]
    const offset = (door.point[0] - mid[0]) * along[0] + (door.point[1] - mid[1]) * along[1]
    const sign = offset >= 0 ? 1 : -1
    dir = rotate2(dir, (sign * YAW_DEG * Math.PI) / 180)
  }

  const spanX = bounds.maxX - bounds.minX
  const spanZ = bounds.maxZ - bounds.minZ
  const radius = Math.max(0.5 * Math.hypot(spanX, spanZ, height), 2)
  const distance = (radius / Math.sin((THUMBNAIL_FOV_DEG * Math.PI) / 360)) * FIT_MARGIN

  const el = (ELEVATION_DEG * Math.PI) / 180
  const horizontal = Math.cos(el) * distance
  const target: Vec3 = [centre[0], height / 2, centre[1]]
  const position: Vec3 = [
    target[0] + dir[0] * horizontal,
    target[1] + Math.sin(el) * distance,
    target[2] + dir[1] * horizontal,
  ]
  // Walls are LEVEL-LOCAL; the camera lives in WORLD (site) space, where the
  // building sits at `building.position` turned by its yaw. Without this the
  // shot framed the level origin, and a house sited on its lot drifted out of
  // the corner of its own cover picture.
  const frame = buildingFrame(nodes, level)
  return { position: round3(frame(position)), target: round3(frame(target)) }
}

/** Level-local `[x, y, z]` → world, through the building that owns `levelId`. */
function buildingFrame(nodes: PoseNodes, levelId: string | undefined): (v: Vec3) => Vec3 {
  const level = levelId ? nodes[levelId] : undefined
  const parentId = typeof level?.parentId === 'string' ? level.parentId : null
  const building =
    (parentId ? nodes[parentId] : undefined) ??
    Object.values(nodes).find((n) => n?.type === 'building')
  if (!building || building.type !== 'building') return (v) => v
  const p = Array.isArray(building.position) ? (building.position as number[]) : [0, 0, 0]
  const r = Array.isArray(building.rotation) ? (building.rotation as number[]) : [0, 0, 0]
  const yaw = typeof r[1] === 'number' ? r[1] : 0
  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)
  const [px, py, pz] = [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0]
  // three.js rotation about +Y (the convention BuildingRenderer applies).
  return ([x, y, z]) => [px + x * cos + z * sin, py + y, pz - x * sin + z * cos]
}

function rotate2(v: [number, number], radians: number): [number, number] {
  const c = Math.cos(radians)
  const s = Math.sin(radians)
  return [v[0] * c - v[1] * s, v[0] * s + v[1] * c]
}

function round3(v: Vec3): Vec3 {
  return [round(v[0]), round(v[1]), round(v[2])]
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000
}
