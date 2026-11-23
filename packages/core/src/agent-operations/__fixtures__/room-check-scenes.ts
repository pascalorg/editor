import { building, graph, rectangleWalls, storey } from '../../coherence/__fixtures__/enclosure-scenes'
import { type AnyNode, CeilingNode, ItemNode, SlabNode, WallNode, ZoneNode } from '../../schema'

/**
 * Houses of rooms side by side, for the room checks: each room is four walls, its zone, the floor
 * plate under it and the pieces standing in it. A room is what a check reads: a name, a floor and a wall finish, whether
 * its walls carry skirting, and the pieces as [category, design] (a catalog item) with, for an item an
 * agent authored, the script that made it and its size, finishes and name.
 */

/** An item an agent authored: the script that made it, which a copy for another room shares. */
export type Authored = {
  script?: string
  size?: [number, number, number]
  slots?: Record<string, string>
  name?: string
  /** Where it stands in its room, metres from the room's north-west corner; absent, in the row of pieces. */
  at?: [number, number]
}
export type PieceSpec = [category: string, design: string, authored?: Authored]

export type RoomSpec = {
  name: string
  /** A finish ref; null writes none, so the floor shows the default. */
  floor?: string | null
  /** A finish ref; null writes none, so the wall faces show the default. */
  walls?: string | null
  /** A finish ref for the outside face of its walls (paint by default); null writes none. */
  outside?: string | null
  /** `some`: the north and east walls only. */
  skirting?: boolean | 'some'
  /** A ceiling over the room: `default` leaves its surface unwritten, a ref paints it; absent, no ceiling. */
  ceiling?: 'default' | string
  /** What is under the room: its own plate (the default), a drawn slab it was taken from, or nothing. */
  under?: 'plate' | 'drawn' | 'none'
  /** Paint regions on the faces that look in: one wall (0 north, 1 east, 2 south, 3 west) or all four. */
  regions?: { wall?: number; u0?: number; u1?: number; v0?: number; v1?: number; finish: string }[]
  pieces?: PieceSpec[]
  /** Designs placed with place_design, by recipe name. */
  designs?: string[]
}

const ROOM = 4
const PITCH = 5

export const TILE = 'library:flooring-tiles3'
export const MARBLE = 'library:flooring-statuarettowhite'
export const PARQUET = 'library:wood-woodparquet14'
export const PAINT = 'library:preset-softwhite'

const piece = (
  id: string,
  [category, design, authored]: PieceSpec,
  at: [number, number, number],
): ItemNode => {
  const node = ItemNode.parse({
    id,
    parentId: 'level_0',
    name: authored?.name ?? `${category} ${id}`,
    position: at,
    ...(authored?.slots ? { slots: authored.slots } : {}),
    asset: {
      id: design,
      category,
      name: category,
      thumbnail: '',
      src: 'https://example.com/x.glb',
      dimensions: authored?.size ?? [0.5, 0.5, 0.5],
    },
  })
  return authored?.script
    ? ({ ...node, source: { kind: 'script', script: authored.script, params: {} } } as ItemNode)
    : node
}

/** A placed design, as the store holds it: a recipe and its parameters, standing on the floor. */
const design = (id: string, recipe: string, at: [number, number, number]) =>
  ({
    object: 'node',
    type: 'procedural-item',
    id,
    parentId: 'level_0',
    visible: true,
    metadata: {},
    name: recipe,
    recipe: { name: recipe },
    parameters: {},
    slots: {},
    position: at,
    rotation: [0, 0, 0],
    children: [],
    attachments: {},
  }) as unknown as AnyNode

export function house(...rooms: RoomSpec[]) {
  const nodes: AnyNode[] = [building(), storey(3)]
  rooms.forEach((room, index) => {
    const x0 = index * PITCH
    const walls = rectangleWalls('level_0', [x0, 0, x0 + ROOM, ROOM], undefined, 'interior', `wall_r${index}`)
    nodes.push(
      ...walls.map((wall, at) =>
        WallNode.parse({
          ...wall,
          ...(room.outside === null ? {} : { slots: { b: room.outside ?? PAINT } }),
          ...(room.skirting === true || (room.skirting === 'some' && at < 2)
            ? { skirting: { enabled: true, sides: 'both' } }
            : {}),
          faceRegions: (room.regions ?? [])
            .filter((region) => region.wall === undefined || region.wall === at)
            .map(({ wall: _wall, ...region }, n) => ({ id: `region_${at}_${n}`, face: 'a', ...region })),
        }),
      ),
      ...(room.under === 'none'
        ? []
        : [
            SlabNode.parse({
              id: `slab_${index}`,
              parentId: 'level_0',
              polygon: [
                [x0, 0],
                [x0 + ROOM, 0],
                [x0 + ROOM, ROOM],
                [x0, ROOM],
              ],
              ...(room.under === 'drawn' ? {} : { zoneIds: [`zone_${index}`], plateRole: 'base' }),
            }),
          ]),
      ...(room.ceiling
        ? [
            CeilingNode.parse({
              id: `ceiling_${index}`,
              parentId: 'level_0',
              polygon: [
                [x0, 0],
                [x0 + ROOM, 0],
                [x0 + ROOM, ROOM],
                [x0, ROOM],
              ],
              zoneId: `zone_${index}`,
              ...(room.ceiling === 'default' ? {} : { slots: { surface: room.ceiling } }),
            }),
          ]
        : []),
      ZoneNode.parse({
        id: `zone_${index}`,
        parentId: 'level_0',
        name: room.name,
        polygon: [
          [x0, 0],
          [x0 + ROOM, 0],
          [x0 + ROOM, ROOM],
          [x0, ROOM],
        ],
        spaceRole: 'room',
        autoFromWalls: true,
        boundaryWallIds: walls.map((wall) => wall.id),
        floor: {
          ...(room.floor === null ? {} : { finish: room.floor ?? PARQUET }),
          ...(room.under === 'drawn' ? { sourceSlabId: `slab_${index}` } : {}),
        },
        ...(room.walls === null ? {} : { wallMaterial: room.walls ?? PAINT }),
      }),
      ...(room.designs ?? []).map((recipe, at) =>
        design(`procedural-item_${index}_${at}`, recipe, [x0 + 1 + (at % 3), 0, 3]),
      ),
      ...(room.pieces ?? []).map((spec, at) =>
        piece(
          `item_${index}_${at}`,
          spec,
          spec[2]?.at
            ? [x0 + spec[2].at[0], 0, spec[2].at[1]]
            : [x0 + 1 + (at % 3), 0, 1 + Math.floor(at / 3)],
        ),
      ),
    )
  })
  return graph(...nodes)
}

const BED: [string, string] = ['bed', 'bed-a']
const NIGHTSTAND: [string, string] = ['nightstand', 'nightstand-a']
const WARDROBE: [string, string] = ['wardrobe', 'wardrobe-a']
export const BEDROOM_SET: [string, string][] = [BED, NIGHTSTAND, WARDROBE]
export const BATH_SET: [string, string][] = [
  ['toilets', 'toilet'],
  ['sinks', 'sink'],
  ['showers', 'shower'],
]
