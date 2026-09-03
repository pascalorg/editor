/**
 * THE BUILDING THERMAL ENVELOPE, COMPUTED FROM THE MODEL.
 *
 * An energy sheet is only worth printing if its areas came out of the same
 * geometry the plans were drawn from. Everything here is measured, and every
 * place a measurement had to be assumed is returned in `warnings` so the
 * assumption prints on the paper instead of hiding in the number.
 *
 * WHAT IS MEASURED, AND HOW
 *  - CONDITIONED FLOOR AREA: the sum of the level's `zone` polygons whose
 *    `spaceRole` is 'room'. With no rooms drawn, the level's slab polygons
 *    (holes deducted) stand in — and the sheet says which was used.
 *  - CEILING / ROOF AREA: the footprint under the roof — the roof segments'
 *    width × depth, overhangs excluded (see notes/attic.ts).
 *  - VOLUME: conditioned floor area × the level height. A cathedral or tray
 *    ceiling is not modelled, so this is the flat-ceiling volume.
 *  - GROSS EXTERIOR WALL AREA: length × height for every wall on the level
 *    with exactly one side marked 'exterior'. Height is `wall.height` where
 *    the wall carries one, else the level height.
 *  - ORIENTATION: the wall's OUTWARD normal. Core's convention is that
 *    `frontSide` is the +normal side and normal = perp(end − start), so the
 *    outward normal is that perpendicular, flipped when the exterior face is
 *    the back. The bearing is measured clockwise from plan −z (north on an
 *    unrotated plan) and then rotated by `site.northRotation`.
 *  - GLAZING / DOORS: `window` and `door` nodes hosted on those walls
 *    (`wallId`, else `parentId`), width × height, bucketed by the host wall's
 *    orientation.
 *
 * NOTHING HERE DECIDES COMPLIANCE. It produces areas; the requirement table
 * and the compliance path are printed beside them, unjudged.
 */
import { polygonAreaSqM, polygonPoints } from '../cover'
import type { AnyNodeLike, NodeMap } from '../model'
import { levels, siteNode } from '../model'
import { computeAtticVentilation } from './attic'

export const SQFT_PER_SQM = 10.763910416709722
export const CUFT_PER_CUM = 35.31466672148859

export type Orientation = 'N' | 'E' | 'S' | 'W'
export const ORIENTATIONS: Orientation[] = ['N', 'E', 'S', 'W']

export type OrientationTotals = {
  orientation: Orientation
  grossWallSqM: number
  windowSqM: number
  doorSqM: number
  netWallSqM: number
  wallCount: number
}

export type ExteriorWallRow = {
  id: string
  mark: string
  orientation: Orientation
  /** Compass bearing of the outward normal, degrees clockwise from north. */
  bearing: number
  lengthM: number
  heightM: number
  grossSqM: number
  windowSqM: number
  doorSqM: number
  netSqM: number
}

export type FenestrationRow = {
  id: string
  mark: string
  orientation: Orientation
  widthM: number
  heightM: number
  areaSqM: number
  /** From the node when it carries one, else '' — printed as "PER NFRC LABEL". */
  uFactor: string
  shgc: string
  type: string
}

export type EnvelopeModel = {
  levelId: string
  levelName: string
  levelHeightM: number
  /** 'zones' when rooms were measured, 'slab' when the slab stood in. */
  floorAreaBasis: 'zones' | 'slab' | 'none'
  conditionedFloorSqM: number
  ceilingSqM: number
  volumeCuM: number
  byOrientation: OrientationTotals[]
  grossWallSqM: number
  windowSqM: number
  doorSqM: number
  netWallSqM: number
  /** Window area as a fraction of the conditioned floor area. */
  glazingRatio: number
  fenestration: FenestrationRow[]
  /** Exterior doors, for the fenestration schedule's companion table. */
  exteriorDoors: FenestrationRow[]
  /** One row per exterior wall — the T24 "opaque surfaces" table. */
  walls: ExteriorWallRow[]
  northRotationDeg: number
  warnings: string[]
}

/* ---------------------------------------------------------- geometry */

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function point(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null
  const x = num(value[0])
  const z = num(value[1])
  return x === null || z === null ? null : [x, z]
}

/**
 * Compass bearing of a plan direction, degrees clockwise from north.
 * Plan axes are x right and z down; north is −z rotated by the site's
 * `northRotation` (the same value the site plan's north arrow is drawn with).
 */
export function bearingOf(dx: number, dz: number, northRotationDeg: number): number {
  const raw = (Math.atan2(dx, -dz) * 180) / Math.PI - northRotationDeg
  return ((raw % 360) + 360) % 360
}

export function orientationOf(bearing: number): Orientation {
  if (bearing >= 45 && bearing < 135) return 'E'
  if (bearing >= 135 && bearing < 225) return 'S'
  if (bearing >= 225 && bearing < 315) return 'W'
  return 'N'
}

/** +1 when the FRONT face is the exterior, −1 when the back is, null otherwise. */
export function exteriorSideOf(wall: AnyNodeLike): 1 | -1 | null {
  const front = typeof wall.frontSide === 'string' ? wall.frontSide : 'unknown'
  const back = typeof wall.backSide === 'string' ? wall.backSide : 'unknown'
  if (front === 'exterior' && back !== 'exterior') return 1
  if (back === 'exterior' && front !== 'exterior') return -1
  return null
}

/** Outward normal of an exterior wall, or null when neither face is exterior. */
export function outwardNormal(wall: AnyNodeLike): [number, number] | null {
  const start = point(wall.start)
  const end = point(wall.end)
  const side = exteriorSideOf(wall)
  if (!start || !end || side === null) return null
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const length = Math.hypot(dx, dz)
  if (length < 1e-9) return null
  // Core: frontSide is the +normal side, normal = perp(end − start).
  const nx = -(dz / length)
  const nz = dx / length
  return [nx * side, nz * side]
}

export function wallLength(wall: AnyNodeLike): number {
  const start = point(wall.start)
  const end = point(wall.end)
  if (!start || !end) return 0
  return Math.hypot(end[0] - start[0], end[1] - start[1])
}

/* ------------------------------------------------------------ subtree */

/** Every node under a level, following both `children` and `parentId`. */
function subtree(nodes: NodeMap, levelId: string): AnyNodeLike[] {
  if (!nodes[levelId]) return []
  const children = new Map<string, string[]>()
  const push = (parent: string, child: string) => {
    const list = children.get(parent)
    if (list) list.push(child)
    else children.set(parent, [child])
  }
  for (const node of Object.values(nodes)) {
    if (!node) continue
    const parent = typeof node.parentId === 'string' ? node.parentId : ''
    if (parent) push(parent, node.id)
    if (Array.isArray(node.children)) {
      for (const child of node.children) if (typeof child === 'string') push(node.id, child)
    }
  }
  const seen = new Set([levelId])
  const out: AnyNodeLike[] = []
  const queue = [levelId]
  while (queue.length > 0) {
    const id = queue.shift() as string
    for (const child of children.get(id) ?? []) {
      if (seen.has(child)) continue
      seen.add(child)
      const node = nodes[child]
      if (!node) continue
      out.push(node)
      queue.push(child)
    }
  }
  return out
}

/* ------------------------------------------------------------ compute */

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function computeEnvelope(
  nodes: NodeMap,
  levelId: string | undefined,
  marks?: { window?: Map<string, string>; door?: Map<string, string> },
): EnvelopeModel {
  const warnings: string[] = []
  const levelNodes = levels(nodes)
  const level = (levelId ? nodes[levelId] : undefined) ?? levelNodes[0]
  const resolvedId = level?.id ?? ''
  const levelHeightM = num(level?.height) ?? 2.4384
  if (num(level?.height) === null) {
    warnings.push('Level height not set — 8\'-0" (2.4384 m) assumed for volume and wall area.')
  }
  const site = siteNode(nodes)
  const northRotationDeg = num(site?.northRotation) ?? 0

  const members = resolvedId ? subtree(nodes, resolvedId) : []

  // ── conditioned floor area ──────────────────────────────────────────
  let conditionedFloorSqM = 0
  let floorAreaBasis: EnvelopeModel['floorAreaBasis'] = 'none'
  const rooms = members.filter(
    (n) => n.type === 'zone' && n.spaceRole === 'room' && n.visible !== false,
  )
  for (const room of rooms) conditionedFloorSqM += polygonAreaSqM(polygonPoints(room.polygon))
  if (conditionedFloorSqM > 0) {
    floorAreaBasis = 'zones'
    warnings.push(
      `Conditioned floor area is the sum of ${rooms.length} room polygon${rooms.length === 1 ? '' : 's'}; unconditioned rooms are NOT deducted — verify against the room schedule.`,
    )
  } else {
    for (const slab of members.filter((n) => n.type === 'slab' && n.visible !== false)) {
      const outer = polygonAreaSqM(polygonPoints(slab.polygon))
      if (outer <= 0) continue
      const holes = Array.isArray(slab.holes)
        ? (slab.holes as unknown[]).reduce<number>(
            (sum, hole) => sum + polygonAreaSqM(polygonPoints(hole)),
            0,
          )
        : 0
      conditionedFloorSqM += Math.max(0, outer - holes)
    }
    if (conditionedFloorSqM > 0) {
      floorAreaBasis = 'slab'
      warnings.push(
        'No room (zone) polygons on this level — conditioned floor area is the SLAB area, which includes any unconditioned space inside the slab.',
      )
    } else {
      warnings.push('Neither rooms nor a slab on this level — no conditioned floor area computed.')
    }
  }

  // ── ceiling / roof ──────────────────────────────────────────────────
  const attic = computeAtticVentilation(nodes)
  const ceilingSqM = attic.areaSqM
  if (ceilingSqM <= 0) {
    warnings.push('No roof segments in the scene — ceiling / roof area not computed.')
  }

  // ── walls, and the openings hosted on them ─────────────────────────
  const totals = new Map<Orientation, OrientationTotals>(
    ORIENTATIONS.map((o) => [
      o,
      {
        orientation: o,
        grossWallSqM: 0,
        windowSqM: 0,
        doorSqM: 0,
        netWallSqM: 0,
        wallCount: 0,
      },
    ]),
  )
  const wallOrientation = new Map<string, Orientation>()
  const wallRows = new Map<string, ExteriorWallRow>()
  let unknownSides = 0
  for (const wall of members) {
    if (wall.type !== 'wall' || wall.visible === false) continue
    const normal = outwardNormal(wall)
    if (!normal) {
      unknownSides += 1
      continue
    }
    const bearing = bearingOf(normal[0], normal[1], northRotationDeg)
    const orientation = orientationOf(bearing)
    wallOrientation.set(wall.id, orientation)
    const height = num(wall.height) ?? levelHeightM
    const length = wallLength(wall)
    const entry = totals.get(orientation) as OrientationTotals
    entry.grossWallSqM += length * height
    entry.wallCount += 1
    wallRows.set(wall.id, {
      id: wall.id,
      mark: '',
      orientation,
      bearing,
      lengthM: length,
      heightM: height,
      grossSqM: length * height,
      windowSqM: 0,
      doorSqM: 0,
      netSqM: length * height,
    })
  }
  if (unknownSides > 0) {
    warnings.push(
      `${unknownSides} wall${unknownSides === 1 ? '' : 's'} on this level ${unknownSides === 1 ? 'has' : 'have'} no exterior face marked (frontSide/backSide) and ${unknownSides === 1 ? 'is' : 'are'} excluded from the envelope.`,
    )
  }

  const fenestration: FenestrationRow[] = []
  const exteriorDoors: FenestrationRow[] = []
  for (const opening of members) {
    if (opening.type !== 'window' && opening.type !== 'door') continue
    if (opening.visible === false) continue
    const hostId = str(opening.wallId) || str(opening.parentId)
    const orientation = wallOrientation.get(hostId)
    if (!orientation) continue
    const width = num(opening.width) ?? 0
    const height = num(opening.height) ?? 0
    const area = Math.max(0, width * height)
    const entry = totals.get(orientation) as OrientationTotals
    const host = wallRows.get(hostId)
    const meta = (opening.metadata ?? {}) as Record<string, unknown>
    const energy = (meta.energy ?? {}) as Record<string, unknown>
    const u = num(opening.uFactor) ?? num(energy.uFactor)
    const g = num(opening.shgc) ?? num(energy.shgc)
    const isWindow = opening.type === 'window'
    const row: FenestrationRow = {
      id: opening.id,
      mark: (isWindow ? marks?.window : marks?.door)?.get(opening.id) ?? '',
      orientation,
      widthM: width,
      heightM: height,
      areaSqM: area,
      uFactor: u === null ? '' : u.toFixed(2),
      shgc: g === null ? '' : g.toFixed(2),
      type: isWindow ? str(opening.windowType) || 'window' : str(opening.doorType) || 'door',
    }
    if (isWindow) {
      entry.windowSqM += area
      if (host) host.windowSqM += area
      fenestration.push(row)
    } else {
      entry.doorSqM += area
      if (host) host.doorSqM += area
      exteriorDoors.push(row)
    }
  }

  // Exterior wall marks: EW1 … in reading order (N, E, S, W, then longest
  // first) so the same scene always labels the same wall the same way.
  const walls = [...wallRows.values()].sort(
    (a, b) =>
      ORIENTATIONS.indexOf(a.orientation) - ORIENTATIONS.indexOf(b.orientation) ||
      b.lengthM - a.lengthM ||
      a.id.localeCompare(b.id),
  )
  walls.forEach((wall, index) => {
    wall.mark = `EW${index + 1}`
    wall.netSqM = Math.max(0, wall.grossSqM - wall.windowSqM - wall.doorSqM)
  })

  const byOrientation = ORIENTATIONS.map((o) => {
    const entry = totals.get(o) as OrientationTotals
    entry.netWallSqM = Math.max(0, entry.grossWallSqM - entry.windowSqM - entry.doorSqM)
    return entry
  })
  const sum = (pick: (t: OrientationTotals) => number) =>
    byOrientation.reduce((acc, t) => acc + pick(t), 0)
  const grossWallSqM = sum((t) => t.grossWallSqM)
  const windowSqM = sum((t) => t.windowSqM)
  const doorSqM = sum((t) => t.doorSqM)

  if (fenestration.some((row) => row.uFactor === '' || row.shgc === '')) {
    warnings.push(
      'Windows carry no U-factor or SHGC in the model — the fenestration schedule reads "PER NFRC LABEL"; enter the ordered product’s rated values before submittal.',
    )
  }
  if (northRotationDeg === 0 && !site?.northRotation) {
    warnings.push(
      'Site north rotation is 0° (not set) — orientations assume plan −z is north. Set the site’s north before relying on the orientation split.',
    )
  }

  return {
    levelId: resolvedId,
    levelName: str(level?.name) || 'Level',
    levelHeightM,
    floorAreaBasis,
    conditionedFloorSqM,
    ceilingSqM,
    volumeCuM: conditionedFloorSqM * levelHeightM,
    byOrientation,
    grossWallSqM,
    windowSqM,
    doorSqM,
    netWallSqM: Math.max(0, grossWallSqM - windowSqM - doorSqM),
    glazingRatio: conditionedFloorSqM > 0 ? windowSqM / conditionedFloorSqM : 0,
    fenestration: fenestration.sort(
      (a, b) =>
        a.mark.localeCompare(b.mark, undefined, { numeric: true }) || a.id.localeCompare(b.id),
    ),
    exteriorDoors: exteriorDoors.sort(
      (a, b) =>
        a.mark.localeCompare(b.mark, undefined, { numeric: true }) || a.id.localeCompare(b.id),
    ),
    walls,
    northRotationDeg,
    warnings,
  }
}
