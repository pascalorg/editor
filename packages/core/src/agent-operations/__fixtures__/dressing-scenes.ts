import { building, graph, storey } from '../../coherence/__fixtures__/enclosure-scenes'
import { type AnyNode, ItemNode, WallNode, ZoneNode } from '../../schema'

/**
 * Two rooms side by side for the room-dressing rules, with a wall that both look at: a salon
 * (zone_salon, 0..4 m) and a bath (zone_bath, 4..8 m), 3 m deep, walls 2.5 m high. The south wall
 * runs the whole 8 m, so a stretch of one face belongs to each room; the partition wall_p has a room
 * on each of its faces. Plan axes: x east, z south.
 *
 *   wall_w   0,3 -> 0,0     salon   wall_s   0,0 -> 8,0   both (t 0..0.5 salon, 0.5..1 bath)
 *   wall_an  4,3 -> 0,3     salon   wall_p   4,0 -> 4,3   both
 *   wall_e   8,0 -> 8,3     bath    wall_bn  8,3 -> 4,3   bath
 */

export const WALL_HEIGHT = 2.5

type Pt = [number, number]

export const SALON: Pt[] = [
  [0, 0],
  [4, 0],
  [4, 3],
  [0, 3],
]
export const BATH: Pt[] = [
  [4, 0],
  [8, 0],
  [8, 3],
  [4, 3],
]

const WALLS: [id: string, start: Pt, end: Pt][] = [
  ['wall_s', [0, 0], [8, 0]],
  ['wall_p', [4, 0], [4, 3]],
  ['wall_an', [4, 3], [0, 3]],
  ['wall_w', [0, 3], [0, 0]],
  ['wall_e', [8, 0], [8, 3]],
  ['wall_bn', [8, 3], [4, 3]],
]

export type DressingOptions = {
  /** Fields merged into walls by id before they are parsed (a hand-drawn region, a trim, a curtain wall). */
  walls?: Record<string, Record<string, unknown>>
  /** Fields set on walls by id as they are, past the schema (a face script is too large to build). */
  raw?: Record<string, Record<string, unknown>>
  /** Items standing in the level, by id: [category, plan x, plan z, size w, d] */
  items?: Record<string, [category: string, x: number, z: number, width: number, depth: number, name?: string]>
  /** Fields merged into the rooms by id before they are parsed (a wall finish for the room). */
  zones?: Record<string, Record<string, unknown>>
  /** Nodes added as they are (a cabinet run and its modules). */
  extra?: AnyNode[]
}

export function twoRooms({
  walls = {},
  raw = {},
  zones = {},
  items = {},
  extra = [],
}: DressingOptions = {}) {
  const nodes: AnyNode[] = [building(), storey(3)]
  for (const [id, start, end] of WALLS)
    nodes.push({
      ...WallNode.parse({
        id,
        parentId: 'level_0',
        start,
        end,
        height: WALL_HEIGHT,
        thickness: 0.1,
        ...walls[id],
      }),
      ...raw[id],
    } as AnyNode)
  nodes.push(
    ZoneNode.parse({
      id: 'zone_salon',
      parentId: 'level_0',
      name: 'Salon',
      polygon: SALON,
      spaceRole: 'room',
      boundaryWallIds: ['wall_s', 'wall_p', 'wall_an', 'wall_w'],
      ...zones.zone_salon,
    }),
    ZoneNode.parse({
      id: 'zone_bath',
      parentId: 'level_0',
      name: 'Salle de bains',
      polygon: BATH,
      spaceRole: 'room',
      boundaryWallIds: ['wall_s', 'wall_e', 'wall_bn', 'wall_p'],
      ...zones.zone_bath,
    }),
  )
  for (const [id, [category, x, z, width, depth, name]] of Object.entries(items))
    nodes.push(
      ItemNode.parse({
        id,
        parentId: 'level_0',
        name: name ?? category,
        position: [x, 0, z],
        asset: {
          id: `asset_${id}`,
          category,
          name: name ?? category,
          thumbnail: '',
          src: 'https://example.com/x.glb',
          dimensions: [width, 2, depth],
        },
      }),
    )
  return graph(...nodes, ...extra)
}
