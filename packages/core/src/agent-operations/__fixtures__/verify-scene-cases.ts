import {
  type AnyNode,
  BuildingNode,
  CeilingNode,
  DoorNode,
  ItemNode,
  LevelNode,
  RoofNode,
  SlabNode,
  StairNode,
  StairSegmentNode,
  WallNode,
  WindowNode,
  ZoneNode,
} from '../../schema'
import type { AgentToolCase, SceneGraph } from './cases'

/**
 * `verify_scene`: the MCP's checks and the chat's, merged, each issue typed so it can be counted.
 * A case names the issue types a scene must raise (`contains`) or must not (`lacks`).
 */

type Pt = [number, number]
const ROOM: Pt[] = [
  [0, 0],
  [4, 0],
  [4, 3],
  [0, 3],
]

/** Links parents' children and returns the graph, buildings as roots. */
function scene(...nodes: AnyNode[]): SceneGraph {
  const byId = Object.fromEntries(nodes.map((node) => [node.id, { ...node }])) as Record<
    string,
    AnyNode & { children?: string[] }
  >
  for (const node of Object.values(byId)) {
    const parent = node.parentId ? byId[node.parentId] : undefined
    if (parent && Array.isArray(parent.children) && !parent.children.includes(node.id))
      parent.children = [...parent.children, node.id]
  }
  return {
    nodes: byId,
    rootNodeIds: nodes.filter((node) => node.type === 'building').map((node) => node.id),
  }
}

const building = (id = 'building_main') => BuildingNode.parse({ id })
const level = (id: string, index: number, extra: Record<string, unknown> = {}) =>
  LevelNode.parse({
    id,
    parentId: 'building_main',
    level: index,
    name: `Floor ${index}`,
    height: 2.8,
    ...extra,
  })

/** A finished room on a level: a 4 m wall with a centred door, its zone, slab and ceiling. */
function room(levelId: string, tag: string): AnyNode[] {
  const wall = WallNode.parse({
    id: `wall_${tag}`,
    parentId: levelId,
    start: [0, 0],
    end: [4, 0],
    height: 2.5,
  })
  const door = DoorNode.parse({
    id: `door_${tag}`,
    parentId: wall.id,
    wallId: wall.id,
    position: [2, 1.05, 0],
  })
  return [
    wall,
    door,
    ZoneNode.parse({ id: `zone_${tag}`, parentId: levelId, name: 'Room', polygon: ROOM }),
    SlabNode.parse({ id: `slab_${tag}`, parentId: levelId, polygon: ROOM }),
    CeilingNode.parse({ id: `ceiling_${tag}`, parentId: levelId, polygon: ROOM }),
  ]
}

const stairOn = (levelId: string, extra: Record<string, unknown> = {}) => {
  const flight = StairSegmentNode.parse({
    id: `sseg_${levelId}`,
    parentId: `stair_${levelId}`,
    width: 1,
    length: 2,
    height: 2.5,
    stepCount: 10,
  })
  const stair = StairNode.parse({
    id: `stair_${levelId}`,
    parentId: levelId,
    name: 'Main Stair',
    position: [2, 0, 0.5],
    ...extra,
  })
  return [stair, flight]
}

const asset = (id: string, dimensions: [number, number, number]) => ({
  id,
  name: id,
  category: 'furniture',
  thumbnail: `/items/${id}/thumbnail.webp`,
  src: `/items/${id}/model.glb`,
  dimensions,
})

const oneStorey = () => scene(building(), level('level_0', 0), ...room('level_0', 'ground'))
const twoStoreys = (...extra: AnyNode[]) =>
  scene(
    building(),
    level('level_0', 0),
    level('level_1', 1),
    ...room('level_0', 'ground'),
    ...room('level_1', 'upper'),
    ...extra,
  )

const verify = (
  name: string,
  build: () => SceneGraph,
  expectation: {
    result?: Record<string, unknown>
    contains?: string[]
    lacks?: string[]
    mentions?: string[]
  },
  extra: Partial<AgentToolCase> = {},
): AgentToolCase => ({
  name,
  tool: 'verify_scene',
  scene: build,
  input: {},
  ...extra,
  expect: {
    result: expectation.result ?? {},
    ...(expectation.contains && {
      contains: { issues: expectation.contains.map((type) => ({ type })) },
    }),
    ...(expectation.lacks && { lacks: { issues: expectation.lacks.map((type) => ({ type })) } }),
    ...(expectation.mentions && { mentions: expectation.mentions }),
  },
})

export const VERIFY_SCENE_CASES: AgentToolCase[] = [
  verify('a finished storey has no issues', oneStorey, {
    result: {
      ok: true,
      valid: true,
      levelCount: 1,
      occupiedStoryCount: 1,
      emptyLevelIds: [],
      issues: [],
      hasIssues: false,
    },
  }),
  verify(
    'the viewed floor is marked',
    oneStorey,
    { result: { activeLevelId: 'level_0', levels: [{ levelId: 'level_0', isActive: true }] } },
    { context: { activeLevelId: 'level_0' }, surfaces: ['core', 'chat'] },
  ),
  verify(
    'walls with no room and no door are reported',
    () =>
      scene(
        building(),
        level('level_0', 0),
        WallNode.parse({ id: 'wall_bare', parentId: 'level_0', start: [0, 0], end: [4, 0] }),
      ),
    {
      contains: ['walls_no_zones', 'walls_no_doors'],
      mentions: ['walls but no zones'],
    },
  ),
  verify(
    'a room with no floor or ceiling is reported',
    () =>
      scene(
        building(),
        level('level_0', 0),
        ZoneNode.parse({ id: 'zone_bare', parentId: 'level_0', name: 'Room', polygon: ROOM }),
      ),
    { contains: ['zones_no_slabs', 'zones_no_ceilings'] },
  ),
  verify(
    'an empty storey is reported by name and id',
    () =>
      scene(
        building(),
        level('level_0', 0),
        level('level_1', 1),
        ...room('level_0', 'ground'),
        ...stairOn('level_0'),
      ),
    {
      result: { emptyLevelIds: ['level_1'] },
      contains: ['empty_levels'],
      mentions: ['level_1'],
    },
  ),
  verify('two storeys with no stair are reported', () => twoStoreys(), {
    contains: ['missing_stair'],
  }),
  verify('a stair on a storey connects them', () => twoStoreys(...stairOn('level_0')), {
    lacks: ['missing_stair'],
  }),
  verify(
    'a roof-only level is neither a storey nor empty: one storey needs no stair',
    () =>
      scene(
        building(),
        level('level_0', 0),
        level('level_roof', 1, { name: 'Roof' }),
        ...room('level_0', 'ground'),
        RoofNode.parse({ id: 'roof_main', parentId: 'level_roof' }),
      ),
    {
      result: { occupiedStoryCount: 1, roofLevelIds: ['level_roof'], hasIssues: false },
      lacks: ['missing_stair', 'empty_levels'],
    },
  ),
  verify(
    'two single-storey buildings need no stair',
    () =>
      scene(
        building(),
        level('level_0', 0),
        ...room('level_0', 'ground'),
        building('building_annex'),
        level('level_annex', 0, { parentId: 'building_annex' }),
        ...room('level_annex', 'annex'),
      ),
    { lacks: ['missing_stair'] },
  ),
  verify(
    'a roof level with storey content is reported',
    () =>
      scene(
        building(),
        level('level_0', 0),
        level('level_roof', 1, { metadata: { role: 'roof' } }),
        ...room('level_0', 'ground'),
        RoofNode.parse({ id: 'roof_main', parentId: 'level_roof' }),
        WallNode.parse({ id: 'wall_attic', parentId: 'level_roof', start: [0, 0], end: [4, 0] }),
      ),
    { contains: ['roof_level_occupied'] },
  ),
  verify(
    'a declared roof level with no roof is reported',
    () =>
      scene(
        building(),
        level('level_0', 0),
        level('level_roof', 1, { metadata: { role: 'roof' } }),
        ...room('level_0', 'ground'),
      ),
    { contains: ['roof_level_no_roof'] },
  ),
  verify(
    'a roof on a storey is reported',
    () =>
      scene(
        building(),
        level('level_0', 0),
        ...room('level_0', 'ground'),
        RoofNode.parse({ id: 'roof_low', parentId: 'level_0' }),
      ),
    {
      contains: ['roof_mixed_in_storey'],
      mentions: ['dedicated roof level'],
    },
  ),
  verify(
    'a wall taller than its storey in a multi-storey building is reported',
    () =>
      twoStoreys(
        ...stairOn('level_0'),
        WallNode.parse({
          id: 'wall_tall',
          parentId: 'level_0',
          start: [0, 3],
          end: [4, 3],
          height: 5.6,
        }),
      ),
    {
      contains: ['wall_spans_storeys'],
      mentions: ['multi-story exterior walls should be split'],
    },
  ),
  verify(
    'a tall wall on a one-storey annex beside a two-storey house spans no storeys',
    () =>
      scene(
        building(),
        level('level_0', 0),
        level('level_1', 1),
        ...room('level_0', 'ground'),
        ...room('level_1', 'upper'),
        ...stairOn('level_0'),
        building('building_annex'),
        level('level_annex', 0, { parentId: 'building_annex' }),
        ...room('level_annex', 'annex'),
        WallNode.parse({
          id: 'wall_annex_tall',
          parentId: 'level_annex',
          start: [0, 3],
          end: [4, 3],
          height: 5.6,
        }),
      ),
    { lacks: ['wall_spans_storeys'] },
  ),
  verify(
    'an opening on the wrong wall, past its end and above its top is reported',
    () =>
      scene(
        building(),
        level('level_0', 0),
        ...room('level_0', 'ground'),
        WallNode.parse({ id: 'wall_other', parentId: 'level_0', start: [0, 2], end: [4, 2] }),
        WindowNode.parse({
          id: 'window_astray',
          parentId: 'wall_ground',
          wallId: 'wall_other',
          position: [4.8, 2.4, 0],
          width: 1,
          height: 1,
        }),
      ),
    {
      contains: ['opening_wall_mismatch', 'opening_outside_wall', 'opening_outside_height'],
      mentions: [
        'window window_astray has wallId wall_other',
        'window window_astray extends outside wall wall_ground',
      ],
    },
  ),
  verify(
    'a stair reaching past its floor slab is reported',
    () =>
      scene(
        building(),
        level('level_0', 0),
        ...room('level_0', 'ground'),
        ...stairOn('level_0', { position: [3.6, 0, 1], rotation: Math.PI / 2 }),
      ),
    {
      contains: ['stair_outside_slab'],
      mentions: ['Stair Main Stair footprint extends outside source floor slab'],
    },
  ),
  verify(
    'a wall across a stair is reported',
    () =>
      twoStoreys(
        ...stairOn('level_0'),
        WallNode.parse({
          id: 'wall_blocker',
          parentId: 'level_0',
          name: 'Stair Blocker',
          start: [0, 2],
          end: [4, 2],
        }),
      ),
    { contains: ['stair_obstructed'], mentions: ['obstructs stair Main Stair'] },
  ),
  verify(
    'a stair missing its opening in the floor above is reported',
    () =>
      twoStoreys(
        ...stairOn('level_0', {
          fromLevelId: 'level_0',
          toLevelId: 'level_1',
          slabOpeningMode: 'destination',
        }),
      ),
    { contains: ['stair_no_opening'], mentions: ['no destination slab opening'] },
    // Only core: a live store cuts the opening itself when the scene loads, as the editor does.
    { surfaces: ['core'] },
  ),
  verify(
    'furniture in front of a door is reported',
    () =>
      scene(
        building(),
        level('level_0', 0),
        ...room('level_0', 'ground'),
        ItemNode.parse({
          id: 'item_toilet',
          parentId: 'level_0',
          position: [2, 0, 0.5],
          asset: asset('toilet', [1, 0.9, 1]),
        }),
      ),
    { contains: ['door_blocked'], mentions: ['door_ground'] },
  ),
  verify(
    'overlapping furniture is reported',
    () =>
      scene(
        building(),
        level('level_0', 0),
        ...room('level_0', 'ground'),
        ItemNode.parse({
          id: 'item_closet_a',
          parentId: 'level_0',
          position: [1, 0, 2],
          asset: asset('closet', [2, 2.5, 1]),
        }),
        ItemNode.parse({
          id: 'item_closet_b',
          parentId: 'level_0',
          position: [1.3, 0, 2.1],
          asset: asset('closet', [2, 2.5, 1]),
        }),
      ),
    { contains: ['item_overlap'] },
  ),
  verify(
    'a node its schema rejects fails validation',
    () =>
      scene(building(), level('level_0', 0), ...room('level_0', 'ground'), {
        ...WallNode.parse({ id: 'wall_broken', parentId: 'level_0', start: [0, 3], end: [4, 3] }),
        thickness: 'thick',
      } as unknown as AnyNode),
    { result: { valid: false }, contains: ['schema_invalid'] },
    // Only core: a live store and a bridge would not hold a node that fails its schema.
    { surfaces: ['core'] },
  ),
]
