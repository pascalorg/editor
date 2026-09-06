/**
 * Fire separation distance — IRC R302.1 / Table R302.1(1), measured the way
 * R202 defines it: at a right angle from the face of each exterior wall to
 * the closest interior lot line (or to the centreline of the street when
 * the wall faces the street). Everything here is read off the scene as it
 * stands — the site ring, the building's placement, the walls' faces, the
 * roof overhang, the openings in the wall — so a house moved on its lot
 * re-rates on the next draw; nothing is written back to the scene.
 *
 * The rules applied (2021 IRC Table R302.1(1)):
 *   walls        < 5 ft  1-hour, tested from both sides
 *   projections  < 2 ft  not permitted;  2 ft to < 5 ft  1-hour on the underside
 *   openings     < 3 ft  not permitted;  3 ft to < 5 ft  25% of the wall area max
 *   penetrations < 3 ft  per R302.4
 * R302.1 exception 1 (walls perpendicular to the lot line) is inherent in
 * the right-angle measurement: a wall square to the side line casts to the
 * rear or front line, never to the side.
 */
import type { FloorplanGeometry } from '@pascal-app/core'
import type { AnyNodeLike, NodeMap } from '../model'

export type Pt = readonly [number, number]

const FT = 0.3048
const RATED_LIMIT = 5 * FT
const PROJECTION_LIMIT = 2 * FT
const OPENING_LIMIT = 3 * FT

export type LotEdgeRole = 'front' | 'rear' | 'left' | 'right'

export interface FireSeparationWall {
  wallId: string
  /** The wall's own name (generated walls: "Exterior wall"), for the row. */
  name: string
  /** Compass direction the outer face looks toward (site north honoured). */
  faces: string
  /** Gable end or eave side, when the wall says which (metadata.roof.role). */
  roofRole: string | null
  /** Outer face in LEVEL-LOCAL plan metres (x, z) — where the plan mark goes. */
  face: [Pt, Pt]
  /** +1 when the left normal of `face` (start → end) points out of the building, −1 when the right one does. */
  faceOut: 1 | -1
  /** Metres to the lot line, at a right angle from the face — the least along the face. `null` when the cast never meets the ring. */
  distance: number | null
  /** Which lot edge the cast met. */
  edge: LotEdgeRole | null
  /** The face looks at the street: R202 measures to the street centreline, so the lot-line figure is a lower bound. */
  toStreet: boolean
  /** How far the roof (eave, rake or a porch roof) projects past the face, metres. */
  projection: number
  /** What projects: the main roof's eave/rake, or a porch (deck) roof hung off the wall. */
  projectionKind: 'eave' | 'porch'
  /** `distance − projection`, the projection's own fire separation distance. */
  projectionDistance: number | null
  /** Openings (doors + windows) in the wall, gross area, and the wall's gross area. */
  openings: number
  openingArea: number
  wallArea: number
  /** What Table R302.1(1) asks of the wall, the projection, the openings. */
  wallRule: 'rated' | 'none'
  projectionRule: 'not-permitted' | 'rated-underside' | 'none'
  openingRule: 'not-permitted' | 'limit-25' | 'unlimited'
  /** Where the wall as drawn does not meet the rule it falls under. */
  issues: string[]
}

export interface FireSeparation {
  /** The site has a lot ring and the level has exterior walls to measure. */
  measured: boolean
  walls: FireSeparationWall[]
  /** Ids of the walls Table R302.1(1) rates — what the plan marks and the assembly schedule read. */
  rated: Set<string>
  caveats: string[]
}

/* ------------------------------------------------------------ geometry */

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function pt(v: unknown): Pt | null {
  return Array.isArray(v) && v.length >= 2 && Number.isFinite(v[0]) && Number.isFinite(v[1])
    ? [Number(v[0]), Number(v[1])]
    : null
}

function isCounterClockwise(points: readonly Pt[]): boolean {
  let a = 0
  for (let i = 0, n = points.length; i < n; i++) {
    const p = points[i] as Pt
    const q = points[(i + 1) % n] as Pt
    a += p[0] * q[1] - q[0] * p[1]
  }
  return a > 0
}

function outwardNormal(points: readonly Pt[], i: number): Pt {
  const n = points.length
  const p = points[i % n] as Pt
  const q = points[(i + 1) % n] as Pt
  const dx = q[0] - p[0]
  const dy = q[1] - p[1]
  const len = Math.hypot(dx, dy) || 1
  const sign = isCounterClockwise(points) ? -1 : 1
  return [(sign * -dy) / len, (sign * dx) / len]
}

/**
 * The edges of the lot classified front / rear / left / right the way the
 * site plan does (`classifyEdges` in the editor's site-plan geometry): the
 * front is the site's `frontEdge`, the rear the edge facing most nearly
 * opposite, the rest are sides.
 */
export function lotEdgeRoles(points: readonly Pt[], frontIndex: number): LotEdgeRole[] {
  const n = points.length
  const roles: LotEdgeRole[] = new Array(n).fill('left')
  if (n === 0) return roles
  const front = ((frontIndex % n) + n) % n
  const fn = outwardNormal(points, front)
  let rear = -1
  let rearDot = Number.POSITIVE_INFINITY
  for (let i = 0; i < n; i++) {
    if (i === front) continue
    const ni = outwardNormal(points, i)
    const dot = fn[0] * ni[0] + fn[1] * ni[1]
    if (dot < rearDot) {
      rearDot = dot
      rear = i
    }
  }
  const fp = points[front] as Pt
  const fq = points[(front + 1) % n] as Pt
  const dx = fq[0] - fp[0]
  const dy = fq[1] - fp[1]
  const len = Math.hypot(dx, dy) || 1
  const fmx = (fp[0] + fq[0]) / 2
  const fmy = (fp[1] + fq[1]) / 2
  for (let i = 0; i < n; i++) {
    if (i === front) roles[i] = 'front'
    else if (i === rear) roles[i] = 'rear'
    else {
      const p = points[i] as Pt
      const q = points[(i + 1) % n] as Pt
      const mx = (p[0] + q[0]) / 2 - fmx
      const my = (p[1] + q[1]) / 2 - fmy
      roles[i] = (mx * (dx / len) + my * (dy / len)) < 0 ? 'left' : 'right'
    }
  }
  return roles
}

/** Distance along the unit direction from `origin` to the first lot edge crossed, and which edge. */
export function castToRing(
  ring: readonly Pt[],
  origin: Pt,
  dx: number,
  dy: number,
): { distance: number; edge: number } | null {
  let best: { distance: number; edge: number } | null = null
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i] as Pt
    const q = ring[(i + 1) % n] as Pt
    const ex = q[0] - p[0]
    const ey = q[1] - p[1]
    const denom = dx * ey - dy * ex
    if (Math.abs(denom) < 1e-12) continue
    const t = ((p[0] - origin[0]) * ey - (p[1] - origin[1]) * ex) / denom
    const u = ((p[0] - origin[0]) * dy - (p[1] - origin[1]) * dx) / denom
    if (t <= 1e-9 || u < -1e-9 || u > 1 + 1e-9) continue
    if (!best || t < best.distance) best = { distance: t, edge: i }
  }
  return best
}

function pointInRing(ring: readonly Pt[], x: number, y: number): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i] as Pt
    const b = ring[j] as Pt
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) {
      inside = !inside
    }
  }
  return inside
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']

/** Compass label of a site-frame direction; plan up (−y) is north before the site's north rotation. */
function compass(dx: number, dy: number, northRotation: number): string {
  const raw = Math.atan2(dx, -dy) - northRotation
  const deg = (((raw * 180) / Math.PI) % 360 + 360) % 360
  return COMPASS[Math.round(deg / 22.5) % 16] as string
}

/* --------------------------------------------------------------- walls */

/** A wall the scene marks as exterior — by the generator's role, a drawn wall's sides, or its exterior wall type. */
export function isExteriorWall(wall: AnyNodeLike): boolean {
  const meta = isObj(wall.metadata) ? wall.metadata : {}
  return (
    meta.role === 'exterior' ||
    wall.frontSide === 'exterior' ||
    wall.backSide === 'exterior' ||
    meta.wallType === 'ext2x6'
  )
}

function wallsOf(nodes: NodeMap, levelId: string | undefined): AnyNodeLike[] {
  return Object.values(nodes).filter(
    (n) => n?.type === 'wall' && (!levelId || n.parentId === levelId) && n.visible !== false,
  )
}

/** The lowest level in the scene — the one that stands on the lot. */
function lowestLevelId(nodes: NodeMap): string | undefined {
  const levels = Object.values(nodes).filter((n) => n?.type === 'level')
  levels.sort((a, b) => ((a.level as number) ?? 0) - ((b.level as number) ?? 0))
  return levels[0]?.id
}

/** The largest floor slab on the level, when there is one — the footprint the outward side of a wall is judged against. */
function floorRing(nodes: NodeMap, levelId: string): Pt[] | null {
  let best: { ring: Pt[]; area: number } | null = null
  for (const n of Object.values(nodes)) {
    if (n?.type !== 'slab' || n.parentId !== levelId) continue
    const meta = isObj(n.metadata) ? n.metadata : {}
    if (isObj(meta.porch)) continue
    const ring = (Array.isArray(n.polygon) ? n.polygon : []).map(pt).filter((p): p is Pt => !!p)
    if (ring.length < 3) continue
    let a = 0
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i] as Pt
      const q = ring[(i + 1) % ring.length] as Pt
      a += p[0] * q[1] - q[0] * p[1]
    }
    const area = Math.abs(a / 2)
    if (!best || area > best.area) best = { ring, area }
  }
  return best?.ring ?? null
}

/**
 * How far the roof over this level projects past a wall face, along the
 * face's outward normal: the main roof's overhang (eave and rake alike —
 * the editor's roof carries one overhang), or further where a porch roof
 * segment hangs off the wall. The segment's rectangle (position, rotation,
 * width × depth, plus its overhang) is measured from the face.
 */
function projectionPast(
  nodes: NodeMap,
  levelId: string,
  faceMid: Pt,
  nx: number,
  nz: number,
  ux: number,
  uz: number,
  halfLength: number,
): { projection: number; kind: 'eave' | 'porch' } {
  let main = 0
  let porch = 0
  for (const n of Object.values(nodes)) {
    if (n?.type !== 'roof-segment') continue
    const roof = typeof n.parentId === 'string' ? nodes[n.parentId] : undefined
    if (!roof || roof.parentId !== levelId) continue
    const overhang = typeof n.overhang === 'number' ? n.overhang : 0
    const meta = isObj(n.metadata) ? n.metadata : {}
    const role = isObj(meta.roof) ? meta.roof.role : undefined
    if (role !== 'porch') {
      main = Math.max(main, overhang)
      continue
    }
    const pos = Array.isArray(n.position) ? n.position : [0, 0, 0]
    const cx = Number(pos[0]) || 0
    const cz = Number(pos[2]) || 0
    const rot = typeof n.rotation === 'number' ? n.rotation : 0
    const hw = ((typeof n.width === 'number' ? n.width : 0) / 2) + overhang
    const hd = ((typeof n.depth === 'number' ? n.depth : 0) / 2) + overhang
    const c = Math.cos(rot)
    const s = Math.sin(rot)
    let out = 0
    let across = false
    for (const [lx, lz] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]] as const) {
      // three.js Y rotation: +x → (cos, −sin)
      const x = cx + lx * c + lz * s
      const z = cz - lx * s + lz * c
      out = Math.max(out, (x - faceMid[0]) * nx + (z - faceMid[1]) * nz)
      if (Math.abs((x - faceMid[0]) * ux + (z - faceMid[1]) * uz) <= halfLength + 0.3) across = true
    }
    // a porch roof that reaches past this face and overlaps it along its length hangs off it
    if (across && out > 0.05) porch = Math.max(porch, out)
  }
  return porch > main ? { projection: porch, kind: 'porch' } : { projection: main, kind: 'eave' }
}

/* --------------------------------------------------------------- rules */

function feetIn(m: number): string {
  const inches = Math.floor((m / FT) * 12 + 1e-6)
  return `${Math.floor(inches / 12)}'-${inches % 12}"`
}

/** `24'-6"`, rounded DOWN to the inch — the short side of a fire separation distance is the safe side; a negative reads `−2'-3"`. */
export function formatSeparation(m: number): string {
  return m < 0 ? `−${feetIn(-m)}` : feetIn(m)
}

/**
 * Measure every exterior wall of the level (the lowest level when none is
 * named) against the lot ring, and say what Table R302.1(1) asks of each.
 */
export function fireSeparation(nodes: NodeMap, levelId?: string): FireSeparation {
  const caveats: string[] = []
  const site = Object.values(nodes).find((n) => n?.type === 'site')
  const ring = ((isObj(site?.polygon) && Array.isArray(site.polygon.points) ? site.polygon.points : []) as unknown[])
    .map(pt)
    .filter((p): p is Pt => !!p)
  const level = levelId ?? lowestLevelId(nodes)
  if (!site || ring.length < 3 || !level) {
    caveats.push('No lot ring on the site — fire separation distances (R302.1) were not measured.')
    return { measured: false, walls: [], rated: new Set(), caveats }
  }
  const walls = wallsOf(nodes, level).filter(isExteriorWall)
  if (walls.length === 0) {
    caveats.push('No exterior walls identified on this level — fire separation distances (R302.1) were not measured.')
    return { measured: false, walls: [], rated: new Set(), caveats }
  }

  const levelNode = nodes[level]
  const building = typeof levelNode?.parentId === 'string' ? nodes[levelNode.parentId] : undefined
  const bpos = Array.isArray(building?.position) ? building.position : [0, 0, 0]
  const ox = Number(bpos[0]) || 0
  const oz = Number(bpos[2]) || 0
  const yaw = Array.isArray(building?.rotation) ? Number(building.rotation[1]) || 0 : 0
  const cy = Math.cos(yaw)
  const sy = Math.sin(yaw)
  // level-local → site: world = position + R(yaw)·local, +x → (cos, −sin) (three.js)
  const toSite = (p: Pt): Pt => [ox + p[0] * cy + p[1] * sy, oz - p[0] * sy + p[1] * cy]
  const dirToSite = (dx: number, dz: number): Pt => [dx * cy + dz * sy, -dx * sy + dz * cy]
  const northRotation = typeof site.northRotation === 'number' ? site.northRotation : 0
  const frontEdge = typeof site.frontEdge === 'number' ? site.frontEdge : 0
  const roles = lotEdgeRoles(ring, frontEdge)
  const floor = floorRing(nodes, level)
  const levelHeight = typeof levelNode?.height === 'number' ? levelNode.height : 2.7432

  // the footprint's centre, the fallback for "which side is out"
  let cxSum = 0
  let czSum = 0
  for (const w of walls) {
    const a = pt(w.start)
    const b = pt(w.end)
    if (a && b) {
      cxSum += (a[0] + b[0]) / 2
      czSum += (a[1] + b[1]) / 2
    }
  }
  const centre: Pt = [cxSum / walls.length, czSum / walls.length]

  const out: FireSeparationWall[] = []
  const rated = new Set<string>()
  for (const wall of walls) {
    const a = pt(wall.start)
    const b = pt(wall.end)
    if (!a || !b) continue
    const length = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (length < 1e-6) continue
    const ux = (b[0] - a[0]) / length
    const uz = (b[1] - a[1]) / length
    let nx = -uz
    let nz = ux
    const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    const half = ((typeof wall.thickness === 'number' ? wall.thickness : 0.15) || 0.15) / 2
    // the outward side: off the floor slab when there is one, else away from the footprint's centre
    const probe = half + 0.25
    const outward = floor
      ? !pointInRing(floor, mid[0] + nx * probe, mid[1] + nz * probe) &&
        pointInRing(floor, mid[0] - nx * probe, mid[1] - nz * probe)
        ? 1
        : pointInRing(floor, mid[0] + nx * probe, mid[1] + nz * probe) &&
            !pointInRing(floor, mid[0] - nx * probe, mid[1] - nz * probe)
          ? -1
          : (mid[0] - centre[0]) * nx + (mid[1] - centre[1]) * nz >= 0
            ? 1
            : -1
      : (mid[0] - centre[0]) * nx + (mid[1] - centre[1]) * nz >= 0
        ? 1
        : -1
    nx *= outward
    nz *= outward
    const face: [Pt, Pt] = [
      [a[0] + nx * half, a[1] + nz * half],
      [b[0] + nx * half, b[1] + nz * half],
    ]
    const [dx, dz] = dirToSite(nx, nz)

    // the least distance along the face, cast at right angles to it
    let distance: number | null = null
    let edge: number | null = null
    const samples = 24
    for (let i = 0; i <= samples; i++) {
      const t = i / samples
      const p: Pt = [face[0][0] + (face[1][0] - face[0][0]) * t, face[0][1] + (face[1][1] - face[0][1]) * t]
      const hit = castToRing(ring, toSite(p), dx, dz)
      if (hit && (distance === null || hit.distance < distance)) {
        distance = hit.distance
        edge = hit.edge
      }
    }
    const role = edge === null ? null : (roles[edge] ?? null)
    const toStreet = role === 'front'
    const faceMid: Pt = [mid[0] + nx * half, mid[1] + nz * half]
    const projected = projectionPast(nodes, level, faceMid, nx, nz, ux, uz, length / 2)
    const projection = projected.projection
    const projectionDistance = distance === null ? null : distance - projection

    // openings in the wall
    let openings = 0
    let openingArea = 0
    for (const id of Array.isArray(wall.children) ? wall.children : []) {
      const child = nodes[id as string]
      if (!child || (child.type !== 'door' && child.type !== 'window') || child.visible === false) continue
      const w = typeof child.width === 'number' ? child.width : 0
      const h = typeof child.height === 'number' ? child.height : 0
      openings += 1
      openingArea += w * h
    }
    const wallArea = length * levelHeight

    const issues: string[] = []
    // a street face is measured to the centreline (R202): the lot line is a lower bound, so ≥ 5 ft there settles it
    const d = distance
    const wallRule: FireSeparationWall['wallRule'] = d !== null && d < RATED_LIMIT && !toStreet ? 'rated' : 'none'
    const projectionRule: FireSeparationWall['projectionRule'] =
      projectionDistance === null || toStreet
        ? 'none'
        : projectionDistance < PROJECTION_LIMIT
          ? 'not-permitted'
          : projectionDistance < RATED_LIMIT
            ? 'rated-underside'
            : 'none'
    const openingRule: FireSeparationWall['openingRule'] =
      d === null || toStreet ? 'unlimited' : d < OPENING_LIMIT ? 'not-permitted' : d < RATED_LIMIT ? 'limit-25' : 'unlimited'
    if (d === null) issues.push('the cast from this face never meets the lot ring — is the building on the lot?')
    if (toStreet && d !== null && d < RATED_LIMIT)
      issues.push(`${feetIn(d)} to the street line — R202 measures to the street centreline; confirm the right-of-way width`)
    if (projectionRule === 'not-permitted') {
      const what = projected.kind === 'porch' ? 'the porch roof' : 'the eave'
      const pd = projectionDistance ?? 0
      issues.push(
        pd < 0
          ? `${what} crosses the lot line by ${feetIn(-pd)} — a projection under 2 ft is not permitted (Table R302.1(1))`
          : `${what} comes to ${feetIn(pd)} of the lot line — a projection under 2 ft is not permitted (Table R302.1(1))`,
      )
    }
    if (openingRule === 'not-permitted' && openings > 0)
      issues.push(`${openings} opening${openings === 1 ? '' : 's'} in a wall under 3 ft from the lot line — not permitted (Table R302.1(1))`)
    if (openingRule === 'limit-25' && wallArea > 0 && openingArea / wallArea > 0.25)
      issues.push(`openings are ${Math.round((openingArea / wallArea) * 100)}% of the wall — 25% is the limit between 3 and 5 ft (Table R302.1(1))`)
    if (wallRule === 'rated') rated.add(wall.id)

    const meta = isObj(wall.metadata) ? wall.metadata : {}
    const roofRole = isObj(meta.roof) && typeof meta.roof.role === 'string' ? meta.roof.role : null
    out.push({
      wallId: wall.id,
      name: typeof wall.name === 'string' ? wall.name : 'Wall',
      faces: compass(dx, dz, northRotation),
      roofRole,
      face,
      faceOut: outward as 1 | -1,
      distance,
      edge: role,
      toStreet,
      projection,
      projectionKind: projected.kind,
      projectionDistance,
      openings,
      openingArea,
      wallArea,
      wallRule,
      projectionRule,
      openingRule,
      issues,
    })
  }

  caveats.push(
    'Distances are measured at a right angle from the outer face of each exterior wall to the lot ring the site carries (R202); a street face is measured to the street centreline, so its lot-line figure is a lower bound.',
  )
  const parcel = isObj(site.parcel) ? site.parcel : null
  if (parcel && parcel.source === 'gis-parcel')
    caveats.push('The lot ring is GIS parcel geometry, not a survey — confirm the lines and the distances on a recorded plat before relying on a rating.')
  if (out.some((w) => w.projection > 0.7))
    caveats.push('A porch roof counts as a projection of the wall it hangs off; an uncovered deck is not treated as one here — verify with the AHJ.')
  return { measured: true, walls: out, rated, caveats }
}

/* ----------------------------------------------------------- plan marks */

/**
 * The floor plan's mark on every wall Table R302.1(1) rates: a heavy dashed
 * line just outside the face and the rating with the distance, in
 * level-local plan metres (the floor plan's frame). The label runs along
 * the wall and is turned to read left-to-right on the paper —
 * `rotationDeg` is the turn the sheet gives the plan (SVG sense,
 * clockwise positive). Nothing when no wall is rated — a house in the
 * middle of its lot draws as it always has.
 */
export function fireSeparationMarks(
  nodes: NodeMap,
  levelId: string | undefined,
  rotationDeg = 0,
): FloorplanGeometry[] {
  const fs = fireSeparation(nodes, levelId)
  const out: FloorplanGeometry[] = []
  for (const w of fs.walls) {
    if (w.wallRule !== 'rated' || w.distance === null) continue
    const [a, b] = w.face
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    // outward normal: the face already sits on the outer side of the wall, so away from the wall's own line
    const nx = (-(b[1] - a[1]) / len) * (w.faceOut ?? 1)
    const nz = ((b[0] - a[0]) / len) * (w.faceOut ?? 1)
    const off = 0.3
    out.push({
      kind: 'line',
      x1: a[0] + nx * off,
      y1: a[1] + nz * off,
      x2: b[0] + nx * off,
      y2: b[1] + nz * off,
      stroke: '#111827',
      strokeWidth: 0.06,
      strokeDasharray: '0.45 0.18',
      metadata: { sheets: 'fire-separation', wallId: w.wallId },
    })
    // along the face, reading left-to-right on the paper — or bottom-to-top
    // when the wall stands vertical there (the drafting convention)
    let angle = Math.atan2(b[1] - a[1], b[0] - a[0])
    const onPaper = angle + (rotationDeg * Math.PI) / 180
    const c = Math.cos(onPaper)
    const s = Math.sin(onPaper)
    if (c < -1e-9 || (Math.abs(c) <= 1e-9 && s > 0)) angle += Math.PI
    out.push({
      kind: 'group',
      transform: {
        translate: [(a[0] + b[0]) / 2 + nx * (off + 0.3), (a[1] + b[1]) / 2 + nz * (off + 0.3)],
        rotate: angle,
      },
      children: [
        {
          kind: 'text',
          x: 0,
          y: 0,
          text: `1-HR RATED WALL (R302.1) — ${formatSeparation(w.distance)} TO LOT LINE`,
          fontSize: 0.16,
          fill: '#111827',
          fontWeight: 700,
          fontFamily: 'Helvetica, Arial, sans-serif',
          textAnchor: 'middle',
          dominantBaseline: 'middle',
        },
      ],
    })
  }
  return out
}
