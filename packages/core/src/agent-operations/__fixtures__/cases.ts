import {
  type AnyNode,
  type AssetInput,
  BuildingNode,
  CeilingNode,
  DoorNode,
  GuideNode,
  ItemNode,
  LevelNode,
  RoofNode,
  RoofSegmentNode,
  SlabNode,
  StairNode,
  StairSegmentNode,
  UnitNode,
  WallNode,
  WindowNode,
  ZoneNode,
} from '../../schema'
import { CREATE_ROOM_CASES, FURNISH_ROOM_CASES } from './build-room-cases'
import { PLACE_ITEMS_CASES } from './place-items-cases'
import { FIND_BY_TYPE_CASES } from './find-by-type-cases'
import { ROOM_CASES } from './room-cases'
import { SEARCH_ASSETS_CASES } from './search-assets-cases'
import { ADD_LEVEL_CASES, ADD_WALL_CASES, CREATE_STAIR_CASES } from './structure-cases'
import { VERIFY_SCENE_CASES } from './verify-scene-cases'

/**
 * Edge cases of the agent tools that run as core operations, written before the operations. One
 * declarative table per tool; the core, MCP and chat runners each run every table, so the three
 * layers cannot disagree. `surfaces` narrows a case whose setup only one surface has (the chat
 * knows the floor a person is viewing; the MCP has no such thing and falls back to the lowest).
 * `after` lists fields some nodes must have once the operation's changes are applied.
 */

export type AgentSurface = 'core' | 'mcp' | 'chat'
export type SceneGraph = { nodes: Record<string, unknown>; rootNodeIds: string[] }

export type AgentToolCase = {
  name: string
  tool: string
  scene: () => SceneGraph
  input: Record<string, unknown>
  /** `catalog`: the item library the host hands search_assets. */
  context?: { activeLevelId?: string | null; catalog?: AssetInput[] }
  surfaces?: AgentSurface[]
  expect:
    | { refusal: string; mentions?: string[] }
    | {
        result: Record<string, unknown>
        present?: string[]
        absent?: string[]
        after?: Record<string, Record<string, unknown>>
        /** Arrays of the result that hold (or lack) an entry matching each partial object. */
        contains?: Record<string, Record<string, unknown>[]>
        lacks?: Record<string, Record<string, unknown>[]>
        /** Text the result must include. */
        mentions?: string[]
        /** What the table cannot state (minted ids, derived construction): the problems, if any. */
        check?: (result: Record<string, unknown>, nodes: Readonly<Record<string, AnyNode>>) => string[]
      }
}

const graph = (...nodes: { id: string }[]): SceneGraph => ({
  nodes: Object.fromEntries(nodes.map((node) => [node.id, node])),
  rootNodeIds: nodes
    .filter((node) => (node as { type?: string }).type === 'building')
    .map((node) => node.id),
})

const asset = (id: string, attachTo?: 'ceiling') => ({
  id,
  name: id,
  category: 'furniture',
  thumbnail: `/items/${id}/thumbnail.webp`,
  src: `/items/${id}/model.glb`,
  dimensions: [1, 1, 1] as [number, number, number],
  ...(attachTo ? { attachTo } : {}),
})

// ─── A house of two storeys with its roof on a level of its own, and a shed on a support level ──
//
// Ground: a 4 m wall (2.5 m, a door and a window), a 4 m wall with no height of its own off the
// slab (the 2.8 m storey decides), a 4 × 3 m living room with a slab and a ceiling carrying a lamp,
// a sofa, a stair, and a plan reference. The living room is the flat's only room.

function houseScene(): SceneGraph {
  const door = DoorNode.parse({
    id: 'door_ground',
    parentId: 'wall_ground',
    wallId: 'wall_ground',
    position: [1, 1.05, 0],
  })
  const window = WindowNode.parse({
    id: 'window_ground',
    parentId: 'wall_ground',
    wallId: 'wall_ground',
    position: [3, 1.65, 0],
  })
  const wall = WallNode.parse({
    id: 'wall_ground',
    parentId: 'level_ground',
    start: [0, 0],
    end: [4, 0],
    height: 2.5,
    children: [door.id, window.id],
  })
  const { height: _height, ...sideWall } = WallNode.parse({
    id: 'wall_side',
    parentId: 'level_ground',
    start: [0, 5],
    end: [4, 5],
  })
  const room = [
    [0, 0],
    [4, 0],
    [4, 3],
    [0, 3],
  ] as [number, number][]
  const zone = ZoneNode.parse({
    id: 'zone_ground',
    parentId: 'level_ground',
    name: 'Living',
    polygon: room,
  })
  const slab = SlabNode.parse({ id: 'slab_ground', parentId: 'level_ground', polygon: room })
  const lamp = ItemNode.parse({
    id: 'item_lamp',
    parentId: 'ceiling_ground',
    position: [2, 0, 1.5],
    asset: asset('lamp', 'ceiling'),
  })
  const ceiling = CeilingNode.parse({
    id: 'ceiling_ground',
    parentId: 'level_ground',
    polygon: room,
    children: [lamp.id],
  })
  const sofa = ItemNode.parse({
    id: 'item_sofa',
    parentId: 'level_ground',
    position: [2, 0, 2],
    asset: asset('sofa'),
  })
  const flight = StairSegmentNode.parse({ id: 'sseg_main', parentId: 'stair_main' })
  const stair = StairNode.parse({
    id: 'stair_main',
    parentId: 'level_ground',
    position: [3, 0, 2],
    children: [flight.id],
  })
  const plan = GuideNode.parse({
    id: 'guide_plan',
    parentId: 'level_ground',
    url: '/plans/ground.svg',
  })
  const upperWall = WallNode.parse({
    id: 'wall_upper',
    parentId: 'level_upper',
    start: [0, 0],
    end: [4, 0],
    height: 2.5,
  })
  const roofSegment = RoofSegmentNode.parse({ id: 'rseg_main', parentId: 'roof_main' })
  const roof = RoofNode.parse({
    id: 'roof_main',
    parentId: 'level_roof',
    children: [roofSegment.id],
  })
  const ground = LevelNode.parse({
    id: 'level_ground',
    parentId: 'building_house',
    level: 0,
    name: 'Ground',
    height: 2.8,
    children: [wall.id, sideWall.id, zone.id, slab.id, ceiling.id, sofa.id, stair.id, plan.id],
  })
  const upper = LevelNode.parse({
    id: 'level_upper',
    parentId: 'building_house',
    level: 1,
    name: 'Upper',
    height: 2.8,
    children: [upperWall.id],
  })
  const roofLevel = LevelNode.parse({
    id: 'level_roof',
    parentId: 'building_house',
    level: 2,
    name: 'Roof',
    height: 2.8,
    children: [roof.id],
  })
  const flat = UnitNode.parse({
    id: 'unit_flat',
    parentId: 'building_house',
    name: 'Flat',
    members: [zone.id],
  })
  const house = BuildingNode.parse({
    id: 'building_house',
    children: [roofLevel.id, ground.id, upper.id, flat.id],
  })
  const shedLevel = LevelNode.parse({
    id: 'level_shed',
    parentId: 'building_shed',
    level: -1,
    name: 'Shed',
    height: 2.4,
    metadata: { role: 'support' },
  })
  const shed = BuildingNode.parse({ id: 'building_shed', children: [shedLevel.id] })
  return graph(
    house,
    ground,
    upper,
    roofLevel,
    flat,
    wall,
    door,
    window,
    sideWall as WallNode,
    zone,
    slab,
    ceiling,
    lamp,
    sofa,
    stair,
    flight,
    plan,
    upperWall,
    roof,
    roofSegment,
    shed,
    shedLevel,
  )
}

const emptyScene = (): SceneGraph => ({ nodes: {}, rootNodeIds: [] })

/** A level no building holds. */
function orphanLevelScene(): SceneGraph {
  const level = LevelNode.parse({ id: 'level_orphan', level: 0 })
  return { nodes: { [level.id]: level }, rootNodeIds: [] }
}

export const LIST_LEVELS_CASES: AgentToolCase[] = [
  {
    name: 'every level of every building, in floor order, with its role',
    tool: 'list_levels',
    scene: houseScene,
    input: {},
    expect: {
      result: {
        levelCount: 4,
        occupiedStoryCount: 2,
        supportLevelCount: 2,
        roofLevelIds: ['level_roof'],
        levels: [
          {
            id: 'level_shed',
            floorIndex: -1,
            role: 'support',
            isOccupiedStory: false,
            parentId: 'building_shed',
            childCount: 0,
          },
          {
            id: 'level_ground',
            floorIndex: 0,
            role: 'occupied',
            isOccupiedStory: true,
            parentId: 'building_house',
            childCount: 8,
          },
          {
            id: 'level_upper',
            floorIndex: 1,
            role: 'occupied',
            isOccupiedStory: true,
            childCount: 1,
          },
          { id: 'level_roof', floorIndex: 2, role: 'roof', isOccupiedStory: false, childCount: 1 },
        ],
      },
    },
  },
  {
    name: 'the floor a person is viewing is marked active',
    tool: 'list_levels',
    scene: houseScene,
    input: {},
    context: { activeLevelId: 'level_upper' },
    surfaces: ['core', 'chat'],
    expect: {
      result: {
        activeLevelId: 'level_upper',
        levels: [
          { id: 'level_shed', isActive: false },
          { id: 'level_ground', isActive: false },
          { id: 'level_upper', isActive: true },
          { id: 'level_roof', isActive: false },
        ],
      },
    },
  },
  {
    name: 'with no viewed floor nothing is active',
    tool: 'list_levels',
    scene: houseScene,
    input: {},
    expect: { result: { activeLevelId: null } },
  },
  {
    name: 'an empty scene lists no levels rather than failing',
    tool: 'list_levels',
    scene: emptyScene,
    input: {},
    expect: { result: { levelCount: 0, occupiedStoryCount: 0, roofLevelIds: [], levels: [] } },
  },
]

export const GET_NODE_CASES: AgentToolCase[] = [
  {
    name: 'a node comes whole, children included',
    tool: 'get_node',
    scene: houseScene,
    input: { id: 'wall_ground' },
    expect: {
      result: {
        node: {
          id: 'wall_ground',
          type: 'wall',
          start: [0, 0],
          end: [4, 0],
          children: ['door_ground', 'window_ground'],
        },
      },
    },
  },
  {
    name: 'metadata comes with the node',
    tool: 'get_node',
    scene: houseScene,
    input: { id: 'level_shed' },
    expect: { result: { node: { id: 'level_shed', metadata: { role: 'support' } } } },
  },
  {
    name: 'an unknown id is refused',
    tool: 'get_node',
    scene: houseScene,
    input: { id: 'wall_missing' },
    expect: { refusal: 'node_not_found', mentions: ['wall_missing'] },
  },
]

// Which level a level-scoped read targets: the id given, else the viewed floor, else the lowest
// occupied storey. Run through get_walls; get_zones and get_level_summary share the resolver.
export const LEVEL_TARGET_CASES: AgentToolCase[] = [
  {
    name: 'the level given is the level read',
    tool: 'get_walls',
    scene: houseScene,
    input: { levelId: 'level_upper' },
    expect: { result: { levelId: 'level_upper', walls: [{ id: 'wall_upper' }] } },
  },
  {
    name: 'the viewed floor is the default',
    tool: 'get_walls',
    scene: houseScene,
    input: {},
    context: { activeLevelId: 'level_upper' },
    surfaces: ['core', 'chat'],
    expect: { result: { levelId: 'level_upper' } },
  },
  {
    name: 'with no viewed floor, the lowest storey, not a support level below it',
    tool: 'get_walls',
    scene: houseScene,
    input: {},
    expect: { result: { levelId: 'level_ground' } },
  },
  {
    name: 'level is an alias of levelId',
    tool: 'get_zones',
    scene: houseScene,
    input: { level: 'level_upper' },
    expect: { result: { levelId: 'level_upper', zones: [] } },
  },
  {
    name: 'equal levelId and level agree',
    tool: 'get_walls',
    scene: houseScene,
    input: { levelId: 'level_upper', level: 'level_upper' },
    expect: { result: { levelId: 'level_upper' } },
  },
  {
    name: 'different levelId and level are refused',
    tool: 'get_walls',
    scene: houseScene,
    input: { levelId: 'level_ground', level: 'level_upper' },
    expect: { refusal: 'conflicting_level' },
  },
  {
    name: 'an unknown level is refused',
    tool: 'get_zones',
    scene: houseScene,
    input: { levelId: 'level_missing' },
    expect: { refusal: 'level_not_found', mentions: ['level_missing'] },
  },
  {
    name: 'a node that is not a level is refused',
    tool: 'get_level_summary',
    scene: houseScene,
    input: { levelId: 'wall_ground' },
    expect: { refusal: 'not_a_level', mentions: ['wall'] },
  },
  {
    name: 'a scene with no level is refused',
    tool: 'get_walls',
    scene: emptyScene,
    input: {},
    expect: { refusal: 'no_levels' },
  },
]

export const GET_WALLS_CASES: AgentToolCase[] = [
  {
    name: 'walls come with length, heights and their openings',
    tool: 'get_walls',
    scene: houseScene,
    input: { levelId: 'level_ground' },
    expect: {
      result: {
        levelId: 'level_ground',
        walls: [
          {
            id: 'wall_ground',
            start: [0, 0],
            end: [4, 0],
            length: 4,
            height: 2.5,
            resolvedHeight: 2.5,
            heightIsExplicit: true,
            openings: [
              { id: 'door_ground', type: 'door' },
              { id: 'window_ground', type: 'window' },
            ],
          },
          {
            id: 'wall_side',
            length: 4,
            resolvedHeight: 2.8,
            heightIsExplicit: false,
            openings: [],
          },
        ],
      },
    },
  },
]

export const GET_ZONES_CASES: AgentToolCase[] = [
  {
    name: 'zones come with polygon, area and size',
    tool: 'get_zones',
    scene: houseScene,
    input: { levelId: 'level_ground' },
    expect: {
      result: {
        levelId: 'level_ground',
        zones: [
          {
            id: 'zone_ground',
            name: 'Living',
            polygon: [
              [0, 0],
              [4, 0],
              [4, 3],
              [0, 3],
            ],
            areaSqMeters: 12,
            bounds: { width: 4, depth: 3 },
          },
        ],
      },
    },
  },
]

export const GET_LEVEL_SUMMARY_CASES: AgentToolCase[] = [
  {
    name: 'a storey: its role, counts and everything on it',
    tool: 'get_level_summary',
    scene: houseScene,
    input: { levelId: 'level_ground' },
    expect: {
      result: {
        levelId: 'level_ground',
        levelName: 'Ground',
        floorIndex: 0,
        role: 'occupied',
        isOccupiedStory: true,
        counts: {
          walls: 2,
          zones: 1,
          doors: 1,
          windows: 1,
          items: 2,
          slabs: 1,
          ceilings: 1,
          stairs: 1,
          roofs: 0,
        },
        walls: [
          { id: 'wall_ground', openings: [{ id: 'door_ground' }, { id: 'window_ground' }] },
          { id: 'wall_side' },
        ],
        zones: [{ id: 'zone_ground', name: 'Living', areaSqMeters: 12 }],
        slabs: [{ id: 'slab_ground' }],
        ceilings: [{ id: 'ceiling_ground', itemCount: 1 }],
        roofs: [],
      },
    },
  },
  {
    name: 'a stair under the level is listed, its flights are not',
    tool: 'get_level_summary',
    scene: houseScene,
    input: { levelId: 'level_ground' },
    expect: { result: { stairs: [{ id: 'stair_main' }], other: [{ id: 'guide_plan' }] } },
  },
  {
    name: 'floor and ceiling items are both listed, each with its parent',
    tool: 'get_level_summary',
    scene: houseScene,
    input: { levelId: 'level_ground' },
    expect: {
      result: {
        items: [
          { id: 'item_lamp', parentId: 'ceiling_ground' },
          { id: 'item_sofa', parentId: 'level_ground' },
        ],
      },
    },
  },
  {
    name: 'anything else on the level is listed by type',
    tool: 'get_level_summary',
    scene: houseScene,
    input: { levelId: 'level_ground' },
    expect: { result: { other: [{ id: 'guide_plan', type: 'guide' }] } },
  },
  {
    name: 'a roof-only level is the roof, with its segments counted',
    tool: 'get_level_summary',
    scene: houseScene,
    input: { level: 'level_roof' },
    expect: {
      result: {
        levelId: 'level_roof',
        role: 'roof',
        isOccupiedStory: false,
        roofs: [{ id: 'roof_main', segmentCount: 1 }],
        other: [],
      },
    },
  },
]

const HOUSE_COPY = {
  level: 1,
  wall: 2,
  door: 1,
  window: 1,
  zone: 1,
  slab: 1,
  ceiling: 1,
  item: 2,
  stair: 1,
  'stair-segment': 1,
  unit: 1,
}
const { item: _items, ...STRUCTURE_COPY } = HOUSE_COPY

export const DUPLICATE_LEVEL_CASES: AgentToolCase[] = [
  {
    name: 'the copy goes above and the floors past it move up, in its building only',
    tool: 'duplicate_level',
    scene: houseScene,
    input: { levelId: 'level_ground' },
    expect: {
      result: {
        floorIndex: 1,
        name: 'Ground',
        shiftedLevelIds: ['level_upper', 'level_roof'],
        copied: HOUSE_COPY,
        skipped: { guide: 1 },
      },
      present: ['level_ground', 'wall_ground', 'guide_plan', 'unit_flat'],
      after: {
        level_ground: { level: 0 },
        level_upper: { level: 2 },
        level_roof: { level: 3 },
        level_shed: { level: -1 },
      },
    },
  },
  {
    name: 'below, the copy takes the original floor and the original moves up',
    tool: 'duplicate_level',
    scene: houseScene,
    input: { levelId: 'level_upper', position: 'below' },
    expect: {
      result: { floorIndex: 1, shiftedLevelIds: ['level_upper', 'level_roof'] },
      after: { level_ground: { level: 0 }, level_upper: { level: 2 }, level_roof: { level: 3 } },
    },
  },
  // The build guide deletes a family's plan-only floors, then copies its first floor up. Each copy pushed every floor above, gap included, and floor 8 went from index 7 to 10.
  {
    name: 'a copy fills a free floor above and moves nothing past the gap',
    tool: 'duplicate_level',
    scene: () => {
      const graph = houseScene()
      const roof = graph.nodes.level_roof as { level: number }
      graph.nodes.level_roof = { ...roof, level: 4 }
      return graph
    },
    input: { levelId: 'level_upper' },
    expect: {
      result: { floorIndex: 2, shiftedLevelIds: [] },
      after: { level_upper: { level: 1 }, level_roof: { level: 4 } },
    },
    // The live stores (chat and MCP) close level gaps when a scene loads; the gap lives inside a
    // batch, as in run 10 (duplicate-level.test.ts runs that sequence).
    surfaces: ['core'],
  },
  {
    name: 'a name names the copy',
    tool: 'duplicate_level',
    scene: houseScene,
    input: { levelId: 'level_upper', name: 'Floor 2' },
    expect: { result: { name: 'Floor 2', floorIndex: 2, shiftedLevelIds: ['level_roof'] } },
  },
  {
    name: 'the structure preset leaves the furniture behind',
    tool: 'duplicate_level',
    scene: houseScene,
    input: { levelId: 'level_ground', preset: 'structure' },
    expect: {
      result: { copied: STRUCTURE_COPY, skipped: { item: 2, guide: 1 } },
    },
  },
  {
    name: 'the viewed floor is the default',
    tool: 'duplicate_level',
    scene: houseScene,
    input: {},
    context: { activeLevelId: 'level_upper' },
    surfaces: ['core', 'chat'],
    expect: { result: { floorIndex: 2, copied: { level: 1, wall: 1 } } },
  },
  {
    name: 'with no level given and none viewed, it asks which',
    tool: 'duplicate_level',
    scene: houseScene,
    input: {},
    expect: { refusal: 'level_required' },
  },
  {
    name: 'an unknown level is refused',
    tool: 'duplicate_level',
    scene: houseScene,
    input: { levelId: 'level_missing' },
    expect: { refusal: 'level_not_found', mentions: ['level_missing'] },
  },
  {
    name: 'a node that is not a level is refused',
    tool: 'duplicate_level',
    scene: houseScene,
    input: { levelId: 'building_house' },
    expect: { refusal: 'not_a_level', mentions: ['building'] },
  },
  {
    name: 'a level outside any building is refused',
    tool: 'duplicate_level',
    scene: orphanLevelScene,
    input: { levelId: 'level_orphan' },
    expect: { refusal: 'no_building' },
  },
]

// The editor's Delete takes a node with everything under it and never asks; the floors above a
// deleted level keep their index.
export const DELETE_NODE_CASES: AgentToolCase[] = [
  {
    name: 'a leaf goes alone',
    tool: 'delete_node',
    scene: houseScene,
    input: { id: 'item_sofa' },
    expect: {
      result: { deletedIds: ['item_sofa'] },
      absent: ['item_sofa'],
      present: ['level_ground', 'item_lamp'],
    },
  },
  // The surfaces add what the scene really lost (classcad-ai's delta check).
  {
    name: 'the result says what the scene lost',
    tool: 'delete_node',
    scene: houseScene,
    input: { id: 'wall_ground' },
    surfaces: ['mcp', 'chat'],
    expect: { result: { achieved: { deleted: { wall: 1, door: 1, window: 1 } } } },
  },
  {
    name: 'a wall goes with its doors and windows',
    tool: 'delete_node',
    scene: houseScene,
    input: { id: 'wall_ground' },
    expect: {
      result: { deletedIds: ['wall_ground', 'door_ground', 'window_ground'] },
      absent: ['wall_ground', 'door_ground', 'window_ground'],
      present: ['wall_side', 'zone_ground'],
    },
  },
  {
    name: 'a level goes with everything on it, and the floors above keep their index',
    tool: 'delete_node',
    scene: houseScene,
    input: { id: 'level_ground' },
    expect: {
      result: {},
      absent: [
        'level_ground',
        'wall_ground',
        'door_ground',
        'item_lamp',
        'stair_main',
        'sseg_main',
      ],
      present: ['building_house', 'level_upper', 'wall_upper'],
      after: { level_upper: { level: 1 }, level_roof: { level: 2 } },
    },
  },
  {
    name: 'an older cascade: false still takes the children, as the editor does',
    tool: 'delete_node',
    scene: houseScene,
    input: { id: 'wall_ground', cascade: false },
    expect: { result: {}, absent: ['wall_ground', 'door_ground', 'window_ground'] },
  },
  {
    name: 'an unknown id is refused',
    tool: 'delete_node',
    scene: houseScene,
    input: { id: 'wall_missing' },
    expect: { refusal: 'node_not_found', mentions: ['wall_missing'] },
  },
]

/** Every table the three runners run. */
export const AGENT_TOOL_CASES: readonly AgentToolCase[] = [
  ...LIST_LEVELS_CASES,
  ...GET_NODE_CASES,
  ...LEVEL_TARGET_CASES,
  ...GET_WALLS_CASES,
  ...GET_ZONES_CASES,
  ...GET_LEVEL_SUMMARY_CASES,
  ...DUPLICATE_LEVEL_CASES,
  ...VERIFY_SCENE_CASES,
  ...DELETE_NODE_CASES,
  ...ROOM_CASES,
  ...CREATE_ROOM_CASES,
  ...FURNISH_ROOM_CASES,
  ...SEARCH_ASSETS_CASES,
  ...ADD_WALL_CASES,
  ...ADD_LEVEL_CASES,
  ...CREATE_STAIR_CASES,
  ...PLACE_ITEMS_CASES,
  ...FIND_BY_TYPE_CASES,
]
