import {
  type AnyNode,
  area,
  type CeilingNode,
  calculateLevelMiters,
  difference,
  FloorOpeningNode,
  getWallPlanFootprint,
  intersection,
  type Polygon,
  type Ring,
  SeparatorNode,
  type SlabNode,
  union,
  type WallNode,
  type ZoneNode,
} from '@pascal-app/core'
import { migrateRoomZones } from '@pascal-app/core/scene-migrations'
import { nextId } from './ids'

/**
 * Maps IFC floors, finishes, ceilings and open-plan spaces onto Pascal's
 * room-first structure. The importer only writes intent — room zones with
 * seeds, separators, floor-plate templates, floor/ceiling links — and the
 * scene load migrations (M3 room adoption, M4 plates) plus the structure
 * kernel derive the actual rooms, plates and ceilings from it. Room faces are
 * previewed with the same M3 migration the loader runs, so decisions here are
 * made on the rooms the scene will actually have.
 */

type SceneNodes = Record<string, AnyNode>
type Point = [number, number]

export type RoomFirstStats = {
  separators: number
  floorPlates: number
  manualFloors: number
  roomFinishes: number
  linkedCeilings: number
  floorOpenings: number
}

/** Thickest slab still read as a finish layer on a structural floor. */
const MAX_FINISH_THICKNESS = 0.06
/** Largest top-height difference between a floor and the level's main floor. */
const FLOOR_TOP_TOLERANCE = 0.02
/** Floor area allowed past the rooms and walls before a floor is not a room floor. */
const MAX_OVERHANG_AREA = 1
const MAX_OVERHANG_SHARE = 0.05
/** Clear room floor a floor may leave uncovered and still be the room's floor. */
const MAX_UNCOVERED_FLOOR = 0.25
const MAX_UNCOVERED_SHARE = 0.03
/** Widest gap between two spaces' edges bridged by one separator (a missing partition). */
const MAX_SEPARATOR_GAP = 0.35
const MAX_SEPARATOR_REACH = 0.6
const PARALLEL_SINE = Math.sin((3 * Math.PI) / 180)
/** Distance within which centreline wall ends count as one junction. */
const JUNCTION_EPSILON = 1e-4

const cross = (a: Point, b: Point) => a[0] * b[1] - a[1] * b[0]
const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1]
const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]]
const add = (a: Point, b: Point, scale = 1): Point => [a[0] + b[0] * scale, a[1] + b[1] * scale]

function footprint(node: { polygon: Ring; holes?: Ring[] }): Polygon {
  return { outer: node.polygon, holes: node.holes ?? [] }
}

function safeArea(run: () => Polygon[]): number {
  try {
    return area(run())
  } catch {
    return 0
  }
}

function meta(node: AnyNode): Record<string, unknown> {
  return (node.metadata ?? {}) as Record<string, unknown>
}

const isIfcSpace = (node: AnyNode): node is ZoneNode =>
  node.type === 'zone' && meta(node).ifcType === 'IFCSPACE'

function attach(nodes: SceneNodes, node: AnyNode) {
  nodes[node.id] = node
  const parent = node.parentId ? nodes[node.parentId] : undefined
  if (parent && 'children' in parent && Array.isArray(parent.children))
    (parent.children as string[]).push(node.id)
}

function detach(nodes: SceneNodes, id: string) {
  const node = nodes[id]
  const parent = node?.parentId ? nodes[node.parentId] : undefined
  if (parent && 'children' in parent && Array.isArray(parent.children))
    (parent as { children: string[] }).children = parent.children.filter(
      (childId: string) => childId !== id,
    )
  delete nodes[id]
}

/**
 * Walls are processed on their body centrelines; an IFC reference line on a
 * wall face comes back here as Pascal `justification` (a = body left of the
 * directed line, b = right), with start/end on that face line.
 *
 * The wall graph joins walls where their reference endpoints meet, so each
 * junction the centrelines made is rebuilt on the reference lines: an L at the
 * two lines' intersection, a T where the stem's line meets the host's. A
 * junction whose reference lines cannot meet in one point (three or more ends,
 * or in-line walls offset differently) keeps its walls centred.
 */
export function applyWallReferenceLines(nodes: SceneNodes, bodySides: ReadonlyMap<string, Point>) {
  const walls = Object.values(nodes).filter(
    (node): node is WallNode =>
      node.type === 'wall' &&
      !(node.curveOffset && Math.abs(node.curveOffset) > 1e-6) &&
      Math.hypot(node.end[0] - node.start[0], node.end[1] - node.start[1]) > 1e-6,
  )
  const sides = new Map<string, Point>()
  for (const [id, side] of bodySides) if (walls.some((wall) => wall.id === id)) sides.set(id, side)
  if (!sides.size) return

  const dirOf = (wall: WallNode): Point => {
    const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
    return [(wall.end[0] - wall.start[0]) / length, (wall.end[1] - wall.start[1]) / length]
  }
  const offsetOf = (wall: WallNode): Point => {
    const side = sides.get(wall.id)
    const half = (wall.thickness ?? 0.1) / 2
    return side ? [-side[0] * half, -side[1] * half] : [0, 0]
  }
  type End = { wall: WallNode; atEnd: boolean; point: Point }
  type Junction = { ends: End[]; host?: WallNode }
  const junctions: Junction[] = []
  for (const wall of walls)
    for (const atEnd of [false, true]) {
      const point = atEnd ? wall.end : wall.start
      const junction = junctions.find(
        (candidate) =>
          candidate.ends[0]!.wall.parentId === wall.parentId &&
          Math.hypot(...sub(candidate.ends[0]!.point, point)) <= JUNCTION_EPSILON,
      )
      if (junction) junction.ends.push({ wall, atEnd, point })
      else junctions.push({ ends: [{ wall, atEnd, point }] })
    }
  for (const junction of junctions) {
    const point = junction.ends[0]!.point
    junction.host = walls.find((wall) => {
      if (junction.ends.some((end) => end.wall === wall)) return false
      if (wall.parentId !== junction.ends[0]!.wall.parentId) return false
      const dir = dirOf(wall)
      const offset = sub(point, wall.start)
      const along = dot(offset, dir)
      const length = Math.hypot(...sub(wall.end, wall.start))
      return (
        Math.abs(cross(offset, dir)) <= JUNCTION_EPSILON &&
        along > JUNCTION_EPSILON &&
        along < length - JUNCTION_EPSILON
      )
    })
  }
  const parallel = (a: WallNode, b: WallNode) => Math.abs(cross(dirOf(a), dirOf(b))) < 1e-6
  for (let changed = true; changed; ) {
    changed = false
    for (const { ends, host } of junctions) {
      if (!ends.some((end) => sides.has(end.wall.id)) && !(host && sides.has(host.id))) continue
      const [a, b] = ends
      const closable = host
        ? ends.every((end) => !parallel(end.wall, host))
        : ends.length === 1 ||
          (ends.length === 2 &&
            (!parallel(a!.wall, b!.wall) ||
              Math.hypot(...sub(offsetOf(a!.wall), offsetOf(b!.wall))) <= JUNCTION_EPSILON))
      if (closable) continue
      for (const wall of [...ends.map((end) => end.wall), ...(host ? [host] : [])])
        if (sides.delete(wall.id)) changed = true
    }
  }

  const lineIntersection = (a: WallNode, b: WallNode): Point => {
    const da = dirOf(a)
    const db = dirOf(b)
    const pa = add(a.start, offsetOf(a))
    const pb = add(b.start, offsetOf(b))
    return add(pa, da, cross(sub(pb, pa), db) / cross(da, db))
  }
  const targets = new Map<End, Point>()
  for (const { ends, host } of junctions)
    for (const end of ends) {
      const [other] = ends.filter((candidate) => candidate !== end)
      targets.set(
        end,
        host
          ? lineIntersection(end.wall, host)
          : ends.length === 2 && other && !parallel(end.wall, other.wall)
            ? lineIntersection(end.wall, other.wall)
            : add(end.point, offsetOf(end.wall)),
      )
    }
  for (const { ends } of junctions)
    for (const end of ends) {
      const target = targets.get(end)!
      const { wall } = end
      if (!end.atEnd) {
        // Openings are placed by their distance from the wall start.
        const moved = dot(sub(target, add(wall.start, offsetOf(wall))), dirOf(wall))
        for (const id of wall.children) {
          const child = nodes[id]
          if (child?.type !== 'door' && child?.type !== 'window') continue
          child.position = [child.position[0] - moved, child.position[1], child.position[2]]
        }
      }
    }
  for (const { ends } of junctions)
    for (const end of ends) {
      if (end.atEnd) end.wall.end = targets.get(end)!
      else end.wall.start = targets.get(end)!
    }
  for (const [id, side] of sides) {
    const wall = nodes[id] as WallNode
    const dir = dirOf(wall)
    wall.justification = dot(side, [-dir[1], dir[0]]) > 0 ? 'a' : 'b'
  }
}

type PreviewRoom = {
  levelId: string
  /** The zone that is this face's room: an adopted IFC space, else a wall-loop room. */
  zoneId?: string
  preview: ZoneNode
  polygon: Polygon
  area: number
}

/** The rooms the M3 load migration will make of the current walls and zones. */
function previewRooms(nodes: SceneNodes): PreviewRoom[] {
  const { nodes: migrated } = migrateRoomZones(nodes as Record<string, unknown>)
  return (Object.values(migrated) as AnyNode[]).flatMap((node) => {
    if (node.type !== 'zone' || !node.autoFromWalls || !node.parentId) return []
    const polygon = footprint(node)
    const room: PreviewRoom = {
      levelId: node.parentId,
      preview: node,
      polygon,
      area: safeArea(() => [polygon]),
    }
    if (nodes[node.id]) room.zoneId = node.id
    return [room]
  })
}

/**
 * Wall loops no IFC space claims become rooms here, exactly as M3 would make
 * them on load, so their floor and ceiling follow the same rules as the IFC
 * rooms (a shaft or foundation cell has no floor the IFC never modelled).
 */
function materializeRooms(nodes: SceneNodes, rooms: PreviewRoom[]) {
  for (const room of rooms) {
    if (room.zoneId) continue
    attach(nodes, {
      ...room.preview,
      metadata: { ...room.preview.metadata, ifcDerived: 'wall-loop' },
    })
    room.zoneId = room.preview.id
  }
}

type Line = { start: Point; end: Point }

function wallLines(nodes: SceneNodes, levelId: string): (Line & { thickness: number })[] {
  return Object.values(nodes).flatMap((node) =>
    node.type === 'wall' &&
    node.parentId === levelId &&
    !(node.curveOffset && Math.abs(node.curveOffset) > 1e-6)
      ? [{ start: node.start, end: node.end, thickness: node.thickness ?? 0.1 }]
      : [],
  )
}

/**
 * IFC separates open-plan spaces with virtual boundaries Pascal cannot read.
 * Two spaces that fall in one wall face and border each other along an
 * edge get a separator on the midline of that border, run on to the walls.
 */
function addSpaceSeparators(nodes: SceneNodes, rooms: PreviewRoom[]): number {
  let added = 0
  const spaces = Object.values(nodes).filter(isIfcSpace)
  const levelIds = new Set(spaces.flatMap((space) => (space.parentId ? [space.parentId] : [])))
  for (const levelId of levelIds) {
    const faces = rooms.filter((room) => room.levelId === levelId)
    const groups = new Map<PreviewRoom, ZoneNode[]>()
    const open: ZoneNode[] = []
    for (const space of spaces) {
      if (space.parentId !== levelId || space.polygon.length < 3) continue
      const spaceArea = safeArea(() => [footprint(space)])
      let best: { face: PreviewRoom; overlap: number } | undefined
      for (const face of faces) {
        const overlap = safeArea(() => intersection(footprint(space), face.polygon))
        if (!best || overlap > best.overlap) best = { face, overlap }
      }
      if (!best || best.overlap < spaceArea * 0.5) open.push(space)
      else groups.set(best.face, [...(groups.get(best.face) ?? []), space])
    }
    const walls = wallLines(nodes, levelId)
    const alongWalls = walls
    const borders: Line[] = []
    const members: ZoneNode[] = []
    for (const group of groups.values()) {
      if (group.length < 2) continue
      members.push(...group)
      for (let i = 0; i < group.length; i++)
        for (let j = i + 1; j < group.length; j++)
          borders.push(...sharedBorders(group[i]!.polygon, group[j]!.polygon))
    }
    const lines = mergeCollinear(borders).flatMap((line) => clipAlongWalls(line, walls))
    // A space edge running along neither a wall nor another space crosses a
    // gap in the walls (a service void, a wall stopping short of its
    // neighbour's face) that would join two spaces into one room.
    const openEdges = (space: ZoneNode) =>
      space.polygon.flatMap((point, index) =>
        clipAlongWalls(
          { start: point, end: space.polygon[(index + 1) % space.polygon.length]! },
          [
            ...alongWalls,
            ...lines.map((line) => ({ ...line, thickness: MAX_SEPARATOR_GAP + 0.04 })),
          ],
          0.05,
        ),
      )
    const gaps = mergeCollinear(members.flatMap(openEdges))
    // A space mostly bounded by walls but open on one side (a glazed facade
    // exported as a curtain wall) is closed along its own open edges.
    const closers = open.flatMap((space) => {
      const edges = openEdges(space)
      const perimeter = space.polygon.reduce(
        (sum, point, index) =>
          sum + Math.hypot(...sub(space.polygon[(index + 1) % space.polygon.length]!, point)),
        0,
      )
      const openLength = edges.reduce(
        (sum, edge) => sum + Math.hypot(...sub(edge.end, edge.start)),
        0,
      )
      return perimeter > 0 && openLength <= perimeter * 0.7 ? edges : []
    })
    const connected = connectSeparators([...lines, ...gaps, ...closers], walls)
    for (const [index, entry] of connected.entries()) {
      const { line } = entry
      const length = Math.hypot(...sub(line.end, line.start))
      if (length < 0.1 || !entry.attached.every(Boolean)) continue
      const gap = index >= lines.length && index < lines.length + gaps.length
      if (gap && (length > MAX_SEPARATOR_REACH || !entry.onWall.every(Boolean))) continue
      attach(
        nodes,
        SeparatorNode.parse({
          id: nextId('separator'),
          type: 'separator',
          name: 'Space boundary',
          parentId: levelId,
          start: line.start,
          end: line.end,
          metadata: { ifcDerived: 'space-boundary' },
        }),
      )
      added++
    }
  }
  return added
}

function sharedBorders(a: Ring, b: Ring): Line[] {
  const out: Line[] = []
  for (let i = 0; i < a.length; i++) {
    const a0 = a[i]!
    const a1 = a[(i + 1) % a.length]!
    const lengthA = Math.hypot(...sub(a1, a0))
    if (lengthA < 0.05) continue
    const dir: Point = [(a1[0] - a0[0]) / lengthA, (a1[1] - a0[1]) / lengthA]
    const normal: Point = [-dir[1], dir[0]]
    for (let j = 0; j < b.length; j++) {
      const b0 = b[j]!
      const b1 = b[(j + 1) % b.length]!
      const lengthB = Math.hypot(...sub(b1, b0))
      if (lengthB < 0.05) continue
      if (
        Math.abs(cross(dir, [(b1[0] - b0[0]) / lengthB, (b1[1] - b0[1]) / lengthB])) > PARALLEL_SINE
      )
        continue
      const offset = dot(sub(b0, a0), normal)
      if (Math.abs(offset) > MAX_SEPARATOR_GAP) continue
      const t0 = dot(sub(b0, a0), dir)
      const t1 = dot(sub(b1, a0), dir)
      const lo = Math.max(0, Math.min(t0, t1))
      const hi = Math.min(lengthA, Math.max(t0, t1))
      if (hi - lo < 0.05) continue
      const base = add(a0, normal, offset / 2)
      out.push({ start: add(base, dir, lo), end: add(base, dir, hi) })
    }
  }
  return out
}

/** Unions overlapping collinear pieces (the same border found from both spaces). */
function mergeCollinear(pieces: Line[]): Line[] {
  const merged: Line[] = []
  const used = new Set<number>()
  for (let i = 0; i < pieces.length; i++) {
    if (used.has(i)) continue
    const line = pieces[i]!
    const length = Math.hypot(...sub(line.end, line.start))
    const dir: Point = [
      (line.end[0] - line.start[0]) / length,
      (line.end[1] - line.start[1]) / length,
    ]
    let lo = 0
    let hi = length
    for (let changed = true; changed; ) {
      changed = false
      for (let j = i + 1; j < pieces.length; j++) {
        if (used.has(j)) continue
        const other = pieces[j]!
        const otherDir = sub(other.end, other.start)
        const otherLength = Math.hypot(...otherDir)
        if (Math.abs(cross(dir, otherDir)) > PARALLEL_SINE * otherLength) continue
        if (Math.abs(cross(sub(other.start, line.start), dir)) > 0.03) continue
        const t0 = dot(sub(other.start, line.start), dir)
        const t1 = dot(sub(other.end, line.start), dir)
        if (Math.min(t0, t1) > hi + 0.05 || Math.max(t0, t1) < lo - 0.05) continue
        lo = Math.min(lo, t0, t1)
        hi = Math.max(hi, t0, t1)
        used.add(j)
        changed = true
      }
    }
    merged.push({ start: add(line.start, dir, lo), end: add(line.start, dir, hi) })
  }
  return merged
}

/** Drops the parts of a border that already run inside a wall body. */
function clipAlongWalls(
  line: Line,
  walls: (Line & { thickness: number })[],
  minLength = 0.1,
): Line[] {
  const length = Math.hypot(...sub(line.end, line.start))
  const dir: Point = [
    (line.end[0] - line.start[0]) / length,
    (line.end[1] - line.start[1]) / length,
  ]
  let ranges: [number, number][] = [[0, length]]
  for (const wall of walls) {
    const wallDir = sub(wall.end, wall.start)
    const wallLength = Math.hypot(...wallDir)
    if (wallLength < 1e-6 || Math.abs(cross(dir, wallDir)) > PARALLEL_SINE * wallLength) continue
    if (Math.abs(cross(sub(wall.start, line.start), dir)) > wall.thickness / 2 + 0.08) continue
    const t0 = dot(sub(wall.start, line.start), dir)
    const t1 = dot(sub(wall.end, line.start), dir)
    const lo = Math.min(t0, t1)
    const hi = Math.max(t0, t1)
    ranges = ranges.flatMap(([start, end]): [number, number][] =>
      hi <= start || lo >= end
        ? [[start, end]]
        : [
            ...(lo > start ? [[start, lo] as [number, number]] : []),
            ...(hi < end ? [[hi, end] as [number, number]] : []),
          ],
    )
  }
  return ranges
    .filter(([start, end]) => end - start >= minLength)
    .map(([start, end]) => ({ start: add(line.start, dir, start), end: add(line.start, dir, end) }))
}

/** Farthest a separator end snaps onto a boundary end (a wall stub at a doorway). */
const SEPARATOR_END_SNAP = 0.12

type Attached = { line: Line; attached: [boolean, boolean]; onWall: [boolean, boolean] }
type Target = Line & { thickness: number }

/**
 * Moves one separator end onto a target: a target end within the snap
 * distance, or the target line it points at (just past a wall's end, within
 * its body, lands on that end). The cheapest move wins. The room graph only
 * joins a separator whose end lies exactly on a boundary.
 */
function reachTarget(
  point: Point,
  other: Point,
  out: Point,
  length: number,
  targets: Target[],
): Point | null {
  let best: { point: Point; cost: number } | undefined
  const consider = (candidate: Point, cost: number) => {
    if (Math.hypot(...sub(candidate, other)) < 0.1) return
    if (!best || cost < best.cost) best = { point: candidate, cost }
  }
  for (const target of targets) {
    for (const end of [target.start, target.end]) {
      const distance = Math.hypot(...sub(end, point))
      if (distance <= SEPARATOR_END_SNAP) consider(end, distance)
    }
    const targetDir = sub(target.end, target.start)
    const targetLength = Math.hypot(...targetDir)
    if (targetLength < 1e-6) continue
    const denominator = cross(out, targetDir) / targetLength
    if (Math.abs(denominator) < 0.25) continue
    const toTarget = sub(target.start, point)
    const move = cross(toTarget, targetDir) / targetLength / denominator
    const along = cross(toTarget, out) / denominator
    if (Math.abs(move) > MAX_SEPARATOR_REACH || length + move < 0.1) continue
    const past = Math.max(0, -along, along - targetLength)
    if (past > target.thickness / 2 + 0.05) continue
    const t = Math.max(0, Math.min(1, along / targetLength))
    consider(add(target.start, targetDir, t), Math.abs(move) + past)
  }
  return best?.point ?? null
}

function reachTargets(entry: Attached, targets: Target[]): Attached {
  const { line } = entry
  const length = Math.hypot(...sub(line.end, line.start))
  if (length < 1e-6) return entry
  const dir: Point = [
    (line.end[0] - line.start[0]) / length,
    (line.end[1] - line.start[1]) / length,
  ]
  const ends = [line.start, line.end]
  const attached: [boolean, boolean] = [...entry.attached]
  for (const index of [0, 1] as const) {
    if (attached[index]) continue
    const out: Point = index === 0 ? [-dir[0], -dir[1]] : dir
    const point = reachTarget(ends[index]!, ends[1 - index]!, out, length, targets)
    if (!point) continue
    ends[index] = point
    attached[index] = true
  }
  return { ...entry, line: { start: ends[0]!, end: ends[1]! }, attached }
}

/** Walls first; ends still loose then join the other separators as they now lie. */
function connectSeparators(lines: Line[], walls: Target[]): Attached[] {
  const entries = lines.map((line) => {
    const entry = reachTargets({ line, attached: [false, false], onWall: [false, false] }, walls)
    return { ...entry, onWall: [...entry.attached] as [boolean, boolean] }
  })
  for (const [index, entry] of entries.entries())
    entries[index] = reachTargets(
      entry,
      entries
        .filter((_, other) => other !== index)
        .map((other) => ({ ...other.line, thickness: 0 })),
    )
  return entries
}

type SlabInfo = {
  slab: SlabNode
  top: number
  bottom: number
  area: number
  polygon: Polygon
  kind: 'structural' | 'finish' | 'other'
  support?: SlabInfo
}

function finishRef(name: string): string | undefined {
  const text = name.toLowerCase()
  if (/wood|timber|parquet|oak|plank|hardwood|laminate/.test(text))
    return 'library:wood-woodplank48'
  if (/marble/.test(text)) return 'library:flooring-statuarettowhite'
  if (/tile|ceramic|porcelain/.test(text)) return 'library:flooring-lightceramic24'
  if (/terrazzo/.test(text)) return 'library:flooring-terrazzo19'
  if (/stone|granite|slate/.test(text)) return 'library:flooring-wallstone1'
  if (/concrete|screed|cement/.test(text)) return 'library:concrete-polished'
  return undefined
}

/** A room floor finish from the IFC material or type name, else its surface colour. */
function floorFinish(slab: SlabNode): string | Record<string, unknown> {
  const metadata = meta(slab)
  const names = [metadata.material, metadata.typeName, metadata.objectType, slab.name]
  for (const name of names) {
    const ref = typeof name === 'string' ? finishRef(name) : undefined
    if (ref) return ref
  }
  const color = typeof metadata.sourceColor === 'string' ? metadata.sourceColor : '#c8c2b8'
  return { preset: 'custom', properties: { color, roughness: 0.7, metalness: 0 } }
}

function finishLabel(slab: SlabNode): string {
  const metadata = meta(slab)
  const name =
    (typeof metadata.typeName === 'string' && metadata.typeName) ||
    (typeof metadata.material === 'string' && metadata.material) ||
    (slab.name ?? '').replace(/:\d+$/, '')
  return name.slice(0, 120)
}

function classifySlabs(slabs: SlabNode[], rooms: PreviewRoom[]): SlabInfo[] {
  const roomArea = union(rooms.map((room) => room.polygon))
  const infos: SlabInfo[] = slabs.map((slab) => {
    const polygon = footprint(slab)
    return {
      slab,
      top: slab.elevation,
      bottom: slab.elevation - slab.thickness,
      area: safeArea(() => [polygon]),
      polygon,
      kind: 'other',
    }
  })
  for (const info of infos) {
    const type = String(meta(info.slab).predefinedType ?? '').toUpperCase()
    const covering = meta(info.slab).ifcType === 'IFCCOVERING'
    if (!covering && (type === 'ROOF' || type === 'LANDING')) continue
    // A flooring covering is a finish or nothing: it never carries a room.
    info.kind = covering ? 'other' : 'structural'
    if (!covering && info.slab.thickness > MAX_FINISH_THICKNESS + 1e-6) continue
    const support = infos
      .filter(
        (other) =>
          other !== info &&
          other.slab.thickness > MAX_FINISH_THICKNESS + 1e-6 &&
          Math.abs(other.top - info.bottom) <= 0.01,
      )
      .map((other) => ({
        other,
        overlap: safeArea(() => intersection(info.polygon, other.polygon)),
      }))
      .sort((a, b) => b.overlap - a.overlap)[0]
    if (!support || support.overlap < info.area * 0.8) continue
    if (safeArea(() => intersection(info.polygon, roomArea)) < info.area * 0.5) continue
    info.kind = 'finish'
    info.support = support.other
  }
  return infos
}

function insidePart(polygon: Polygon, occupied: Polygon[]): { polygon?: Ring } {
  try {
    const [largest] = intersection(polygon, occupied).sort((a, b) => area([b]) - area([a]))
    return largest ? { polygon: largest.outer } : {}
  } catch {
    return {}
  }
}

function dominantTop(entries: { top: number; weight: number }[]): number | undefined {
  const weights = new Map<number, number>()
  for (const { top, weight } of entries) {
    const key = Math.round(top * 100)
    weights.set(key, (weights.get(key) ?? 0) + weight)
  }
  const [best] = [...weights].sort((a, b) => b[1] - a[1] || b[0] - a[0])
  if (!best) return undefined
  // The exact top of the heaviest entry in the winning centimetre.
  return entries
    .filter(({ top }) => Math.round(top * 100) === best[0])
    .sort((a, b) => b.weight - a.weight)[0]!.top
}

/**
 * Level floors: IFC floors that line up with the level's rooms become Pascal
 * room floors (base plate templates the kernel re-derives from the rooms,
 * carrying the IFC thickness and walking surface); thin finish slabs on them
 * become the rooms' floor finish. Everything else stays a hand-drawn slab.
 */
function assignLevelFloors(
  nodes: SceneNodes,
  levelId: string,
  rooms: PreviewRoom[],
  lowestLevel: boolean,
  stats: RoomFirstStats,
) {
  const slabs = Object.values(nodes).filter(
    (node): node is SlabNode =>
      node.type === 'slab' && node.parentId === levelId && !node.plateRole,
  )
  const infos = classifySlabs(slabs, rooms)
  const structural = infos.filter((info) => info.kind === 'structural')
  const finishes = infos.filter((info) => info.kind === 'finish')
  const walls = Object.values(nodes).filter(
    (node): node is WallNode => node.type === 'wall' && node.parentId === levelId,
  )
  const miters = calculateLevelMiters(walls)
  const wallArea = union(
    walls.map(
      (wall): Polygon => ({
        outer: getWallPlanFootprint(wall, miters).map(({ x, y }): Point => [x, y]),
        holes: [],
      }),
    ),
  )
  const occupied = union([...rooms.map((room) => room.polygon), ...wallArea])

  type FinishPart = { info: SlabInfo; parts: Polygon[]; share: number }
  type RoomFloor = {
    room: PreviewRoom
    slab: SlabInfo
    finishes: FinishPart[]
    top: number
    /** The room's clear floor lies on floors at this top (openings aside). */
    covered: boolean
    clear: Polygon[]
  }
  const floors: RoomFloor[] = []
  for (const room of rooms) {
    if (!(room.area > 1e-6)) continue
    // Holes in a floor are openings (they stay cut), not missing floor: a room
    // counts on the slab's outline, but must stand on some of its surface.
    const [slab] = structural
      .map((info) => ({
        info,
        cover: safeArea(() => intersection(room.polygon, info.polygon)) / room.area,
        outline:
          safeArea(() => intersection(room.polygon, { outer: info.polygon.outer, holes: [] })) /
          room.area,
      }))
      .filter((entry) => entry.outline >= 0.5 && entry.cover >= 0.1)
      .sort((a, b) => b.cover - a.cover || b.info.top - a.info.top)
    if (!slab) continue
    let clear: Polygon[] = [room.polygon]
    try {
      clear = difference(room.polygon, wallArea, { throwOnError: true })
    } catch {
      clear = [room.polygon]
    }
    const clearArea = area(clear)
    if (!(clearArea > 1e-6)) continue
    const level = union(
      structural
        .filter((info) => Math.abs(info.top - slab.info.top) <= FLOOR_TOP_TOLERANCE)
        .map((info) => ({ outer: info.polygon.outer, holes: [] })),
    )
    const uncovered = safeArea(() => difference(clear, level))
    const finishParts = finishes
      .filter((info) => info.support === slab.info)
      .map((info) => {
        const parts = intersection(clear, info.polygon)
        return { info, parts, share: area(parts) / clearArea }
      })
      .filter((entry) => entry.share >= 0.02)
      .sort((a, b) => b.share - a.share)
    const dominant = finishParts[0]
    floors.push({
      room,
      slab: slab.info,
      finishes: finishParts,
      top: dominant && dominant.share >= 0.5 ? dominant.info.top : slab.info.top,
      covered: uncovered <= Math.max(MAX_UNCOVERED_FLOOR, clearArea * MAX_UNCOVERED_SHARE),
      clear,
    })
  }
  const mainTop = dominantTop(floors.map((floor) => ({ top: floor.top, weight: floor.room.area })))

  const plates = new Set<SlabInfo>()
  for (const info of structural) {
    // A slab under part of a room stays hand-drawn rather than grow into a
    // plate under all of it; once it carries whole rooms, a room it only
    // partly floors joins the plate with its missing floor left open.
    const own = floors.filter((floor) => floor.slab === info)
    if (!own.some((floor) => floor.covered) || mainTop === undefined) continue
    const top = dominantTop(own.map((floor) => ({ top: floor.top, weight: floor.room.area })))!
    if (Math.abs(top - mainTop) > FLOOR_TOP_TOLERANCE) continue
    plates.add(info)
    const slab = nodes[info.slab.id] as SlabNode
    const bottom = info.bottom
    // Floor reaching well past the rooms (a terrace or plinth around the
    // house) stays a hand-drawn slab; the rooms' part becomes their floor.
    let outside: Polygon[] = []
    try {
      outside = difference(info.polygon, occupied, { throwOnError: true })
    } catch {
      outside = []
    }
    const split = area(outside) > Math.max(MAX_OVERHANG_AREA, info.area * MAX_OVERHANG_SHARE)
    if (split) {
      for (const [index, part] of outside.entries()) {
        if (area([part]) < MAX_OVERHANG_AREA / 2) continue
        attach(nodes, {
          ...slab,
          id: nextId('slab') as SlabNode['id'],
          name: `${slab.name ?? 'Slab'} (outside rooms${index ? ` ${index + 1}` : ''})`,
          polygon: part.outer,
          holes: part.holes,
          holeMetadata: part.holes.map(() => ({ source: 'manual' as const })),
          metadata: { ...slab.metadata, ifcSplit: 'outside-rooms' },
        })
        stats.manualFloors++
      }
    }
    const anyFloor = union(infos.map((other) => ({ outer: other.polygon.outer, holes: [] })))
    for (const floor of own) {
      if (floor.covered) continue
      for (const part of difference(floor.clear, anyFloor)) {
        if (area([part]) <= MAX_UNCOVERED_FLOOR) continue
        attach(
          nodes,
          FloorOpeningNode.parse({
            id: nextId('floor-opening'),
            type: 'floor-opening',
            name: 'Floor opening',
            parentId: levelId,
            polygon: part.outer,
            source: 'manual',
            drawnOn: 'floor',
            metadata: { ifcDerived: 'open-floor' },
          }),
        )
        stats.floorOpenings++
      }
    }
    for (const [index, hole] of slab.holes.entries()) {
      if (slab.holeMetadata[index]?.source !== 'manual' || hole.length < 3) continue
      const holeArea = safeArea(() => [{ outer: hole, holes: [] }])
      if (safeArea(() => intersection({ outer: hole, holes: [] }, occupied)) < holeArea * 0.5)
        continue
      attach(
        nodes,
        FloorOpeningNode.parse({
          id: nextId('floor-opening'),
          type: 'floor-opening',
          name: 'Floor opening',
          parentId: levelId,
          polygon: hole,
          source: 'manual',
          drawnOn: 'floor',
          metadata: { ifcHostExpressID: meta(slab).expressID },
        }),
      )
      stats.floorOpenings++
    }
    nodes[slab.id] = {
      ...slab,
      boundary: 'auto',
      plateRole: 'base',
      autoFromWalls: true,
      zoneIds: own.flatMap((floor) => (floor.room.zoneId ? [floor.room.zoneId] : [])),
      elevation: top,
      thickness: top - bottom,
      referenceFloorElevation: top,
      // A ground floor raised off the grade keeps a solid base under it.
      foundation: { type: lowestLevel && bottom > 0.05 ? 'solid' : 'none' },
      // The kernel re-derives the outline from the rooms; until then the
      // plate covers only its rooms' part, beside the split-off remainder.
      ...(split ? insidePart(info.polygon, occupied) : {}),
      holes: [],
      holeMetadata: [],
    } as SlabNode
    stats.floorPlates++
  }

  const represented = new Map<SlabInfo, number>()
  for (const floor of floors) {
    const zone = floor.room.zoneId ? nodes[floor.room.zoneId] : undefined
    if (zone?.type !== 'zone') continue
    if (plates.has(floor.slab)) {
      if (!floor.finishes.length) continue
      // The finish under most of the room is its floor finish; others (or all
      // of them, when none dominates) are painted regions clipped to the room.
      const [dominant, ...rest] = floor.finishes
      const whole = dominant!.share >= 0.5 ? dominant! : undefined
      const regions = (whole ? rest : floor.finishes).flatMap((entry) =>
        entry.parts.map((part, index) => ({
          id: `${entry.info.slab.id}_${zone.id}${index ? `_${index}` : ''}`,
          polygon: part.outer,
          finish: floorFinish(entry.info.slab),
        })),
      )
      zone.floor = {
        ...zone.floor,
        ...(whole ? { finish: floorFinish(whole.info.slab) } : {}),
        ...(regions.length ? { regions: [...(zone.floor?.regions ?? []), ...regions] } : {}),
      }
      zone.floorFinish = finishLabel((whole ?? dominant!).info.slab)
      for (const entry of floor.finishes)
        represented.set(entry.info, (represented.get(entry.info) ?? 0) + area(entry.parts))
      stats.roomFinishes++
      continue
    }
    // The room stands on a hand-drawn slab: the topmost one under most of it.
    const [finish] = floor.finishes
    zone.floor = {
      ...zone.floor,
      sourceSlabId: (finish && finish.share >= 0.5 ? finish.info : floor.slab).slab.id,
    }
    stats.manualFloors++
  }
  // A finish every part of which is now room finish no longer needs its slab.
  for (const info of finishes) {
    if (!info.support || !plates.has(info.support)) continue
    const visible = safeArea(() => difference(info.polygon, wallArea))
    if ((represented.get(info) ?? 0) >= visible * 0.97) detach(nodes, info.slab.id)
  }

  // Rooms and IFC spaces with no floor under them keep no floor.
  const floorArea = union(infos.filter((info) => info.kind !== 'other').map((info) => info.polygon))
  for (const zone of Object.values(nodes)) {
    if (zone.type !== 'zone' || zone.parentId !== levelId || zone.floor?.sourceSlabId) continue
    if (!isIfcSpace(zone) && meta(zone).ifcDerived !== 'wall-loop') continue
    const zoneArea = safeArea(() => [footprint(zone)])
    const covered = safeArea(() => intersection(footprint(zone), floorArea))
    if (zoneArea > 0 && covered < zoneArea * 0.1) zone.hasFloor = false
  }
}

function manualHolesWithin(
  ceiling: CeilingNode,
  polygon: Polygon,
): Pick<CeilingNode, 'holes' | 'holeMetadata'> {
  const holes = ceiling.holes
    .filter((_, index) => (ceiling.holeMetadata[index]?.source ?? 'manual') === 'manual')
    .flatMap((hole) => {
      try {
        return intersection({ outer: hole, holes: [] }, polygon).map((part) => part.outer)
      } catch {
        return []
      }
    })
    .filter((hole) => hole.length >= 3)
  return { holes, holeMetadata: holes.map(() => ({ source: 'manual' as const })) }
}

/**
 * IFC ceiling coverings become the ceilings of the rooms they cover, at the
 * covering's underside. When the file models ceilings, a room without one
 * has none; a file without any keeps Pascal's default room ceilings, except
 * for rooms the IFC gave no floor either (foundation cells, voids).
 */
function assignCeilings(nodes: SceneNodes, rooms: PreviewRoom[], stats: RoomFirstStats) {
  const coverings = Object.values(nodes).filter(
    (node): node is CeilingNode => node.type === 'ceiling' && meta(node).ifcType === 'IFCCOVERING',
  )
  const used = new Set<string>()
  for (const room of rooms) {
    const zone = room.zoneId ? nodes[room.zoneId] : undefined
    if (zone?.type !== 'zone') continue
    const [best] = coverings
      .filter((ceiling) => ceiling.parentId === room.levelId)
      .map((ceiling) => ({
        ceiling,
        cover: safeArea(() => intersection(room.polygon, footprint(ceiling))) / room.area,
      }))
      .filter((entry) => entry.cover >= 0.4)
      .sort((a, b) => b.cover - a.cover)
    if (!best) {
      if (coverings.length || zone.hasFloor === false) zone.hasCeiling = false
      continue
    }
    const linked: CeilingNode = {
      ...best.ceiling,
      id: used.has(best.ceiling.id) ? (nextId('ceiling') as CeilingNode['id']) : best.ceiling.id,
      name: `${zone.name} Ceiling`,
      polygon: room.polygon.outer,
      // The room redraws the outline; the covering's own cut-outs (hatches,
      // voids) stay as manual holes where they fall inside this room.
      ...manualHolesWithin(best.ceiling, room.polygon),
      boundary: 'auto',
      autoFromWalls: true,
      zoneId: zone.id,
    }
    if (used.has(best.ceiling.id)) attach(nodes, linked)
    else nodes[linked.id] = linked
    used.add(best.ceiling.id)
    zone.ceilingFinish = (best.ceiling.name ?? '').replace(/:\d+$/, '').slice(0, 120)
    stats.linkedCeilings++
  }
}

export function applyRoomFirstStructure(
  nodes: SceneNodes,
  wallBodySides: ReadonlyMap<string, Point>,
): RoomFirstStats {
  const stats: RoomFirstStats = {
    separators: 0,
    floorPlates: 0,
    manualFloors: 0,
    roomFinishes: 0,
    linkedCeilings: 0,
    floorOpenings: 0,
  }
  applyWallReferenceLines(nodes, wallBodySides)
  let rooms = previewRooms(nodes)
  stats.separators = addSpaceSeparators(nodes, rooms)
  if (stats.separators) rooms = previewRooms(nodes)
  materializeRooms(nodes, rooms)

  const levels = Object.values(nodes).filter((node) => node.type === 'level')
  for (const level of levels) {
    const lowest = !levels.some(
      (other) => other.parentId === level.parentId && other.level < level.level,
    )
    assignLevelFloors(
      nodes,
      level.id,
      rooms.filter((room) => room.levelId === level.id),
      lowest,
      stats,
    )
    // The level's floors are decided: the load migration's guesses for legacy
    // hand-drawn floors (adopting pieces, absorbing whole levels) stay off.
    nodes[level.id] = {
      ...level,
      metadata: { ...(level.metadata ?? {}), floorOwnershipMigrated: true },
    } as AnyNode
  }
  assignCeilings(nodes, rooms, stats)
  return stats
}
