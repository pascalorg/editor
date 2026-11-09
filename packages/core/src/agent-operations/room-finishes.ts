import { roomFloorPlate } from '../lib/room-floor-plate'
import {
  getCatalogMaterialById,
  getLibraryMaterialIdFromRef,
  getSceneMaterialIdFromRef,
} from '../material-library'
import type {
  AnyNode,
  CeilingNode,
  SceneMaterial,
  SlabNode,
  WallFace,
  WallNode,
  ZoneNode,
} from '../schema'
import { getWallZoneSpans, resolveWallFaceChain } from '../systems/wall/wall-finish'
import { levelIdOf, nodesOnLevel } from './scene-queries'
import type { SceneNodes } from './types'

/**
 * What the rooms of a level show, read from the scene: the finish of each room's floor, of the
 * wall faces that look into it and of its ceiling, and which rooms carry each finish. Pure facts
 * for the write tools' results and the reads, as the renderer resolves them:
 *
 * - a floor shows the room's painted parts over the room's own `floor.finish` over its floor
 *   plate's own surface (a slot older scenes carry: `paint` does not write a plate rooms derive);
 * - a wall face shows its painted parts over the room's override for that face over the room's
 *   `wallMaterial` over the wall's own finish (what `paint` writes on the wall);
 * - a ceiling shows the room's painted parts over the ceiling's own surface.
 *
 * The painted parts of a floor and a ceiling are named apart, never folded into the finish a room
 * shows as a whole; the painted parts of a wall face (`faceRegions`) are not read here. Nothing
 * written reads `default`, as `paint` says it.
 */

export type FinishFact = {
  /** The ref the finish is written as; null for the default and for an inline material. */
  ref: string | null
  name: string
  /** The library's kind (wood, tile, colors…), for a library material. */
  kind?: string
  /** The colour the library or the scene gives it, where it gives one. */
  color?: string
}

type Materials = Readonly<Record<string, SceneMaterial>> | undefined
type Finish = string | Record<string, unknown> | null | undefined

const DEFAULT_FINISH: FinishFact = { ref: null, name: 'default' }

/** Nobody chose a finish here: the surface shows what the kind declares. */
export const isDefaultFinish = (fact: FinishFact) =>
  fact.ref === null && fact.name === DEFAULT_FINISH.name

/** The colour an inline material (a stored finish record) or a scene material carries. */
function colourOf(spec: unknown): string | undefined {
  if (!spec || typeof spec !== 'object') return undefined
  const record = spec as Record<string, unknown>
  const own = (record.properties as Record<string, unknown> | undefined)?.color ?? record.color
  if (typeof own === 'string') return own
  return record.material ? colourOf(record.material) : undefined
}

/** A finish as its words: the library's name and kind, the scene material's name, or the ref. */
export function describeFinish(finish: Finish, materials?: Materials): FinishFact {
  if (finish === undefined || finish === null || finish === '') return DEFAULT_FINISH
  if (typeof finish !== 'string') {
    const color = colourOf(finish)
    return { ref: null, name: 'an inline material', ...(color ? { color } : {}) }
  }
  const libraryId = getLibraryMaterialIdFromRef(finish)
  if (libraryId) {
    const item = getCatalogMaterialById(libraryId)
    if (!item) return { ref: finish, name: finish }
    return {
      ref: finish,
      name: item.label,
      kind: item.category,
      ...(item.previewColor ? { color: item.previewColor } : {}),
    }
  }
  const sceneId = getSceneMaterialIdFromRef(finish)
  const scene = sceneId ? materials?.[sceneId] : undefined
  if (scene) {
    const color = colourOf(scene.material)
    return { ref: finish, name: scene.name, ...(color ? { color } : {}) }
  }
  return { ref: finish, name: finish }
}

/** One finish's identity, so rooms painted alike group together. */
const keyOf = (fact: FinishFact) =>
  fact.ref ?? (fact.name === DEFAULT_FINISH.name ? 'default' : `inline:${fact.color ?? ''}`)

/** What a plate or a ceiling shows of its own: its surface slot, else its older finish fields. */
const ownSurface = (node: SlabNode | CeilingNode | undefined): Finish =>
  node ? (node.slots?.surface ?? node.material ?? node.materialPreset) : undefined

export type RoomFinishes = {
  floor?: FinishFact & { regions?: { id: string; finish: FinishFact }[] }
  /** The wall faces that look into the room, by the finish each shows. */
  walls?: { faces: number; finishes: { finish: FinishFact; faces: number }[] }
  ceiling?: FinishFact & { regions?: { id: string; finish: FinishFact }[] }
}

const regionsOf = (
  regions: { id: string; finish: Finish }[] | undefined,
  materials: Materials,
): { regions?: { id: string; finish: FinishFact }[] } =>
  regions?.length
    ? { regions: regions.map((r) => ({ id: r.id, finish: describeFinish(r.finish, materials) })) }
    : {}

/** What one face of a wall shows to a room: the room's override for it, the room's finish, else the wall's own. */
export function wallFaceFinish(
  zone: ZoneNode,
  wall: WallNode,
  face: WallFace,
  materials: Materials,
): FinishFact {
  const override = zone.wallOverrides?.find(
    (entry) => entry.wallId === wall.id && entry.face === face,
  )
  let finish: Finish = override?.finish ?? zone.wallMaterial
  if (finish === undefined) {
    // The wall's own face: a chosen slot, an older finish, or nothing chosen.
    const own = resolveWallFaceChain(wall, face)
    finish =
      own.kind === 'ref'
        ? own.ref
        : own.kind === 'legacy'
          ? (own.spec.materialPreset ?? own.spec.material)
          : undefined
  }
  return describeFinish(finish as Finish, materials)
}

/** The wall faces that look into a room, and what each shows (the room's finish, else the wall's own). */
function wallFaceFinishes(nodes: SceneNodes, zone: ZoneNode, materials: Materials) {
  const shown = new Map<string, { finish: FinishFact; faces: number }>()
  let faces = 0
  for (const wallId of zone.boundaryWallIds ?? []) {
    const wall = nodes[wallId]
    if (wall?.type !== 'wall') continue
    const looking = new Set(getWallZoneSpans(wall as WallNode, [zone]).map((span) => span.face))
    for (const face of looking) {
      const fact = wallFaceFinish(zone, wall as WallNode, face, materials)
      const entry = shown.get(keyOf(fact)) ?? { finish: fact, faces: 0 }
      entry.faces += 1
      shown.set(keyOf(fact), entry)
      faces += 1
    }
  }
  return faces ? { faces, finishes: [...shown.values()] } : undefined
}

/** What one room shows, from the nodes of its level. */
export function roomFinishes(
  nodes: SceneNodes,
  zone: ZoneNode,
  content: readonly AnyNode[],
  materials?: Materials,
): RoomFinishes {
  const shown: RoomFinishes = {}
  if (zone.hasFloor !== false) {
    const slabs = content.filter((node): node is SlabNode => node.type === 'slab')
    shown.floor = {
      ...describeFinish(
        zone.floor?.finish ?? ownSurface(roomFloorPlate(slabs, zone.id)),
        materials,
      ),
      ...regionsOf(zone.floor?.regions, materials),
    }
  }
  const walls = wallFaceFinishes(nodes, zone, materials)
  if (walls) shown.walls = walls
  if (zone.hasCeiling !== false) {
    const ceiling = content.find(
      (node): node is CeilingNode => node.type === 'ceiling' && node.zoneId === zone.id,
    )
    if (ceiling)
      shown.ceiling = {
        ...describeFinish(ownSurface(ceiling), materials),
        ...regionsOf(zone.ceiling?.regions, materials),
      }
  }
  return shown
}

/** The finish a surface shows as a whole, its painted parts left aside. */
const wholeFinish = ({ ref, name, kind, color }: FinishFact): FinishFact => ({
  ref,
  name,
  ...(kind ? { kind } : {}),
  ...(color ? { color } : {}),
})

export type FinishGroup = { finish: FinishFact; rooms: string[] }

export type LevelFinishes = {
  levelId: string
  levelName?: string
  floors?: FinishGroup[]
  walls?: FinishGroup[]
  ceilings?: FinishGroup[]
}

const rooms = (content: readonly AnyNode[]) =>
  content.filter((node): node is ZoneNode => node.type === 'zone' && node.spaceRole === 'room')

export type FinishSurface = 'floors' | 'walls' | 'ceilings'

/**
 * The rooms of a level by the finish each surface shows: which finish, and the rooms it is in.
 * `surfaces` names the ones read and `roomIds` the rooms (all of them by default); null where no
 * room read shows any of them.
 */
export function levelFinishes(
  nodes: SceneNodes,
  levelId: string,
  materials?: Materials,
  surfaces: readonly FinishSurface[] = ['floors', 'walls', 'ceilings'],
  roomIds?: ReadonlySet<string>,
): LevelFinishes | null {
  const level = nodes[levelId]
  if (level?.type !== 'level') return null
  const content = nodesOnLevel(nodes, levelId)
  const floors = new Map<string, FinishGroup>()
  const walls = new Map<string, FinishGroup>()
  const ceilings = new Map<string, FinishGroup>()
  const add = (groups: Map<string, FinishGroup>, finish: FinishFact, room: string) => {
    const group = groups.get(keyOf(finish)) ?? { finish, rooms: [] }
    group.rooms.push(room)
    groups.set(keyOf(finish), group)
  }
  const named = rooms(content).filter((zone) => !roomIds || roomIds.has(zone.id))
  if (!named.length) return null
  for (const zone of named) {
    const shown = roomFinishes(nodes, zone, content, materials)
    if (shown.floor) add(floors, wholeFinish(shown.floor), zone.name)
    for (const entry of shown.walls?.finishes ?? [])
      add(
        walls,
        entry.finish,
        entry.faces < shown.walls!.faces
          ? `${zone.name} (${entry.faces} of ${shown.walls!.faces} wall faces)`
          : zone.name,
      )
    if (shown.ceiling) add(ceilings, wholeFinish(shown.ceiling), zone.name)
  }
  const read = (surface: FinishSurface, groups: Map<string, FinishGroup>) =>
    surfaces.includes(surface) && groups.size ? { [surface]: [...groups.values()] } : {}
  const shown = {
    ...read('floors', floors),
    ...read('walls', walls),
    ...read('ceilings', ceilings),
  }
  if (!Object.keys(shown).length) return null
  return { levelId, ...(level.name ? { levelName: level.name } : {}), ...shown }
}

/**
 * What the rooms a write changed now show, each surface for the rooms it was written on, read from
 * the scene as it stands: the rooms the call touched and no others, and no row for a finish none of
 * them shows (`default`: the rest of the level is `get_zones`'s). Per level; none where nothing is
 * left to say.
 */
export function changedFinishes(
  nodes: SceneNodes,
  written: Partial<Record<FinishSurface, readonly string[]>>,
  materials?: Materials,
): LevelFinishes[] {
  const byLevel = new Map<string, LevelFinishes>()
  for (const [surface, roomIds] of Object.entries(written) as [
    FinishSurface,
    readonly string[],
  ][]) {
    const levelIds = [...new Set(roomIds.flatMap((id) => levelIdOf(nodes, id) ?? []))]
    for (const levelId of levelIds) {
      const shown = levelFinishes(nodes, levelId, materials, [surface], new Set(roomIds))
      const groups = shown?.[surface]?.filter((group) => keyOf(group.finish) !== 'default')
      if (shown && groups?.length)
        byLevel.set(levelId, { ...byLevel.get(levelId), ...shown, [surface]: groups })
    }
  }
  return [...byLevel.values()]
}

/** The rooms that show a painted surface: those a wall's painted faces look into, a ceiling's room. */
export function roomsShowing(nodes: SceneNodes, node: AnyNode, roles: readonly string[]): string[] {
  if (node.type === 'ceiling') return node.zoneId ? [node.zoneId] : []
  if (node.type !== 'wall') return []
  const levelId = levelIdOf(nodes, node.id)
  if (!levelId) return []
  return rooms(nodesOnLevel(nodes, levelId))
    .filter(
      (zone) =>
        zone.boundaryWallIds?.includes(node.id) &&
        getWallZoneSpans(node, [zone]).some((span) => roles.includes(span.face)),
    )
    .map((zone) => zone.id)
}
