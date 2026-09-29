import {
  type AnyNode,
  area,
  type BoundaryNode,
  type BoundarySpan,
  containsPoint,
  createRoomTopologyIndex,
  getWallArcData,
  getWallFaceOffsets,
  type MultiPolygon,
  roomClearPolygon,
  type TopologyRoom,
  type WallNode,
  type ZoneNode,
} from '@pascal-app/core'
import type { SelectionModifierKeys } from './selection-routing'
import { polygonMatchesZoneFootprint } from './zone-content'

export type RoomKey = { levelId: string; zoneId: string }

export function sameRoom(a: RoomKey | null, b: RoomKey | null): boolean {
  return a === b || (!!a && !!b && a.levelId === b.levelId && a.zoneId === b.zoneId)
}

export function shouldSelectRoom(
  selected: RoomKey | null,
  hit: RoomKey | null,
  modifiers: SelectionModifierKeys,
): boolean {
  return (
    !!hit &&
    !sameRoom(selected, hit) &&
    !(modifiers.alt || modifiers.shift || modifiers.ctrl || modifiers.meta)
  )
}

export type RoomSelectionGeometry = TopologyRoom & {
  key: RoomKey
  boundaryWallIds: string[]
  clearPolygon: ReturnType<typeof roomClearPolygon>
  area: number
  hitPolygon: MultiPolygon
  /** A stacked open-below room (`floor.support: 'open'`) inside its host room. */
  mezzanine: { hostZoneId: string } | null
}

export type RoomSelectionRecord = RoomSelectionGeometry & {
  geometry: RoomSelectionGeometry
  name: string
  zoneId: string
  slabId: string | null
  slabName: string | null
  ceilingId: string | null
  ceilingName: string | null
}

type Nodes = Record<string, AnyNode>

function describeRoomGeometry(
  levelId: string,
  room: TopologyRoom,
  zone: ZoneNode,
): RoomSelectionGeometry {
  const clearPolygon = roomClearPolygon(room)
  return {
    ...room,
    key: { levelId, zoneId: zone.id },
    boundaryWallIds: [
      ...new Set(room.spans.filter((span) => span.kind === 'wall').map((span) => span.boundaryId)),
    ],
    clearPolygon,
    area: area([{ outer: zone.polygon, holes: zone.holes }]),
    hitPolygon: [{ outer: room.polygon, holes: room.holes }],
    mezzanine: null,
  }
}

export function isMezzanineZone(node: AnyNode | undefined): node is ZoneNode {
  return node?.type === 'zone' && node.floor?.support === 'open'
}

/**
 * A mezzanine as a selectable room. It has no walls of its own: its outline is
 * the zone's polygon, its floor the zone's own plate, and it bounds nothing.
 */
function describeMezzanineGeometry(
  levelId: string,
  zone: ZoneNode,
  context: TopologyRoom['context'],
): RoomSelectionGeometry {
  const polygon = zone.polygon.map(([x, z]) => [x, z] as [number, number])
  const holes = (zone.holes ?? []).map((ring) => ring.map(([x, z]) => [x, z] as [number, number]))
  const outline = [{ outer: polygon, holes }]
  return {
    id: `mezzanine:${zone.id}`,
    polygon,
    holes,
    spans: [],
    context,
    key: { levelId, zoneId: zone.id },
    boundaryWallIds: [],
    clearPolygon: outline,
    area: area(outline),
    hitPolygon: outline,
    mezzanine: { hostZoneId: zone.hostZoneId ?? '' },
  }
}

function describeRoom(
  geometry: RoomSelectionGeometry,
  candidates: readonly AnyNode[],
): RoomSelectionRecord {
  const { clearPolygon } = geometry
  const matches = (node: AnyNode) =>
    (node.type === 'zone' || node.type === 'slab' || node.type === 'ceiling') &&
    (polygonMatchesZoneFootprint(node.polygon, geometry.polygon) ||
      clearPolygon.some(({ outer }) => polygonMatchesZoneFootprint(node.polygon, outer)))
  const slab = geometry.mezzanine
    ? candidates.find(
        (node) =>
          node.type === 'slab' &&
          node.support === 'open' &&
          !!node.zoneIds?.includes(geometry.key.zoneId),
      )
    : candidates.find(
        (node) =>
          node.type === 'slab' && node.support !== 'open' && node.autoFromWalls && matches(node),
      )
  const ceiling = candidates.find(
    (node) => node.type === 'ceiling' && node.zoneId === geometry.key.zoneId,
  )
  const zone = candidates.find(
    (node): node is ZoneNode => node.type === 'zone' && node.id === geometry.key.zoneId,
  )!
  return {
    ...geometry,
    geometry,
    name: zone.name || 'Room',
    area: area([{ outer: zone.polygon, holes: zone.holes }]),
    zoneId: zone.id,
    slabId: slab?.id ?? null,
    slabName: slab ? slab.name || 'Slab' : null,
    ceilingId: ceiling?.id ?? null,
    ceilingName: ceiling ? ceiling.name || 'Ceiling' : null,
  }
}

type RoomHitIndex = Pick<
  ReturnType<typeof createRoomTopologyIndex>,
  'roomAtPoint' | 'roomForWallHit' | 'spansForWall'
> & {
  /** The selectable room a zone is (a mezzanine's own plate or ceiling points at it). */
  roomForZone?: (levelId: string, zoneId: string) => TopologyRoom | null
}
const wallFrames = new WeakMap<WallNode, ReturnType<typeof wallHitFrame>>()

function wallHitFrame(wall: WallNode) {
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const length = Math.hypot(dx, dz)
  const offsets = getWallFaceOffsets(wall)
  return {
    dx,
    dz,
    lengthSq: length * length,
    nx: -dz / length,
    nz: dx / length,
    arc: getWallArcData(wall),
    center: (offsets.a + offsets.b) / 2,
  }
}

export function resolveRoomHit<T extends RoomHitIndex>(
  index: T,
  levelId: string,
  node: AnyNode | null,
  point: [number, number],
  view?: '2d' | '3d',
): ReturnType<T['roomAtPoint']>
export function resolveRoomHit(
  index: RoomHitIndex,
  levelId: string,
  node: AnyNode | null,
  point: [number, number],
  view: '2d' | '3d' = '2d',
): TopologyRoom | null {
  // A mezzanine's plate (railing included) and ceiling name their own room; the
  // host floor under it and every other surface resolve by the point, which
  // never lands in a mezzanine.
  if (node?.type === 'slab' && node.support === 'open')
    return index.roomForZone?.(levelId, node.zoneIds?.[0] ?? '') ?? null
  if (node?.type === 'ceiling' && node.zoneId) {
    const own = index.roomForZone?.(levelId, node.zoneId)
    if (own) return own
  }
  if (!node || node.type === 'slab' || node.type === 'ceiling')
    return index.roomAtPoint(levelId, point)
  if (node.type !== 'wall') return null
  let frame = wallFrames.get(node)
  if (!frame) {
    frame = wallHitFrame(node)
    wallFrames.set(node, frame)
  }
  const { dx, dz, lengthSq, arc } = frame
  if (!lengthSq) return null
  const station = Math.max(
    0,
    Math.min(1, ((point[0] - node.start[0]) * dx + (point[1] - node.start[1]) * dz) / lengthSq),
  )
  let x = node.start[0] + station * dx
  let z = node.start[1] + station * dz
  let nx = frame.nx
  let nz = frame.nz
  if (arc) {
    const angle = Math.atan2(point[1] - arc.center.y, point[0] - arc.center.x)
    const delta = Math.atan2(Math.sin(angle - arc.startAngle), Math.cos(angle - arc.startAngle))
    const t = Math.max(0, Math.min(1, delta / arc.delta))
    const theta = arc.startAngle + arc.delta * t
    const cos = Math.cos(theta)
    const sin = Math.sin(theta)
    x = arc.center.x + cos * arc.radius
    z = arc.center.y + sin * arc.radius
    nx = -cos * arc.direction
    nz = -sin * arc.direction
  }
  const localZ = (point[0] - x) * nx + (point[1] - z) * nz
  // Justified bodies can lie entirely on one side of the reference line.
  const center = view === '3d' ? frame.center : 0
  const face = localZ >= center ? 'a' : 'b'
  // Room first: a face with no room behind it (the exterior) still resolves
  // to the room on the other face, or to the wall's only room; only walls
  // bounding no room reach the wall itself.
  return (
    index.roomForWallHit(levelId, node.id, face, station) ??
    index.roomForWallHit(levelId, node.id, face === 'a' ? 'b' : 'a', station) ??
    soleWallRoom(index, levelId, node.id)
  )
}

function soleWallRoom(index: RoomHitIndex, levelId: string, wallId: string) {
  let sole: BoundarySpan | null = null
  for (const span of index.spansForWall(levelId, wallId)) {
    if (sole && sole.roomId !== span.roomId) return null
    sole ??= span
  }
  return sole && index.roomForWallHit(levelId, wallId, sole.face, (sole.t0 + sole.t1) / 2)
}

function isBoundary(node: AnyNode): node is BoundaryNode {
  return node.type === 'wall' || node.type === 'separator'
}

function sameBoundary(a: BoundaryNode, b: AnyNode | undefined) {
  return (
    !!b &&
    isBoundary(b) &&
    a.type === b.type &&
    a.parentId === b.parentId &&
    a.start[0] === b.start[0] &&
    a.start[1] === b.start[1] &&
    a.end[0] === b.end[0] &&
    a.end[1] === b.end[1] &&
    (a.type === 'separator' ||
      (b.type === 'wall' &&
        a.curveOffset === b.curveOffset &&
        a.thickness === b.thickness &&
        a.justification === b.justification))
  )
}

export class RoomSelectionIndex {
  readonly topology = createRoomTopologyIndex()
  private nodes: Nodes | null = null
  private records: RoomSelectionRecord[] = []
  private geometry: RoomSelectionGeometry[] = []
  private candidates: AnyNode[] = []
  private revision = -1
  private readonly roomsById = new Map<string, RoomSelectionGeometry>()

  roomAtPoint(_levelId: string, point: [number, number]): RoomSelectionGeometry | null {
    for (const room of this.geometry)
      if (!room.mezzanine && containsPoint(room.hitPolygon, point)) return room
    return null
  }

  roomForZone(_levelId: string, zoneId: string): RoomSelectionGeometry | null {
    return this.geometry.find((room) => room.key.zoneId === zoneId) ?? null
  }

  roomForWallHit(
    levelId: string,
    wallId: string,
    face: 'a' | 'b',
    t: number,
  ): RoomSelectionGeometry | null {
    const spans = this.topology.getLevelTopology(levelId)?.spansByBoundary.get(wallId)
    if (!spans) return null
    for (const span of spans) {
      if (span.face === face && t >= span.t0 && (t < span.t1 || (t === 1 && span.t1 === 1)))
        return this.roomsById.get(span.roomId) ?? null
    }
    return null
  }

  spansForWall(levelId: string, wallId: string) {
    return this.topology.spansForWall(levelId, wallId)
  }

  constructor(readonly levelId: string) {}

  update(nodes: Nodes): RoomSelectionRecord[] {
    if (nodes === this.nodes) return this.records
    if (!this.nodes) this.topology.rebuildLevel(this.levelId, nodes)
    else {
      const changed = new Set<string>()
      for (const snapshot of [this.nodes, nodes]) {
        for (const node of Object.values(snapshot)) {
          if (
            isBoundary(node) &&
            node.parentId === this.levelId &&
            !sameBoundary(node, snapshot === nodes ? this.nodes[node.id] : nodes[node.id])
          )
            changed.add(node.id)
        }
      }
      if (changed.size) this.topology.applyWallDelta(this.levelId, changed, this.nodes, nodes)
    }
    this.nodes = nodes
    const topology = this.topology.getLevelTopology(this.levelId)
    const geometryChanged = topology?.revision !== this.revision
    const candidates = Object.values(nodes).filter(
      (node) =>
        node.parentId === this.levelId &&
        (node.type === 'slab' || node.type === 'ceiling' || node.type === 'zone'),
    )
    const candidatesChanged =
      candidates.length !== this.candidates.length ||
      candidates.some((node, i) => node !== this.candidates[i])
    if (!geometryChanged && !candidatesChanged) return this.records
    if (geometryChanged || candidatesChanged) {
      this.revision = topology?.revision ?? -1
      const previous = new Map(this.geometry.map((room) => [room.key.zoneId, room]))
      const matched = new Set<string>()
      const zones = candidates
        .filter(
          (node): node is ZoneNode =>
            node.type === 'zone' &&
            node.spaceRole === 'room' &&
            node.enclosureStatus !== 'open' &&
            !isMezzanineZone(node),
        )
        .sort((a, b) => a.id.localeCompare(b.id))
      this.geometry = (topology?.rooms ?? []).flatMap((room) => {
        const boundaryIds = [...new Set(room.spans.map((span) => span.boundaryId))].sort().join('|')
        const available = zones.filter((zone) => !matched.has(zone.id))
        const zone =
          available.find(
            (node) =>
              [...node.boundaryWallIds, ...node.boundarySeparatorIds].sort().join('|') ===
              boundaryIds,
          ) ??
          available.find(
            (node) =>
              !!node.seed && containsPoint([{ outer: room.polygon, holes: room.holes }], node.seed),
          )
        if (!zone) return []
        matched.add(zone.id)
        return [
          (!geometryChanged && previous.get(zone.id)) ||
            describeRoomGeometry(this.levelId, room, zone),
        ]
      })
      const context = topology?.rooms[0]?.context
      if (context)
        for (const zone of candidates) {
          if (!isMezzanineZone(zone) || zone.spaceRole !== 'room') continue
          const hosted =
            zone.hostZoneId && this.geometry.some((room) => room.key.zoneId === zone.hostZoneId)
          if (!hosted) continue
          this.geometry.push(describeMezzanineGeometry(this.levelId, zone, context))
        }
      this.roomsById.clear()
      for (const room of this.geometry) this.roomsById.set(room.id, room)
    }
    this.candidates = candidates
    this.records = this.geometry.map((room) => describeRoom(room, candidates))
    return this.records
  }
}
