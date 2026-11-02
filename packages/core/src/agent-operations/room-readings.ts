import {
  foldRoomName,
  isOutdoorRoom,
  isWetRoomUse,
  type RoomUse,
  roomUseOfName,
} from '../building/room-use'
import { getLevelDisplayName } from '../lib/level-name'
import { area, intersection, type Polygon, union } from '../lib/polygon-boolean'
import { roomDrawnFloor } from '../lib/room-drawn-floor'
import { roomFloorPlate } from '../lib/room-floor-plate'
import {
  type AnyNode,
  getScaledDimensions,
  getWallTrimFaces,
  type ItemNode,
  type SceneMaterial,
  type SlabNode,
  type WallFace,
  type WallNode,
  type ZoneNode,
} from '../schema'
import { getWallZoneSpans } from '../systems/wall/wall-finish'
import { itemLevelPose } from './item-space'
import { pointInPolygon } from './plan-geometry'
import { roomWallFaces } from './room-faces'
import { describeFinish, type FinishFact, isDefaultFinish, roomFinishes } from './room-finishes'
import { finishTiled, type Tiled } from './room-tile'
import { readWet, type WetReading } from './room-wet'
import { levelsOf, nodesOnLevel, queryNodes } from './scene-queries'
import type { SceneNodes } from './types'

/**
 * What each room of a scene shows and holds, read from the stored nodes alone (no brief, no model):
 * the use its name gives it, whether its floor or its wall faces are tiled, whether those faces
 * carry skirting, and the pieces standing in it. The room checks (`room-checks.ts`) judge these.
 */

export type RoomPiece = {
  id: string
  /**
   * What it is: a catalog or authored item's category, or, where the author gave only a generic one
   * ("furniture"), its name without the words of its room and its number; `cabinet-run`, `shelf`, a
   * placed design's recipe name.
   */
  kind: string
  /**
   * Which recipe: a catalog item's id; an authored item's script, whatever parameters, size and
   * colours it was run with (`script:<hash>`); a placed design's recipe; a run's make-up. Two pieces
   * made by one function for two rooms have two artifacts and one script.
   */
  design: string
  /**
   * An authored piece's size to 5 cm and its finishes: two pieces of one kind and one look are
   * alike though two scripts made them. Absent for a piece with a recipe of its own.
   */
  look?: string
  name: string
  /** A piece hung on a wall: the wall, the face it is on and the metres along the wall. */
  hung?: { wallId: string; face: WallFace; u: number }
}

export type RoomReading = {
  id: string
  name: string
  levelId: string
  levelName: string
  use: RoomUse
  /** False for a porch, alfresco, balcony or any room open on a side: no finish is owed there as indoors. */
  indoor: boolean
  /**
   * `fact` is what the floor shows as a whole, its painted parts (rugs) left aside; `atDefault` where nobody chose a finish and no
   * script lays it; `held` where a floor plate of its own, a drawn slab it was taken from, or slabs over half its footprint are under it.
   */
  floor: { finish: string; tiled: Tiled; fact: FinishFact; atDefault: boolean; held: boolean }
  /**
   * `facts` are the finishes the wall faces that look in show, each once.
   */
  walls: {
    finishes: string[]
    tiled: Tiled
    faces: number
    facts: FinishFact[]
  }
  /** A wet room's walls read against what a wet room is tiled to; absent for the other rooms. */
  wet?: WetReading
  skirting: { faces: number; withSkirting: number }
  pieces: RoomPiece[]
}

type Materials = Readonly<Record<string, SceneMaterial>> | undefined

const strongest = (readings: readonly Tiled[]): Tiled =>
  readings.includes('yes') ? 'yes' : readings.includes('unknown') ? 'unknown' : 'no'

/** Tiled on the floor or on the walls; `unknown` while either surface cannot be read and none is tile. */
export const roomTiled = (room: Pick<RoomReading, 'floor' | 'walls'>): Tiled =>
  strongest([room.floor.tiled, room.walls.tiled])

const finishWord = (fact: FinishFact) => fact.name

function readFloor(zone: ZoneNode, shown: ReturnType<typeof roomFinishes>, materials: Materials) {
  const facts = [
    shown.floor ?? { ref: null, name: 'default' },
    ...(shown.floor?.regions?.map((region) => region.finish) ?? []),
  ]
  const readings = facts.map((fact) => finishTiled(fact, materials))
  // A floor built by a script lays its own boards or tiles, and its words are not read here.
  if (zone.floor?.script) readings.push('unknown')
  const base = facts[0]!
  return {
    finish: finishWord(base),
    tiled: strongest(readings),
    fact: base,
    atDefault: isDefaultFinish(base) && !zone.floor?.script,
  }
}

const footprintOf = (node: {
  polygon: [number, number][]
  holes?: [number, number][][]
}): Polygon => ({
  outer: node.polygon,
  holes: node.holes ?? [],
})

/** Whether anything is under a room: its own plate, the drawn slab its floor was taken from, or slabs under most of its footprint. */
function floorHeld(nodes: SceneNodes, zone: ZoneNode): boolean {
  if (zone.floor?.support === 'open') return true
  const slabs = queryNodes<SlabNode>(nodes, { type: 'slab', parentId: zone.parentId }).filter(
    (node) => node.visible !== false && node.support !== 'open',
  )
  if (roomFloorPlate(slabs, zone.id) || roomDrawnFloor(nodes, zone.id)) return true
  const room = footprintOf(zone)
  const roomArea = area([room])
  return (
    roomArea > 1e-4 &&
    area(intersection(room, union(slabs.map((slab) => footprintOf(slab))))) >= roomArea / 2
  )
}

/** The floor a room shows, and, for a room whose floor is a drawn slab, that slab's surface when the room itself chose none. */
function floorOf(
  nodes: SceneNodes,
  zone: ZoneNode,
  shown: ReturnType<typeof roomFinishes>,
  materials: Materials,
): RoomReading['floor'] {
  const floor = readFloor(zone, shown, materials)
  const drawn = floor.atDefault ? roomDrawnFloor(nodes, zone.id) : null
  const slab = drawn ? nodes[drawn.slabId] : undefined
  const underSlab =
    slab?.type === 'slab'
      ? describeFinish(slab.slots?.surface ?? slab.material ?? slab.materialPreset, materials)
      : undefined
  return {
    ...floor,
    atDefault: floor.atDefault && (!underSlab || isDefaultFinish(underSlab)),
    held: floorHeld(nodes, zone),
  }
}

type WallPass = { walls: RoomReading['walls']; skirting: RoomReading['skirting'] }

/** The wall faces that look into a room: their finishes, and whether they carry skirting. */
function readWalls(
  nodes: SceneNodes,
  zone: ZoneNode,
  shown: ReturnType<typeof roomFinishes>,
  materials: Materials,
): WallPass {
  const shownFacts = (shown.walls?.finishes ?? []).map((entry) => entry.finish)
  const facts = new Map<string, FinishFact>(shownFacts.map((fact) => [finishWord(fact), fact]))
  const finishes = new Set(facts.keys())
  const tiled: Tiled[] = (shown.walls?.finishes ?? []).map((entry) =>
    finishTiled(entry.finish, materials),
  )
  let faces = 0
  let withSkirting = 0
  const seen = new Set<string>()
  for (const { wallId, face } of roomWallFaces(nodes, zone)) {
    if (seen.has(`${wallId}/${face}`)) continue
    seen.add(`${wallId}/${face}`)
    const wall = nodes[wallId] as WallNode
    faces += 1
    if (wall.skirting?.enabled && getWallTrimFaces(wall.skirting.sides).includes(face))
      withSkirting += 1
    for (const region of wall.faceRegions ?? []) {
      if (region.face !== face) continue
      const fact = describeFinish(region.finish, materials)
      finishes.add(finishWord(fact))
      facts.set(finishWord(fact), fact)
      tiled.push(finishTiled(fact, materials))
    }
    if (wall.finishScripts?.[face]) tiled.push('unknown')
  }
  return {
    walls: {
      finishes: [...finishes],
      // No wall faces known (a zone with no boundary walls) is not a wall read as bare.
      tiled: faces ? strongest(tiled) : 'unknown',
      faces,
      facts: [...facts.values()],
    },
    skirting: { faces, withSkirting },
  }
}

const fnv = (text: string) => {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

const round = (value: unknown) =>
  typeof value === 'number' ? Math.round(value * 100) / 100 : value

/** A cabinet run's make-up, without where it stands: the same run laid elsewhere is the same design. */
function runDesign(nodes: SceneNodes, run: AnyNode & { type: 'cabinet' }): string {
  const modules = run.children.flatMap((id) => {
    const module = nodes[id]
    if (module?.type !== 'cabinet-module') return []
    return [
      [
        module.moduleKind,
        module.cabinetType,
        round(module.width),
        (module.stack ?? []).map((compartment) => compartment.type),
      ],
    ]
  })
  return fnv(JSON.stringify([run.frontStyle, run.handleStyle, run.runTier, modules]))
}

type RawPiece = Omit<RoomPiece, 'kind'> & { category: string }
type Placed = { piece: RawPiece; point: [number, number] | null; zoneId?: string }

/** Where a catalog or scripted item stands in its level's plan, or the room it is already in. */
function placeItem(
  nodes: SceneNodes,
  byId: Map<string, AnyNode>,
  item: ItemNode,
  roomsOnLevel: readonly ZoneNode[],
): { point?: [number, number]; zoneId?: string; hung?: RoomPiece['hung'] } | null {
  let attached = item
  let root = item.parentId ? nodes[item.parentId] : undefined
  while (root?.type === 'item') {
    attached = root
    root = root.parentId ? nodes[root.parentId] : undefined
  }
  if (!root) return null
  if (root.type === 'ceiling' && root.zoneId && roomsOnLevel.some((z) => z.id === root.zoneId))
    return { zoneId: root.zoneId }
  if (root.type === 'wall') return placeOnWall(attached, root as WallNode, roomsOnLevel)
  if (root.type !== 'level' && root.type !== 'slab' && root.type !== 'ceiling') return null
  const pose = itemLevelPose(item, byId)
  return pose ? { point: [pose.position[0], pose.position[2]] } : null
}

/** An item hosted on a wall belongs to the room whose face it is on, at its station along the wall. */
function placeOnWall(
  item: { position: readonly number[]; side?: 'front' | 'back' },
  wall: WallNode,
  roomsOnLevel: readonly ZoneNode[],
): { zoneId: string; hung: NonNullable<RoomPiece['hung']> } | null {
  const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
  if (!(length > 0)) return null
  const station = (item.position[0] ?? 0) / length
  const faces: WallFace[] =
    item.side === 'front' ? ['a'] : item.side === 'back' ? ['b'] : ['a', 'b']
  for (const face of faces)
    for (const zone of roomsOnLevel) {
      const span = getWallZoneSpans(wall, [zone]).find(
        (s) => s.face === face && station >= s.t0 - 1e-6 && station <= s.t1 + 1e-6,
      )
      if (span)
        return { zoneId: zone.id, hung: { wallId: wall.id, face, u: item.position[0] ?? 0 } }
    }
  return null
}

const planArea = (zone: ZoneNode) =>
  Math.abs(
    zone.polygon.reduce((sum, [x, z], index) => {
      const next = zone.polygon[(index + 1) % zone.polygon.length]!
      return sum + x * next[1] - next[0] * z
    }, 0),
  ) / 2

/** The room whose plan holds a point; the smallest when rooms overlap (a landing inside a hall). */
function roomAt(point: [number, number], rooms: readonly ZoneNode[]): ZoneNode | undefined {
  return rooms
    .filter(
      (zone) =>
        pointInPolygon(point, zone.polygon as [number, number][]) &&
        !(zone.holes ?? []).some((hole) =>
          pointInPolygon(point, hole as [number, number][], false),
        ),
    )
    .sort((a, b) => planArea(a) - planArea(b))[0]
}

/** An authored item's size to 5 cm and its finishes, which two scripts' pieces can share. */
function itemLook(item: ItemNode): string {
  const size = getScaledDimensions(item)
    .map((metres) => (Math.round(metres / 0.05) * 0.05).toFixed(2))
    .join('x')
  const finishes = Object.entries(item.slots ?? {}).sort(([a], [b]) => a.localeCompare(b))
  return `${size}|${JSON.stringify(finishes)}`
}

const GENERIC_CATEGORIES = new Set([
  '',
  'furniture',
  'decor',
  'decoration',
  'object',
  'item',
  'other',
  'misc',
  'custom',
  'accessory',
  'accessories',
])

/** Words of a name, accents folded; the digits and the words of the room are what a piece is not. */
const wordsOf = (text: string) =>
  foldRoomName(text)
    .split(/[^a-z0-9]+/)
    .filter(Boolean)

/** Two words are one when equal or when long enough to share five letters ("parental", "parentale"). */
const sameWord = (a: string, b: string) =>
  a === b || (a.length >= 5 && b.length >= 5 && a.slice(0, 5) === b.slice(0, 5))

/**
 * What a piece is: its category, or, where the author gave only "furniture", its name without its
 * room's words and numbers ("Lit Chambre 3" and "Lit Chambre 4" are both a "lit").
 */
function pieceKind(category: string, name: string, roomName: string): string {
  if (!GENERIC_CATEGORIES.has(foldRoomName(category))) return category
  const room = wordsOf(roomName).filter((word) => word.length >= 3)
  const kept = wordsOf(name).filter(
    (word) => !/^\d+$/.test(word) && !room.some((other) => sameWord(word, other)),
  )
  return kept.join(' ') || 'piece'
}

/** The pieces standing in each room: catalog and scripted items, cabinet runs and shelves. */
function readPieces(nodes: SceneNodes, rooms: readonly ZoneNode[]): Map<string, RawPiece[]> {
  const byLevel = new Map<string, ZoneNode[]>()
  for (const zone of rooms) {
    const list = byLevel.get(zone.parentId ?? '') ?? []
    list.push(zone)
    byLevel.set(zone.parentId ?? '', list)
  }
  // biome-ignore lint/plugin: every piece, of any kind, is filed under the room it stands in
  const byId = new Map<string, AnyNode>(Object.entries(nodes))
  const found = new Map<string, RawPiece[]>()
  const put = (zoneId: string, piece: RawPiece) =>
    found.set(zoneId, [...(found.get(zoneId) ?? []), piece])
  // biome-ignore lint/plugin: every piece, of any kind, is filed under the room it stands in
  for (const node of Object.values(nodes)) {
    let placed: Placed | null = null
    if (node.type === 'item') {
      const levelId = levelOfNode(nodes, node)
      const here = byLevel.get(levelId ?? '') ?? []
      const where = here.length ? placeItem(nodes, byId, node, here) : null
      if (where)
        placed = {
          piece: {
            id: node.id,
            category: node.asset.category,
            design: node.source?.script ? `script:${node.source.script}` : node.asset.id,
            ...(node.source ? { look: itemLook(node) } : {}),
            name: node.name ?? node.asset.name,
            ...(where.hung ? { hung: where.hung } : {}),
          },
          point: where.point ?? null,
          zoneId: where.zoneId,
        }
    } else if (node.type === 'procedural-item') {
      // A design placed with place_design: on the floor, a slab or a ceiling, or hung on a wall.
      const parent = node.parentId ? nodes[node.parentId] : undefined
      const here = byLevel.get(levelOfNode(nodes, node) ?? '') ?? []
      const where =
        parent?.type === 'wall'
          ? placeOnWall(node, parent as WallNode, here)
          : parent?.type === 'level' || parent?.type === 'slab' || parent?.type === 'ceiling'
            ? { point: [node.position[0], node.position[2]] as [number, number] }
            : null
      if (where)
        placed = {
          piece: {
            id: node.id,
            category: node.recipe.name,
            design: `recipe:${fnv(JSON.stringify(node.recipe))}`,
            name: node.name ?? node.recipe.name,
            ...('hung' in where && where.hung ? { hung: where.hung } : {}),
          },
          point: 'point' in where ? where.point : null,
          zoneId: 'zoneId' in where ? where.zoneId : undefined,
        }
    } else if (node.type === 'cabinet' || node.type === 'shelf') {
      if (node.parentId && nodes[node.parentId]?.type === 'level')
        placed = {
          piece: {
            id: node.id,
            category: node.type === 'cabinet' ? 'cabinet-run' : 'shelf',
            design:
              node.type === 'cabinet'
                ? runDesign(nodes, node)
                : fnv(JSON.stringify([node.style, node.rows, node.columns, round(node.width)])),
            name: node.name ?? node.type,
          },
          point: [node.position[0], node.position[2]],
        }
    }
    if (!placed) continue
    const here = byLevel.get(levelOfNode(nodes, node) ?? '') ?? []
    const zoneId = placed.zoneId ?? (placed.point ? roomAt(placed.point, here)?.id : undefined)
    if (zoneId) put(zoneId, placed.piece)
  }
  return found
}

function levelOfNode(nodes: SceneNodes, node: AnyNode): string | null {
  const seen = new Set<string>()
  let at: AnyNode | undefined = node
  while (at && !seen.has(at.id)) {
    if (at.type === 'level') return at.id
    seen.add(at.id)
    at = at.parentId ? nodes[at.parentId] : undefined
  }
  return null
}

/** Room contents and openings along its wall spans, including either side of a shared doorway. */
export function roomIssueScope(nodes: SceneNodes, requested: string) {
  const wanted = requested.trim().toLowerCase()
  const zones = queryNodes<ZoneNode>(nodes, { type: 'zone' })
  const matched = zones.filter(
    (zone) => zone.id.toLowerCase() === wanted || zone.name.trim().toLowerCase() === wanted,
  )
  if (!matched.length) return []
  const pieces = readPieces(nodes, zones)
  return matched.map((zone) => {
    const nodeIds = new Set([zone.id, ...(pieces.get(zone.id) ?? []).map((piece) => piece.id)])
    for (const opening of queryNodes<AnyNode & { type: 'door' | 'window' }>(nodes, {
      type: ['door', 'window'],
    })) {
      const wall = nodes[opening.parentId ?? '']
      if (wall?.type !== 'wall' || levelOfNode(nodes, wall) !== zone.parentId) continue
      const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
      if (!(length > 0)) continue
      const station = opening.position[0] / length
      // Drawn rooms can lack derived boundary IDs; the wall-facing span still establishes ownership.
      if (
        getWallZoneSpans(wall, [{ ...zone, boundaryWallIds: [wall.id] }]).some(
          (span) => station >= span.t0 - 1e-6 && station <= span.t1 + 1e-6,
        )
      )
        nodeIds.add(opening.id)
    }
    return { roomId: zone.id, room: zone.name, nodeIds: [...nodeIds] }
  })
}

/**
 * Every room of the scene (a zone that is a room and has a floor) as the checks read it, in level
 * order then by name. `materials` are the scene's, when the host has them, to name `scene:` finishes.
 */
export function readRooms(
  nodes: SceneNodes,
  options: { materials?: Readonly<Record<string, SceneMaterial>> } = {},
): RoomReading[] {
  const { materials } = options
  const rooms: { zone: ZoneNode; levelName: string }[] = []
  for (const level of levelsOf(nodes)) {
    const levelName = getLevelDisplayName(level)
    for (const node of nodesOnLevel(nodes, level.id))
      if (node.type === 'zone' && node.spaceRole === 'room' && node.hasFloor !== false)
        rooms.push({ zone: node, levelName })
  }
  // biome-ignore lint/plugin: every piece, of any kind, is filed under the room it stands in
  const byId = new Map<string, AnyNode>(Object.entries(nodes))
  const pieces = readPieces(
    nodes,
    rooms.map(({ zone }) => zone),
  )
  return rooms.map(({ zone, levelName }) => {
    const content = nodesOnLevel(nodes, zone.parentId ?? '')
    const shown = roomFinishes(nodes, zone, content, materials)
    const { walls, skirting } = readWalls(nodes, zone, shown, materials)
    const use = roomUseOfName(zone.name)
    const roomPieces = (pieces.get(zone.id) ?? []).map(({ category, ...piece }) => ({
      ...piece,
      kind: pieceKind(category, piece.name, zone.name),
    }))
    return {
      id: zone.id,
      name: zone.name,
      levelId: zone.parentId ?? '',
      levelName,
      use,
      indoor: !isOutdoorRoom(zone),
      floor: floorOf(nodes, zone, shown, materials),
      walls,
      ...(isWetRoomUse(use) ? { wet: readWet(nodes, byId, zone, roomPieces, materials) } : {}),
      skirting,
      pieces: roomPieces,
    }
  })
}
