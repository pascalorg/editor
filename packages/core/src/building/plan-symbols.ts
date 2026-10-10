import { symbolFrame } from './reference-props'

/**
 * The furniture, fixture and car symbols a plan draws, found and measured without selecting them
 * (L53): for furnish_from_plan and the editor's "place what the plan draws". The plan's shapes and
 * texts come in level metres. Rooms are the fills a label names (a fill holding another such fill
 * is the building, not a room); a door's swing is no furniture; a symbol is the parts that touch,
 * overlap or nest (a bed and its pillows, a table and the chairs tucked under it), counted once
 * where a vectoriser drew a fill and its outline.
 */

type Pt = [number, number]
/** `stroke`: drawn as a line, not filled; `dashed`: drawn overhead or hidden. */
export type PlanShape = { id: string; points: Pt[]; stroke?: boolean; dashed?: boolean }
export type PlanLabel = { text: string; at: Pt }

export type PlanRoom = { id: string; label: string | null; polygon: Pt[] }
export type PlanSymbol = {
  /** The shapes it is drawn with. */
  ids: string[]
  center: Pt
  /** Its extent along its frame's x and z (metres). */
  size: [number, number]
  /** Its frame's turn, as an item's: local (dx, dz) → (cx + dx·cos + dz·sin, cz − dx·sin + dz·cos). */
  yaw: number
  parts: number
  /** Parts drawn round (a stool, a basin, a round table). */
  rounds: number
  room: { id: string; label: string | null } | null
  /**
   * Which way its back points (a bed's head, a sofa's back), from lopsided parts (pillows at one
   * end) or the one wall it stands against; null when neither says.
   */
  back: { direction: Pt; by: 'parts' | 'wall' } | null
}

/**
 * With no rooms given, a fill this big holding a label is a room (the building, when it holds
 * other rooms); a smaller one is furniture a label was printed over (a king bed is about 3.8 m²,
 * a dining table 2.5 m²). The 290's vectorised plan drew a fill for some rooms only, so its beds
 * and table carried the room labels.
 */
const ROOM_MIN_AREA = 4
/** An unlabelled fill this big holding other shapes is a room's outline, not a part (a car is ~9 m²). */
const OUTLINE_MIN_AREA = 10
/** Thinner than this and with no area, a shape is a line (a bench edge, a dimension), no part. */
const LINE = 0.03
/** Parts this close or closer are one symbol. */
const TOUCH = 0.03
/** Two shapes whose boxes agree this closely are one drawn twice (a fill and its outline). */
const SAME_BOX = 0.02
/** A symbol's side this close to its room's edge stands against the wall. */
const WALL_CONTACT = 0.12
/** Parts off-centre by this share of the symbol's half-size make it lopsided. */
const LOPSIDED = 0.25
/** Longer than this, a shape is no piece of furniture. */
const MAX_SYMBOL = 7
/** A band this thin, this long and this lean is a wall drawn as a rectangle. */
const WALL_BAND = { thick: 0.4, long: 1, aspect: 4 }
/** Overlapping this share of the smaller, two parts are one (chairs tucked under a table). */
const OVERLAP = 0.1
/** Touching, a part at most this share of the other's area is its satellite (a chair at a desk). */
const SATELLITE = 0.4
/** A run this long and this shallow is built in (a bench, a robe): no symbol, it holds none. */
const BUILT_IN = { long: 2.5, deep: 0.9 }
/** Every part smaller than this, a symbol is a mark (a tap, a drain, a dot), no furniture. */
const MARK = 0.15
/**
 * A door's swing drawn alone, with no hinge point: an open curve on one circle as wide as a door
 * leaf (0.5 m, half a narrow double door, to 1.3 m, a wide door with slack), turning 45° to 120°.
 */
const SWING_ARC = { radius: [0.5, 1.3], turn: [Math.PI / 4, (Math.PI * 2) / 3], slack: 0.06 }
/**
 * An open run of two to five lines, one this long, is a bench's or a robe's front: it leaves the
 * wall, runs along it and returns. One straight line alone is an edge or a mark (a shower's X).
 */
const FRONT = { points: [3, 6], line: 1 }

/** A wall drawn as a band, or a built-in run: neither is furniture. */
function isFixedRun(box: Box) {
  const [w, d] = [box.maxX - box.minX, box.maxZ - box.minZ]
  const [long, thin] = [Math.max(w, d), Math.min(w, d)]
  return (
    (thin <= WALL_BAND.thick && long >= WALL_BAND.long && long >= thin * WALL_BAND.aspect) ||
    (long >= BUILT_IN.long && thin <= BUILT_IN.deep)
  )
}

type Box = { minX: number; maxX: number; minZ: number; maxZ: number }
const boxOf = (points: readonly Pt[]): Box => ({
  minX: Math.min(...points.map((p) => p[0])),
  maxX: Math.max(...points.map((p) => p[0])),
  minZ: Math.min(...points.map((p) => p[1])),
  maxZ: Math.max(...points.map((p) => p[1])),
})
const areaOf = (points: readonly Pt[]) =>
  Math.abs(
    points.reduce((sum, [x, z], i) => {
      const [nx, nz] = points[(i + 1) % points.length]!
      return sum + x * nz - nx * z
    }, 0) / 2,
  )
const centreOf = (box: Box): Pt => [(box.minX + box.maxX) / 2, (box.minZ + box.maxZ) / 2]

function inside(polygon: readonly Pt[], [x, z]: Pt) {
  let hit = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [ax, az] = polygon[i]!
    const [bx, bz] = polygon[j]!
    if (az > z !== bz > z && x < ((bx - ax) * (z - az)) / (bz - az) + ax) hit = !hit
  }
  return hit
}

/** Distance from a point to a polygon's boundary. */
function toEdge(polygon: readonly Pt[], [x, z]: Pt) {
  let best = Number.POSITIVE_INFINITY
  for (let i = 0; i < polygon.length; i++) {
    const [ax, az] = polygon[i]!
    const [bx, bz] = polygon[(i + 1) % polygon.length]!
    const [dx, dz] = [bx - ax, bz - az]
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)))
    best = Math.min(best, Math.hypot(x - (ax + t * dx), z - (az + t * dz)))
  }
  return best
}

/** A door's swing: a pivot and a quarter arc round it. */
function isSwing(points: readonly Pt[]) {
  if (points.length < 6) return false
  return points.some((pivot) => {
    const radii = points
      .filter((p) => p !== pivot)
      .map((p) => Math.hypot(p[0] - pivot[0], p[1] - pivot[1]))
    const radius = Math.max(...radii)
    const onArc = radii.filter((r) => Math.abs(r - radius) <= radius * 0.06).length
    return radius > 0.4 && radius < 1.4 && onArc >= points.length - 2
  })
}

/** A line drawn open, not round an object: an object's outline is drawn closed. */
const isOpen = (shape: PlanShape) => {
  const [first, last] = [shape.points[0]!, shape.points.at(-1)!]
  return !!shape.stroke && Math.hypot(last[0] - first[0], last[1] - first[1]) > SAME_BOX
}

function circumcentre(a: Pt, b: Pt, c: Pt): Pt | null {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]))
  if (Math.abs(d) < 1e-9) return null
  const [qa, qb, qc] = [a, b, c].map(([x, z]) => x * x + z * z) as [number, number, number]
  return [
    (qa * (b[1] - c[1]) + qb * (c[1] - a[1]) + qc * (a[1] - b[1])) / d,
    (qa * (c[0] - b[0]) + qb * (a[0] - c[0]) + qc * (b[0] - a[0])) / d,
  ]
}

/** A door's swing drawn alone: every point on one circle of a door's width, a quarter turn or so. */
function isSwingArc(shape: PlanShape) {
  const { points } = shape
  if (points.length < 5 || !isOpen(shape)) return false
  const centre = circumcentre(points[0]!, points[Math.floor(points.length / 2)]!, points.at(-1)!)
  if (!centre) return false
  const radius = Math.hypot(points[0]![0] - centre[0], points[0]![1] - centre[1])
  const [low, high] = SWING_ARC.radius as [number, number]
  if (radius < low || radius > high) return false
  const onCircle = points.every(
    (p) =>
      Math.abs(Math.hypot(p[0] - centre[0], p[1] - centre[1]) - radius) <= radius * SWING_ARC.slack,
  )
  const angles = points.map((p) => Math.atan2(p[1] - centre[1], p[0] - centre[0]))
  const turn = Math.abs(
    angles.slice(1).reduce((sum, angle, i) => {
      const step = angle - angles[i]!
      return sum + Math.atan2(Math.sin(step), Math.cos(step))
    }, 0),
  )
  const [least, most] = SWING_ARC.turn as [number, number]
  return onCircle && turn >= least && turn <= most
}

/** A bench's or a robe's front: an open run of a few straight lines from wall to wall, one long. */
function isFront(shape: PlanShape) {
  const { points } = shape
  return (
    points.length >= FRONT.points[0]! &&
    points.length <= FRONT.points[1]! &&
    isOpen(shape) &&
    points
      .slice(1)
      .some((p, i) => Math.hypot(p[0] - points[i]![0], p[1] - points[i]![1]) >= FRONT.line)
  )
}

/** Drawn round: its points as far from their centre all round. */
function isRound(points: readonly Pt[]) {
  if (points.length < 8) return false
  const [cx, cz] = [
    points.reduce((s, p) => s + p[0], 0) / points.length,
    points.reduce((s, p) => s + p[1], 0) / points.length,
  ]
  const radii = points.map((p) => Math.hypot(p[0] - cx, p[1] - cz))
  const mean = radii.reduce((s, r) => s + r, 0) / radii.length
  const spread = Math.sqrt(radii.reduce((s, r) => s + (r - mean) ** 2, 0) / radii.length)
  return mean > 0 && spread / mean < 0.08
}

const DIMENSION = /\d\s*(m|mm)?\s*[x×]\s*\d/i

export function planSymbols({
  contours,
  labels,
  rooms: given,
  planYaw = 0,
}: {
  contours: readonly PlanShape[]
  labels: readonly PlanLabel[]
  /** The scene's rooms (its zones), when they are built: they decide what is a room. */
  rooms?: readonly PlanRoom[]
  planYaw?: number
}): { rooms: PlanRoom[]; symbols: PlanSymbol[] } {
  const shapes = contours
    .filter((shape) => shape.points.length >= 2)
    .map((shape) => ({ ...shape, box: boxOf(shape.points), area: areaOf(shape.points) }))

  // A fill and its outline drawn twice: the first stands for both.
  const kept: typeof shapes = []
  for (const shape of shapes) {
    const twin = kept.some(
      (other) =>
        Math.abs(other.box.minX - shape.box.minX) <= SAME_BOX &&
        Math.abs(other.box.maxX - shape.box.maxX) <= SAME_BOX &&
        Math.abs(other.box.minZ - shape.box.minZ) <= SAME_BOX &&
        Math.abs(other.box.maxZ - shape.box.maxZ) <= SAME_BOX,
    )
    if (!twin) kept.push(shape)
  }

  // Rooms: big fills holding a label. One holding two or more of them is the building; one inside
  // a room is furniture a label was printed over (a plan writes "BED 1" across the bed).
  const labelled = kept.filter(
    (shape) =>
      shape.area >= ROOM_MIN_AREA && labels.some((label) => inside(shape.points, label.at)),
  )
  const holds = (outer: (typeof kept)[number], inner: (typeof kept)[number]) =>
    outer !== inner && outer.area > inner.area && inside(outer.points, centreOf(inner.box))
  const containers = new Set(
    labelled
      .filter((shape) => labelled.filter((other) => holds(shape, other)).length >= 2)
      .map((shape) => shape.id),
  )
  const roomShapes = labelled.filter(
    (shape) =>
      !containers.has(shape.id) &&
      !labelled.some((outer) => !containers.has(outer.id) && holds(outer, shape)),
  )
  const rooms: PlanRoom[] =
    given?.slice() ??
    roomShapes.map((shape) => {
      const named = labels.filter((label) => inside(shape.points, label.at))
      const label = named.find((l) => /[a-z]/i.test(l.text) && !DIMENSION.test(l.text)) ?? named[0]
      return { id: shape.id, label: label?.text ?? null, polygon: shape.points }
    })

  const notParts = new Set([...containers])
  if (given) {
    // A fill covering most of a given room is that room's floor.
    for (const shape of kept)
      if (
        given.some(
          (room) =>
            inside(room.polygon, centreOf(shape.box)) && shape.area >= areaOf(room.polygon) * 0.5,
        )
      )
        notParts.add(shape.id)
  } else for (const shape of roomShapes) notParts.add(shape.id)
  // An unlabelled fill holding other shapes and as big as a room is a room's outline.
  for (const shape of kept)
    if (shape.area >= OUTLINE_MIN_AREA && kept.filter((other) => holds(shape, other)).length >= 2)
      notParts.add(shape.id)
  // A fill holding most of the others is the building's, labelled or not.
  for (const shape of kept)
    if (
      shape.area >= ROOM_MIN_AREA &&
      kept.filter((other) => other !== shape && inside(shape.points, centreOf(other.box))).length >=
        kept.length / 2
    )
      notParts.add(shape.id)
  const parts = kept.filter(
    (shape) =>
      !notParts.has(shape.id) &&
      !isSwing(shape.points) &&
      // Already something else: a door's swing, what is overhead, a bench's front.
      !isSwingArc(shape) &&
      !shape.dashed &&
      !isFront(shape) &&
      !(
        shape.area < LINE * LINE &&
        Math.min(shape.box.maxX - shape.box.minX, shape.box.maxZ - shape.box.minZ) < LINE
      ) &&
      !isFixedRun(shape.box) &&
      Math.max(shape.box.maxX - shape.box.minX, shape.box.maxZ - shape.box.minZ) <= MAX_SYMBOL,
  )

  // Parts are one symbol when one sits in the other (pillows on a bed), when they overlap (chairs
  // tucked under a table), or when a small one touches a big one (a chair at a desk). Two of a
  // size that only touch stay two (a vanity beside the shower).
  const parent = parts.map((_, i) => i)
  const root = (i: number): number => {
    while (parent[i] !== i) i = parent[i]!
    return i
  }
  for (let i = 0; i < parts.length; i++)
    for (let j = i + 1; j < parts.length; j++)
      if (together(parts[i]!.box, parts[j]!.box)) parent[root(j)] = root(i)
  const groups = new Map<number, typeof parts>()
  for (const [i, part] of parts.entries())
    groups.set(root(i), [...(groups.get(root(i)) ?? []), part])

  // The building's outline, when the plan draws one: what lies outside it is a note or a legend.
  const building = kept.find((shape) => containers.has(shape.id))
  const symbols = [...groups.values()]
    .filter((group) =>
      group.some(
        (part) => Math.max(part.box.maxX - part.box.minX, part.box.maxZ - part.box.minZ) >= MARK,
      ),
    )
    .filter(
      (group) => !building || group.some((part) => inside(building.points, centreOf(part.box))),
    )
    .map((group): PlanSymbol => {
      const frame = symbolFrame(
        group.flatMap((part) => part.points),
        planYaw,
      )
      const room = rooms.find((r) => inside(r.polygon, frame.center)) ?? null
      return {
        ids: group.map((part) => part.id),
        center: frame.center,
        size: frame.size,
        yaw: frame.yaw,
        parts: group.length,
        rounds: group.filter((part) => isRound(part.points)).length,
        room: room ? { id: room.id, label: room.label } : null,
        back: backOf(group, frame, room?.polygon ?? null),
      }
    })
  return { rooms, symbols }
}

const boxArea = (box: Box) => (box.maxX - box.minX) * (box.maxZ - box.minZ)

function together(a: Box, b: Box) {
  const [small, big] = boxArea(a) <= boxArea(b) ? [a, b] : [b, a]
  const [cx, cz] = centreOf(small)
  if (cx >= big.minX && cx <= big.maxX && cz >= big.minZ && cz <= big.maxZ) return true
  const overlap =
    Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX)) *
    Math.max(0, Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ))
  if (overlap >= boxArea(small) * OVERLAP) return true
  const touching =
    a.minX <= b.maxX + TOUCH &&
    b.minX <= a.maxX + TOUCH &&
    a.minZ <= b.maxZ + TOUCH &&
    b.minZ <= a.maxZ + TOUCH
  return touching && boxArea(small) <= boxArea(big) * SATELLITE
}

/** Its back: the side its smaller parts gather at, else the one side against a wall. */
function backOf(
  group: readonly { points: Pt[]; box: Box; area: number }[],
  frame: { center: Pt; yaw: number; size: [number, number] },
  room: readonly Pt[] | null,
): PlanSymbol['back'] {
  const axisX: Pt = [Math.cos(frame.yaw), -Math.sin(frame.yaw)]
  const axisZ: Pt = [Math.sin(frame.yaw), Math.cos(frame.yaw)]
  const along = (v: Pt, axis: Pt) => v[0] * axis[0] + v[1] * axis[1]
  if (group.length >= 2) {
    const main = group.reduce((a, b) => (b.area > a.area ? b : a))
    const others = group.filter((part) => part !== main)
    const centre = centreOf(main.box)
    const offset: Pt = [
      others.reduce((s, part) => s + centreOf(part.box)[0], 0) / others.length - centre[0],
      others.reduce((s, part) => s + centreOf(part.box)[1], 0) / others.length - centre[1],
    ]
    const x = along(offset, axisX) / (frame.size[0] / 2 || 1)
    const z = along(offset, axisZ) / (frame.size[1] / 2 || 1)
    if (Math.max(Math.abs(x), Math.abs(z)) >= LOPSIDED) {
      const [axis, share] = Math.abs(x) >= Math.abs(z) ? [axisX, x] : [axisZ, z]
      return { direction: [axis[0] * Math.sign(share), axis[1] * Math.sign(share)], by: 'parts' }
    }
  }
  if (!room) return null
  const sides: Pt[] = [axisX, [-axisX[0], -axisX[1]], axisZ, [-axisZ[0], -axisZ[1]]]
  const halves = [frame.size[0], frame.size[0], frame.size[1], frame.size[1]].map((s) => s / 2)
  const against = sides.filter((side, i) => {
    const mid: Pt = [frame.center[0] + side[0] * halves[i]!, frame.center[1] + side[1] * halves[i]!]
    return toEdge(room, mid) <= WALL_CONTACT
  })
  return against.length === 1 ? { direction: against[0]!, by: 'wall' } : null
}
