import { floorRoomFaces } from '../lib/floor-room-faces'
import {
  area,
  difference,
  intersection,
  type Polygon,
  type Ring,
  union,
} from '../lib/polygon-boolean'
import { polygonInteriorPoint } from '../lib/polygon-label'
import type { RoomFace } from '../lib/room-graph'
import { roomNameAllocator } from '../lib/room-name'
import {
  adoptableFace,
  compareAdoptionFits,
  compareExistingRooms,
  existingRoomFace,
  type IdentityFace,
  ROOM_MATCH_IOU,
  type ZoneFaceFit,
  zoneFaceFits,
} from '../lib/room-zone-adoption'
import type { SeparatorNode } from '../schema/nodes/separator'
import type { WallNode } from '../schema/nodes/wall'
import { ZoneNode } from '../schema/nodes/zone'
import { calculateLevelMiters, getWallPlanFootprint } from '../systems/wall/wall-footprint'
import { loadMigration } from './load-migration'
import { omitUndefined } from './omit-undefined'

type SceneNodes = Record<string, any>
type Footprint = { polygon: Ring; holes?: Ring[] }

/** Visible outline change (m²) above which a legacy ceiling is not handed to its room. */
const LEGACY_CEILING_REDRAW_AREA = 0.01

export type RoomZoneMigration = {
  nodes: Record<string, unknown>
  createdZoneIds: string[]
  adoptedZoneIds: string[]
}

export type CeilingRoomLinkMigration = {
  nodes: Record<string, unknown>
  linkedCeilingIds: string[]
  /** Rooms M3 just migrated on a never-reconciled level that no legacy ceiling served: `hasCeiling: false`. */
  ceilinglessZoneIds: string[]
}

function facesByLevel(nodes: SceneNodes) {
  const boundaries = new Map<string, { walls: WallNode[]; separators: SeparatorNode[] }>()
  for (const node of Object.values(nodes)) {
    if (!node || nodes[node.parentId]?.type !== 'level') continue
    if (node.type !== 'wall' && node.type !== 'separator') continue
    const level = boundaries.get(node.parentId) ?? { walls: [], separators: [] }
    if (node.type === 'wall') level.walls.push(node)
    else level.separators.push(node)
    boundaries.set(node.parentId, level)
  }
  return new Map(
    [...boundaries]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([levelId, level]) => [
        levelId,
        floorRoomFaces([...level.walls, ...level.separators]).map(
          (room): RoomFace => ({
            key: room.id,
            polygon: room.referencePolygon,
            holes: room.holes,
            boundaryWallIds: [
              ...new Set(
                room.spans
                  .filter((span) => span.kind === 'wall')
                  .map((span) => span.boundaryId as WallNode['id']),
              ),
            ].sort(),
            boundarySeparatorIds: [
              ...new Set(
                room.spans
                  .filter((span) => span.kind === 'separator')
                  .map((span) => span.boundaryId as SeparatorNode['id']),
              ),
            ].sort(),
          }),
        ),
      ]),
  )
}

function polygonOf(footprint: Footprint): Polygon {
  return { outer: footprint.polygon, holes: footprint.holes ?? [] }
}

function footprintIoU(a: Footprint, b: Footprint): number {
  const left = polygonOf(a)
  const right = polygonOf(b)
  const combinedArea = area(union([left, right]))
  return combinedArea > 0 ? area(intersection(left, right)) / combinedArea : 0
}

function roomZoneId(levelId: string, face: RoomFace, attempt = 0): ZoneNode['id'] {
  const identity = JSON.stringify([
    levelId,
    [...face.boundaryWallIds].sort(),
    [...face.boundarySeparatorIds].sort(),
    ...(attempt ? [attempt] : []),
  ])
  // FNV-1a over UTF-8 is identical on the client and authority, including non-ASCII legacy IDs.
  let hash = 0xcbf29ce484222325n
  for (const byte of new TextEncoder().encode(identity)) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n)
  }
  return `zone_${hash.toString(36).padStart(16, '0')}`
}

function migrateRoomZonesOnView(sourceNodes: Record<string, unknown>): RoomZoneMigration {
  const nodes: SceneNodes = { ...sourceNodes }
  const createdZoneIds: string[] = []
  const adoptedZoneIds: string[] = []
  for (const [levelId, faces] of facesByLevel(nodes)) {
    const createdBefore = createdZoneIds.length
    const adoptedBefore = adoptedZoneIds.length
    const zones = Object.values(nodes)
      .filter(
        (node) =>
          node?.type === 'zone' && node.parentId === levelId && node.floor?.support !== 'open',
      )
      .sort((a, b) => a.id.localeCompare(b.id))
    const walls = Object.values(nodes).filter(
      (node): node is WallNode => node?.type === 'wall' && node.parentId === levelId,
    )
    const miters = calculateLevelMiters(walls)
    const footprints = new Map(
      walls.map((wall) => [
        wall.id,
        getWallPlanFootprint(wall, miters).map(({ x, y }): [number, number] => [x, y]),
      ]),
    )
    const adoptionFaces: IdentityFace[] = faces.map((face) => ({
      key: face.key,
      boundaryWallIds: face.boundaryWallIds,
      boundarySeparatorIds: face.boundarySeparatorIds,
      polygon: polygonOf(face),
      clear: difference(
        polygonOf(face),
        union(
          face.boundaryWallIds.flatMap((id) => (footprints.has(id) ? [footprints.get(id)!] : [])),
        ),
      ).sort((a, b) => area([b]) - area([a]))[0] ?? { outer: [], holes: [] },
    }))
    // Existing rooms keep their faces under the kernel's identity rule first, so a
    // reload never replaces one with a new room the kernel would then keep instead.
    const zoneByFace = new Map<number, any>()
    const matched = new Set<string>()
    const keeping = new Map<number, any[]>()
    for (const zone of zones) {
      if (zone.spaceRole !== 'room' || zone.autoFromWalls !== true) continue
      matched.add(zone.id)
      const index = existingRoomFace(zone, adoptionFaces)
      if (index !== undefined) keeping.set(index, [...(keeping.get(index) ?? []), zone])
    }
    for (const [index, rooms] of keeping)
      zoneByFace.set(index, rooms.sort(compareExistingRooms(adoptionFaces[index]!))[0])
    const candidates = new Map<number, { id: string; fit: ZoneFaceFit }[]>()
    for (const zone of zones) {
      if (matched.has(zone.id)) continue
      const fit = adoptableFace(zoneFaceFits(zone, adoptionFaces))
      if (!fit || zoneByFace.has(fit.face)) continue
      const list = candidates.get(fit.face) ?? []
      list.push({ id: zone.id, fit })
      candidates.set(fit.face, list)
    }
    for (const [index, list] of candidates)
      zoneByFace.set(index, nodes[list.sort(compareAdoptionFits)[0]!.id])
    const nextRoomName = roomNameAllocator(
      Object.values(nodes).filter((node) => node?.type === 'zone' && node.parentId === levelId),
    )
    faces.forEach((face, index) => {
      const zone = zoneByFace.get(index)
      if (zone) {
        const adopted = {
          ...zone,
          spaceRole: 'room',
          autoFromWalls: true,
          boundaryWallIds: face.boundaryWallIds,
          boundarySeparatorIds: face.boundarySeparatorIds,
          seed: zone.seed ?? polygonInteriorPoint(face, true),
          polygon: face.polygon,
          holes: face.holes,
        }
        if (JSON.stringify(zone) !== JSON.stringify(adopted)) {
          nodes[zone.id] = omitUndefined(adopted)
          adoptedZoneIds.push(zone.id)
        }
        return
      }
      let attempt = 0
      let id = roomZoneId(levelId, face)
      while (nodes[id]) id = roomZoneId(levelId, face, ++attempt)
      nodes[id] = omitUndefined(
        ZoneNode.parse({
          id,
          parentId: levelId,
          name: nextRoomName(),
          spaceRole: 'room',
          autoFromWalls: true,
          polygon: face.polygon,
          holes: face.holes,
          boundaryWallIds: face.boundaryWallIds,
          boundarySeparatorIds: face.boundarySeparatorIds,
          seed: polygonInteriorPoint(face, true),
        }),
      )
      const level = nodes[levelId]
      nodes[levelId] = omitUndefined({ ...level, children: [...(level.children ?? []), id] })
      createdZoneIds.push(id)
    })
    if (createdZoneIds.length !== createdBefore || adoptedZoneIds.length !== adoptedBefore) {
      const level = nodes[levelId]
      nodes[levelId] = {
        ...level,
        metadata: { ...level.metadata, legacyRoomMigrationPending: true },
      }
    }
  }
  return {
    nodes: createdZoneIds.length || adoptedZoneIds.length ? nodes : sourceNodes,
    createdZoneIds,
    adoptedZoneIds,
  }
}

function migrateCeilingRoomLinksOnView(
  sourceNodes: Record<string, unknown>,
): CeilingRoomLinkMigration {
  const nodes: SceneNodes = { ...sourceNodes }
  const linkedCeilingIds: string[] = []
  const ceilinglessZoneIds: string[] = []
  const zones = Object.values(nodes)
    .filter((node) => node?.type === 'zone' && node.spaceRole === 'room')
    .sort((a, b) => a.id.localeCompare(b.id))
  // Levels the room kernel has already written derived plates or ceilings on.
  const reconciledLevels = new Set(
    Object.values(nodes).flatMap((node) =>
      (node?.type === 'ceiling' || node?.type === 'slab') &&
      (node.boundary === 'auto' || node.plateRole)
        ? [node.parentId]
        : [],
    ),
  )
  let faces: ReturnType<typeof facesByLevel> | undefined
  const reachingWalls = new Map<string, Polygon[]>()
  // What of the ceiling's outline would change if the room redrew it, outside the
  // storey-high walls that hide it: the room face differs from the drawn outline there.
  const redrawnArea = (ceiling: any, zone: any) => {
    let walls = reachingWalls.get(ceiling.parentId)
    if (!walls) {
      const levelWalls = Object.values(nodes).filter(
        (node): node is WallNode => node?.type === 'wall' && node.parentId === ceiling.parentId,
      )
      const miters = calculateLevelMiters(levelWalls)
      walls = union(
        levelWalls
          .filter((wall) => wall.height == null)
          .map((wall) =>
            getWallPlanFootprint(wall, miters).map(({ x, y }): [number, number] => [x, y]),
          ),
      )
      reachingWalls.set(ceiling.parentId, walls)
    }
    // The room keeps the ceiling's own cutouts (stairs, manual holes) and adds its face's.
    const drawn: Polygon = { outer: ceiling.polygon, holes: ceiling.holes ?? [] }
    const cuts = union(ceiling.holes ?? [])
    const face = cuts.length ? difference(polygonOf(zone), cuts) : [polygonOf(zone)]
    const changed = union([...difference(drawn, face), ...difference(face, drawn)])
    return area(walls.length ? difference(changed, walls) : changed)
  }
  for (const [id, ceiling] of Object.entries(nodes)) {
    if (ceiling?.type !== 'ceiling' || nodes[ceiling.parentId]?.type !== 'level') continue
    // Overlapping stacked rooms already have authoritative ceiling links.
    if (ceiling.boundary === 'auto' && nodes[ceiling.zoneId]?.floor?.support === 'open') continue
    if (ceiling.autoFromWalls !== true) {
      if (ceiling.height !== undefined) continue
      faces ??= facesByLevel(nodes)
      if (
        !faces.get(ceiling.parentId)?.some((face) => footprintIoU(ceiling, face) >= ROOM_MATCH_IOU)
      )
        continue
    }
    const zone = zones.find(
      (candidate) =>
        candidate.floor?.support !== 'open' &&
        candidate.parentId === ceiling.parentId &&
        footprintIoU(ceiling, candidate) >= ROOM_MATCH_IOU,
    )
    if (!zone || (ceiling.zoneId === zone.id && ceiling.boundary === 'auto')) continue
    // Linking hands the outline to the room, which redraws it from the walls: a legacy
    // ceiling drawn elsewhere than its room face would visibly move, so it stays manual.
    if (ceiling.boundary !== 'auto' && redrawnArea(ceiling, zone) > LEGACY_CEILING_REDRAW_AREA)
      continue
    nodes[id] = omitUndefined({ ...ceiling, zoneId: zone.id, boundary: 'auto' })
    linkedCeilingIds.push(id)
  }
  // A legacy room keeps exactly the ceiling it had: one linked above, or none. Without
  // this the kernel would give every room it never had a ceiling a new one on load.
  // Only on the load that migrates the level (M3 marks it), so a reload writes nothing.
  const linkedZoneIds = new Set(
    Object.values(nodes).flatMap((node) =>
      node?.type === 'ceiling' && node.boundary === 'auto' && node.zoneId ? [node.zoneId] : [],
    ),
  )
  for (const zone of zones) {
    if (
      nodes[zone.parentId]?.metadata?.legacyRoomMigrationPending !== true ||
      reconciledLevels.has(zone.parentId) ||
      zone.hasCeiling === false ||
      zone.floor?.support === 'open' ||
      linkedZoneIds.has(zone.id)
    )
      continue
    nodes[zone.id] = { ...zone, hasCeiling: false }
    ceilinglessZoneIds.push(zone.id)
  }
  return {
    nodes: linkedCeilingIds.length || ceilinglessZoneIds.length ? nodes : sourceNodes,
    linkedCeilingIds,
    ceilinglessZoneIds,
  }
}

export const migrateRoomZones = loadMigration('room zones', migrateRoomZonesOnView, (nodes) => ({
  nodes,
  createdZoneIds: [],
  adoptedZoneIds: [],
}))

export const migrateCeilingRoomLinks = loadMigration(
  'ceiling room links',
  migrateCeilingRoomLinksOnView,
  (nodes) => ({ nodes, linkedCeilingIds: [], ceilinglessZoneIds: [] }),
)
