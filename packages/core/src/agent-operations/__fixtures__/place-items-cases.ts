import { artifactUrl } from '../../lib/artifact-store'
import { scriptSource } from '../../lib/geometry-script-node'
import {
  type AnyNode,
  type AssetInput,
  BuildingNode,
  CeilingNode,
  DoorNode,
  GeometryArtifactManifest,
  ItemNode,
  LevelNode,
  WallNode,
  ZoneNode,
} from '../../schema'
import { compiledSolid } from './add-object-cases'
import type { AgentToolCase, SceneGraph } from './cases'
import { storeysScene } from './structure-cases'

/**
 * `place_items`: the chat's batch of floor items and the MCP's place_item, one tool. The chat's
 * rules win where they differed: an id the library lacks is refused, not placed as a 0.5 m
 * placeholder, and an indoor item outside every room is refused (a model once put a bed on the
 * lawn). As place_item did, an item may name its host (targetNodeId): a wall, a ceiling or an
 * item, its position in level coordinates as main took it. What goes wrong, written first: art
 * hung inside the wall or facing it; an item taller than its wall hung anyway; a lamp set on a
 * turned nightstand off its top; a bench on an add_object porch floating at the porch's full
 * height, or a pendant at a flat ceiling height under a sloped vault; a door taken for a host.
 *
 * The ground floor holds a 6 × 5 m hall; the upper floor has no room.
 */

const item = (id: string, name: string, category: string, tags: string[] = []): AssetInput => ({
  id,
  name,
  category,
  tags,
  thumbnail: `/items/${id}/thumbnail.webp`,
  src: `/items/${id}/model.glb`,
  dimensions: [1, 1, 1],
})

const CATALOG = [
  item('sofa', 'Sofa', 'furniture', ['seating']),
  item('floor-lamp', 'Floor Lamp', 'lighting'),
  item('palm', 'Palm', 'outdoor', ['tree', 'garden']),
]
const library = { activeLevelId: null, catalog: CATALOG }

const hosted = (
  id: string,
  dimensions: [number, number, number],
  attachTo?: 'wall' | 'wall-side' | 'ceiling',
): AssetInput => ({ ...item(id, id, 'decor'), dimensions, ...(attachTo ? { attachTo } : {}) })
const HOSTED_CATALOG = [
  hosted('art', [0.8, 0.6, 0.04], 'wall'),
  hosted('sconce', [0.2, 0.3, 0.15], 'wall-side'),
  hosted('pendant', [0.4, 0.5, 0.4], 'ceiling'),
  hosted('table-lamp', [0.3, 0.45, 0.3]),
  hosted('bench', [1.2, 0.45, 0.4]),
  hosted('wardrobe', [1, 2.8, 0.6]),
]
const hosts = { activeLevelId: null, catalog: HOSTED_CATALOG }

/**
 * A 6 × 5 m room: a wall along its south side, (0, 0) to (6, 0), 2.6 m high and 0.2 m thick, the
 * room on its left (front); its ceiling; a nightstand 0.55 m high at (1, 4), turned 90°, a vase
 * on it; a porch built with add_object at (4, 3), 2 × 2 m: a landing 0.3 m up, and a vault over it
 * sloping from 2.5 m (west) to 2.7 m (east); a door in the wall.
 */
export function hostScene(): SceneGraph {
  const room: [number, number][] = [
    [0, 0],
    [6, 0],
    [6, 5],
    [0, 5],
  ]
  const wall = WallNode.parse({
    id: 'wall_south',
    parentId: 'level_h',
    start: [0, 0],
    end: [6, 0],
    height: 2.6,
    thickness: 0.2,
    children: ['door_h'],
  })
  const door = DoorNode.parse({ id: 'door_h', parentId: wall.id, wallId: wall.id })
  const zone = ZoneNode.parse({ id: 'zone_room', parentId: 'level_h', name: 'Room', polygon: room })
  const ceiling = CeilingNode.parse({ id: 'ceiling_room', parentId: 'level_h', polygon: room })
  const nightstand = ItemNode.parse({
    id: 'item_nightstand',
    parentId: 'level_h',
    name: 'Nightstand',
    position: [1, 0, 4],
    rotation: [0, Math.PI / 2, 0],
    asset: { ...hosted('nightstand', [0.5, 0.55, 0.4]), src: '/items/nightstand/model.glb' },
    children: ['item_vase'],
  })
  const vase = ItemNode.parse({
    id: 'item_vase',
    parentId: nightstand.id,
    name: 'Vase',
    position: [0, 0.55, 0],
    asset: { ...hosted('vase', [0.15, 0.3, 0.15]), src: '/items/vase/model.glb' },
  })
  const square: [number, number][] = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]
  const solid = compiledSolid([2, 3, 2])
  const compiled = {
    ...solid,
    manifest: GeometryArtifactManifest.parse({
      ...solid.manifest,
      parts: [
        { id: 'landing', type: 'slab' },
        { id: 'vault', type: 'ceiling' },
      ],
      surfaces: [{ part: 'landing', y: 0.3, polygon: square }],
      // y = 2.6 + 0.1 x: −0.1 x + y − 2.6 = 0.
      undersides: [{ part: 'vault', polygon: square, plane: [-0.1, 1, 0, -2.6] }],
    }),
  }
  const porch = ItemNode.parse({
    id: 'item_porch',
    parentId: 'level_h',
    name: 'Porch',
    position: [4, 0, 3],
    source: scriptSource(compiled),
    asset: {
      id: `script_${compiled.sha256.slice(0, 16)}`,
      category: 'porch',
      name: 'Porch',
      thumbnail: '',
      source: 'mine',
      src: artifactUrl(compiled.sha256),
      dimensions: [2, 3, 2],
    },
  })
  const level = LevelNode.parse({
    id: 'level_h',
    parentId: 'building_h',
    level: 0,
    height: 2.8,
    children: [wall.id, zone.id, ceiling.id, nightstand.id, porch.id],
  })
  const building = BuildingNode.parse({ id: 'building_h', children: [level.id] })
  const nodes: AnyNode[] = [building, level, wall, door, zone, ceiling, nightstand, vase, porch]
  return { nodes: Object.fromEntries(nodes.map((node) => [node.id, node])), rootNodeIds: [building.id] }
}

/**
 * A bathroom, 2.2 × 1.9 m unless sized: its door, 0.8 m wide, in the middle of its south wall; the
 * catalog's 2.34 m bathtub (its only one), a 1.6 m bath and a vanity.
 */
export function bathScene([width, depth]: [number, number] = [2.2, 1.9]): SceneGraph {
  const room: [number, number][] = [
    [0, 0],
    [width, 0],
    [width, depth],
    [0, depth],
  ]
  const wall = WallNode.parse({
    id: 'wall_bath',
    parentId: 'level_b',
    start: [0, 0],
    end: [width, 0],
    thickness: 0.1,
    children: ['door_bath'],
  })
  const door = DoorNode.parse({
    id: 'door_bath',
    parentId: wall.id,
    wallId: wall.id,
    position: [width / 2, 1.05, 0],
    width: 0.8,
  })
  const zone = ZoneNode.parse({ id: 'zone_bath', parentId: 'level_b', name: 'Bath', polygon: room })
  const level = LevelNode.parse({
    id: 'level_b',
    parentId: 'building_b',
    level: 0,
    children: [wall.id, zone.id],
  })
  const building = BuildingNode.parse({ id: 'building_b', children: [level.id] })
  const nodes: AnyNode[] = [building, level, wall, door, zone]
  return { nodes: Object.fromEntries(nodes.map((node) => [node.id, node])), rootNodeIds: [building.id] }
}
export const BATH_CATALOG = [
  { ...item('bathtub', 'Bathtub', 'bathtubs'), dimensions: [2.34, 0.79, 1.11] },
  { ...item('bath-1600', 'Bath 1600', 'bathtubs'), dimensions: [1.6, 0.6, 0.75] },
  { ...item('vanity', 'Vanity', 'sinks'), dimensions: [0.6, 0.85, 0.45] },
] as AssetInput[]
const bath = { activeLevelId: null, catalog: BATH_CATALOG }

type Placed = AnyNode & {
  parentId: string
  position: number[]
  rotation: number[]
  wallId?: string
  wallT?: number
  side?: string
}
/** The item placed for an asset, with its fields. */
const placed = (nodes: Readonly<Record<string, AnyNode>>, assetId: string) =>
  Object.values(nodes).find(
    (node) => node.type === 'item' && (node as { asset: { id: string } }).asset.id === assetId,
  ) as Placed | undefined
const near = (a: number | undefined, b: number) => a !== undefined && Math.abs(a - b) < 1e-3
const at = (node: Placed | undefined, position: number[], label: string) =>
  node && position.every((value, i) => near(node.position[i], value))
    ? []
    : [`${label} at ${node?.position}`]

export const PLACE_ITEMS_CASES: AgentToolCase[] = [
  {
    name: 'items stand on the floor of the level named, turned in degrees',
    tool: 'place_items',
    scene: storeysScene,
    input: {
      levelId: 'level_ground',
      items: [
        { assetId: 'sofa', x: 2, z: 2, rotation: '90°' },
        { assetId: 'floor-lamp', x: 1, z: 1 },
      ],
    },
    context: library,
    expect: {
      result: { ok: true, levelId: 'level_ground' },
      contains: {
        items: [
          { ok: true, assetId: 'sofa', name: 'Sofa', x: 2, z: 2 },
          { ok: true, assetId: 'floor-lamp', name: 'Floor Lamp', x: 1, z: 1 },
        ],
      },
    },
  },
  {
    name: 'an id the library lacks is refused on its own; the others are placed',
    tool: 'place_items',
    scene: storeysScene,
    input: {
      level: 'level_ground',
      items: [
        { assetId: 'sofa', x: 2, z: 2 },
        { assetId: 'unicorn', x: 3, z: 3 },
      ],
    },
    context: library,
    expect: {
      result: { ok: false },
      contains: {
        items: [
          { ok: true, assetId: 'sofa' },
          { ok: false, assetId: 'unicorn', code: 'asset_not_found' },
        ],
      },
      mentions: ['search_assets', '1 of 2'],
    },
  },
  {
    name: 'an indoor item outside every room of a level with rooms is refused',
    tool: 'place_items',
    scene: storeysScene,
    input: { levelId: 'level_ground', items: [{ assetId: 'sofa', x: 10, z: 10 }] },
    context: library,
    expect: {
      result: { ok: false },
      contains: { items: [{ ok: false, assetId: 'sofa', code: 'outside_rooms' }] },
    },
  },
  {
    name: 'a garden item may stand outside the rooms',
    tool: 'place_items',
    scene: storeysScene,
    input: { levelId: 'level_ground', items: [{ assetId: 'palm', x: 10, z: 10 }] },
    context: library,
    expect: { result: { ok: true }, contains: { items: [{ ok: true, assetId: 'palm' }] } },
  },
  {
    name: 'a level without rooms takes items anywhere',
    tool: 'place_items',
    scene: storeysScene,
    input: { levelId: 'level_upper', items: [{ assetId: 'sofa', x: 10, z: 10 }] },
    context: library,
    expect: { result: { ok: true, levelId: 'level_upper' } },
  },
  {
    name: 'without a level, the floor the person is viewing',
    tool: 'place_items',
    scene: storeysScene,
    input: { items: [{ assetId: 'sofa', x: 10, z: 10 }] },
    context: { ...library, activeLevelId: 'level_upper' },
    surfaces: ['core', 'chat'],
    expect: { result: { levelId: 'level_upper' } },
  },
  {
    name: 'an unknown level is refused with the id',
    tool: 'place_items',
    scene: storeysScene,
    input: { levelId: 'level_missing', items: [{ assetId: 'sofa', x: 1, z: 1 }] },
    context: library,
    expect: { refusal: 'level_not_found', mentions: ['level_missing'] },
  },
  {
    name: 'art hangs on a wall at the height given, on the side of the point given',
    tool: 'place_items',
    scene: hostScene,
    input: { items: [{ assetId: 'art', targetNodeId: 'wall_south', x: 3, z: 0.4, y: 1.2 }] },
    context: hosts,
    expect: {
      result: { ok: true },
      contains: { items: [{ ok: true, assetId: 'art', hostId: 'wall_south', side: 'front' }] },
      check: (_result, nodes) => {
        const art = placed(nodes, 'art')
        return [
          ...at(art, [3, 1.2, 0], 'art'),
          ...(art?.parentId === 'wall_south' && art.wallId === 'wall_south' && near(art.wallT, 0.5)
            ? []
            : [`art on ${art?.parentId}, wallT ${art?.wallT}`]),
          ...(art?.side === 'front' && near(art.rotation[1], 0) ? [] : [`art faces ${art?.side}`]),
        ]
      },
    },
  },
  {
    name: "a point behind the wall hangs it on the wall's back, turned round",
    tool: 'place_items',
    scene: hostScene,
    input: { items: [{ assetId: 'art', targetNodeId: 'wall_south', x: 2, z: -0.4, y: 1.2 }] },
    context: hosts,
    expect: {
      result: { ok: true },
      contains: { items: [{ ok: true, side: 'back' }] },
      check: (_result, nodes) => {
        const art = placed(nodes, 'art')
        return art?.side === 'back' && near(Math.abs(art.rotation[1]!), Math.PI)
          ? []
          : [`art on the ${art?.side}, turned ${art?.rotation[1]}`]
      },
    },
  },
  {
    name: 'a wall-side fixture mounts on the face, not inside the wall',
    tool: 'place_items',
    scene: hostScene,
    input: { items: [{ assetId: 'sconce', targetNodeId: 'wall_south', x: 1, z: 0.4, y: 1.5 }] },
    context: hosts,
    expect: {
      result: { ok: true },
      check: (_result, nodes) => at(placed(nodes, 'sconce'), [1, 1.5, 0.1], 'sconce'),
    },
  },
  {
    name: 'a wall item needs its height; one taller than the wall is refused',
    tool: 'place_items',
    scene: hostScene,
    input: {
      items: [
        { assetId: 'art', targetNodeId: 'wall_south', x: 3, z: 0.4 },
        { assetId: 'wardrobe', targetNodeId: 'wall_south', x: 3, z: 0.4, y: 0 },
      ],
    },
    context: hosts,
    expect: {
      result: { ok: false },
      contains: {
        items: [
          { ok: false, assetId: 'art', code: 'height_required' },
          { ok: false, assetId: 'wardrobe', code: 'item_too_tall' },
        ],
      },
    },
  },
  {
    name: 'a pendant hangs flush under the ceiling, where it is given',
    tool: 'place_items',
    scene: hostScene,
    input: { items: [{ assetId: 'pendant', targetNodeId: 'ceiling_room', x: 2, z: 2 }] },
    context: hosts,
    expect: {
      result: { ok: true },
      contains: { items: [{ ok: true, hostId: 'ceiling_room' }] },
      check: (_result, nodes) => {
        const pendant = placed(nodes, 'pendant')
        return [
          ...at(pendant, [2, -0.5, 2], 'pendant'),
          ...(pendant?.parentId === 'ceiling_room' ? [] : [`pendant on ${pendant?.parentId}`]),
        ]
      },
    },
  },
  {
    name: "a lamp stands on a turned nightstand's top, in the nightstand's frame",
    tool: 'place_items',
    scene: hostScene,
    input: {
      items: [
        { assetId: 'table-lamp', targetNodeId: 'item_nightstand', x: 1, z: 4.1, rotation: 90 },
      ],
    },
    context: hosts,
    expect: {
      result: { ok: true },
      check: (_result, nodes) => {
        const lamp = placed(nodes, 'table-lamp')
        return [
          // 0.1 m south of its centre, which the 90° turn makes local −x.
          ...at(lamp, [-0.1, 0.55, 0], 'lamp'),
          ...(lamp?.parentId === 'item_nightstand' && near(lamp.rotation[1], 0)
            ? []
            : [`lamp on ${lamp?.parentId}, turned ${lamp?.rotation[1]}`]),
        ]
      },
    },
  },
  {
    name: "on an add_object porch a bench rests on its landing, and the result names it",
    tool: 'place_items',
    scene: hostScene,
    input: { items: [{ assetId: 'bench', targetNodeId: 'item_porch', x: 4.2, z: 3 }] },
    context: hosts,
    expect: {
      result: { ok: true },
      contains: { items: [{ ok: true, assetId: 'bench', restingOn: 'landing' }] },
      check: (_result, nodes) => at(placed(nodes, 'bench'), [0.2, 0.3, 0], 'bench'),
    },
  },
  {
    name: "a pendant hangs from the porch's sloped vault at the height above it",
    tool: 'place_items',
    scene: hostScene,
    input: { items: [{ assetId: 'pendant', targetNodeId: 'item_porch', x: 4.5, z: 3 }] },
    context: hosts,
    expect: {
      result: { ok: true },
      contains: { items: [{ ok: true, restingOn: 'vault' }] },
      // The vault is 2.65 m up 0.5 m east of the porch's centre; the pendant hangs its 0.5 m.
      check: (_result, nodes) => at(placed(nodes, 'pendant'), [0.5, 2.15, 0], 'pendant'),
    },
  },
  {
    name: 'a room or a slab as the target means its floor',
    tool: 'place_items',
    scene: hostScene,
    input: { items: [{ assetId: 'bench', targetNodeId: 'zone_room', x: 3, z: 2 }] },
    context: hosts,
    expect: {
      result: { ok: true },
      check: (_result, nodes) => {
        const bench = placed(nodes, 'bench')
        return [
          ...at(bench, [3, 0, 2], 'bench'),
          ...(bench?.parentId === 'level_h' ? [] : [`bench on ${bench?.parentId}`]),
        ]
      },
    },
  },
  {
    name: 'a door is no host, a missing host is named, and an item on an item hosts nothing more',
    tool: 'place_items',
    scene: hostScene,
    input: {
      items: [
        { assetId: 'table-lamp', targetNodeId: 'door_h', x: 3, z: 0.4 },
        { assetId: 'table-lamp', targetNodeId: 'item_gone', x: 3, z: 0.4 },
        { assetId: 'table-lamp', targetNodeId: 'item_vase', x: 1, z: 4 },
      ],
    },
    context: hosts,
    expect: {
      result: { ok: false },
      contains: {
        items: [
          { ok: false, code: 'unsupported_host' },
          { ok: false, code: 'host_not_found' },
          { ok: false, code: 'host_not_on_level' },
        ],
      },
    },
  },
  {
    // furnish_room skipped the tub as blocking the bath's door; an agent then put it there itself
    // with place_items, which checked only that its centre was in a room.
    name: 'an item in front of a door is refused, naming the door, with a spot that fits',
    tool: 'place_items',
    scene: bathScene,
    input: { items: [{ assetId: 'bath-1600', x: 1.1, z: 0.45 }] },
    context: bath,
    expect: {
      result: { ok: false },
      contains: { items: [{ ok: false, assetId: 'bath-1600', code: 'blocks_door' }] },
      mentions: ['door_bath', 'A spot that fits'],
    },
  },
  {
    name: 'an item larger than its room is refused with both sizes, pointing to a smaller one',
    tool: 'place_items',
    scene: bathScene,
    input: { items: [{ assetId: 'bathtub', x: 1.1, z: 1.3 }] },
    context: bath,
    expect: {
      result: { ok: false },
      contains: { items: [{ ok: false, assetId: 'bathtub', code: 'too_large_for_room' }] },
      mentions: ['2.34', '2.2 × 1.9', 'add_object'],
    },
  },
  {
    name: 'furnish_room names what it skips with its size',
    tool: 'furnish_room',
    // A bath of 3.1 × 2.2 m, large enough to be given a tub.
    scene: () => bathScene([3.1, 2.2]),
    input: { zoneId: 'zone_bath', roomType: 'bathroom' },
    context: bath,
    expect: { result: { ok: true }, mentions: ['bathtub (2.34 × 1.11 m)'] },
  },
  {
    name: 'an item clear of the door, inside its room, is placed',
    tool: 'place_items',
    scene: bathScene,
    input: {
      items: [
        { assetId: 'vanity', x: 1.8, z: 1.6 },
        { assetId: 'bath-1600', x: 1.1, z: 1.45 },
      ],
    },
    context: bath,
    expect: {
      result: { ok: true },
      contains: { items: [{ ok: true, assetId: 'vanity' }, { ok: true, assetId: 'bath-1600' }] },
    },
  },
  {
    name: 'a host without a library is refused rather than guessing',
    tool: 'place_items',
    scene: storeysScene,
    input: { levelId: 'level_ground', items: [{ assetId: 'sofa', x: 1, z: 1 }] },
    surfaces: ['core', 'chat'],
    expect: { refusal: 'no_catalog' },
  },
]
