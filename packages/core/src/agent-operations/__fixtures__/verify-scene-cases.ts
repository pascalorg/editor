import {
  type AnyNode,
  BuildingNode,
  CeilingNode,
  DoorNode,
  FloorOpeningNode,
  ItemNode,
  LevelNode,
  RoofNode,
  RoofSegmentNode,
  SlabNode,
  StairNode,
  StairSegmentNode,
  WallNode,
  WindowNode,
  ZoneNode,
} from '../../schema'
import { authoredItem } from './add-object-cases'
import type { AgentToolCase, SceneGraph } from './cases'

/**
 * `verify_scene`: the MCP's checks and the chat's, merged, each issue typed so it can be counted.
 * A case names the issue types a scene must raise (`contains`) or must not (`lacks`).
 */

type Pt = [number, number]
export const ROOM: Pt[] = [
  [0, 0],
  [4, 0],
  [4, 3],
  [0, 3],
]

/** Links parents' children and returns the graph, buildings as roots. */
export function scene(...nodes: AnyNode[]): SceneGraph {
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

export const building = (id = 'building_main') => BuildingNode.parse({ id })
export const level = (id: string, index: number, extra: Record<string, unknown> = {}) =>
  LevelNode.parse({
    id,
    parentId: 'building_main',
    level: index,
    name: `Floor ${index}`,
    height: 2.8,
    ...extra,
  })

/** A finished room on a level: four closed walls, a centred door, its zone, slab and ceiling. */
export function room(levelId: string, tag: string): AnyNode[] {
  const [wall, ...walls] = ROOM.map((start, i) =>
    WallNode.parse({
      id: i === 0 ? `wall_${tag}` : `wall_${tag}_${i}`,
      parentId: levelId,
      start,
      end: ROOM[(i + 1) % ROOM.length],
      height: 2.5,
    }),
  )
  const door = DoorNode.parse({
    id: `door_${tag}`,
    parentId: wall!.id,
    wallId: wall!.id,
    position: [2, 1.05, 0],
  })
  return [
    wall!,
    ...walls,
    door,
    ZoneNode.parse({ id: `zone_${tag}`, parentId: levelId, name: 'Living', polygon: ROOM }),
    SlabNode.parse({ id: `slab_${tag}`, parentId: levelId, polygon: ROOM }),
    CeilingNode.parse({ id: `ceiling_${tag}`, parentId: levelId, polygon: ROOM }),
  ]
}

/** A roof over the 4 × 3 m room, held by `levelId`, its segment bearing `y` above that floor. */
const roofOver = (levelId: string, y: number): AnyNode[] => [
  RoofNode.parse({
    id: 'roof_low',
    parentId: levelId,
    position: [2, y, 1.5],
    children: ['rseg_low'],
  }),
  RoofSegmentNode.parse({ id: 'rseg_low', parentId: 'roof_low', width: 4, depth: 3, wallHeight: 0 }),
]

const STAIR_HOLE: [number, number][] = [
  [1.5, 0.2],
  [2.5, 0.2],
  [2.5, 2.2],
  [1.5, 2.2],
]

export const stairOn = (levelId: string, extra: Record<string, unknown> = {}) => {
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
    { context: { activeLevelId: 'level_0' } },
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
      lacks: ['wall_open_end'],
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
  // A flight to no level names the level it rises from and none it arrives on (create_stair's
  // toLevelId null): porch or deck steps, whatever their rise.
  verify(
    'porch steps to no level connect no storeys',
    () => twoStoreys(...stairOn('level_0', { fromLevelId: 'level_0', totalRise: 0.54 })),
    { contains: ['missing_stair'] },
  ),
  verify(
    'a flight to no level as tall as the storey connects no storeys',
    () => twoStoreys(...stairOn('level_0', { fromLevelId: 'level_0', totalRise: 2.8 })),
    { contains: ['missing_stair'] },
  ),
  verify(
    "an older stair naming no level at its storey's rise connects them",
    () => twoStoreys(...stairOn('level_0', { totalRise: 2.8 })),
    { lacks: ['missing_stair'] },
  ),
  verify(
    'an older stair on the top storey, at its rise, climbs to the roof level and no storey',
    () =>
      twoStoreys(
        level('level_roof', 2, { name: 'Roof', metadata: { role: 'roof' } }),
        RoofNode.parse({ id: 'roof_main', parentId: 'level_roof' }),
        ...stairOn('level_1', { totalRise: 2.8 }),
      ),
    { contains: ['missing_stair'] },
  ),
  verify(
    'an older stair naming no level, twice as tall as its storey, does not',
    () => twoStoreys(...stairOn('level_0', { totalRise: 5.6 })),
    { contains: ['missing_stair'] },
  ),
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
    "a roof level holding a plugin's roof planes has its roof",
    () =>
      scene(
        building(),
        level('level_0', 0),
        level('level_roof', 1, { metadata: { role: 'roof' } }),
        ...room('level_0', 'ground'),
        {
          object: 'node',
          id: 'roofplane_south',
          type: 'procedural:roof-plane',
          parentId: 'level_roof',
          visible: true,
        } as unknown as AnyNode,
      ),
    { lacks: ['roof_level_no_roof'] },
  ),
  verify(
    'a roof level below a storey of its building is reported',
    () =>
      scene(
        building(),
        level('level_0', 0),
        level('level_roof', 1, { metadata: { role: 'roof' } }),
        level('level_2', 2),
        ...room('level_0', 'ground'),
        ...room('level_2', 'upper'),
        ...stairOn('level_0'),
        RoofNode.parse({ id: 'roof_main', parentId: 'level_roof' }),
      ),
    { contains: ['roof_level_not_on_top'], mentions: ['level_2'] },
  ),
  verify(
    'a roof level below an empty storey, a floor still to be built, is reported',
    () =>
      scene(
        building(),
        level('level_0', 0),
        level('level_roof', 1, { metadata: { role: 'roof' } }),
        level('level_2', 2),
        ...room('level_0', 'ground'),
        RoofNode.parse({ id: 'roof_main', parentId: 'level_roof' }),
      ),
    { contains: ['roof_level_not_on_top'], mentions: ['level_2'] },
  ),
  verify(
    'a roof level on top of its storeys is quiet',
    () =>
      scene(
        building(),
        level('level_0', 0),
        level('level_roof', 1, { metadata: { role: 'roof' } }),
        ...room('level_0', 'ground'),
        RoofNode.parse({ id: 'roof_main', parentId: 'level_roof' }),
      ),
    { lacks: ['roof_level_not_on_top'] },
  ),
  verify(
    'a basement the stack stands at grade is reported, with the tool that seats the building',
    () => scene(building(), level('level_b', -1), level('level_0', 0), ...room('level_0', 'ground')),
    { contains: ['basement_at_grade'], mentions: ['set_ground_level'] },
  ),
  verify(
    'a basement standing under the ground is quiet',
    () =>
      scene(
        building(),
        level('level_b', -1, { baseElevation: -2.8 }),
        level('level_0', 0),
        ...room('level_0', 'ground'),
      ),
    { lacks: ['basement_at_grade', 'ground_level_unseated'] },
  ),
  verify(
    'a roof with no segments on a storey stands on no walls, so nothing is reported to move',
    () =>
      scene(
        building(),
        level('level_0', 0),
        ...room('level_0', 'ground'),
        RoofNode.parse({ id: 'roof_low', parentId: 'level_0' }),
      ),
    { lacks: ['roof_mixed_in_storey'] },
  ),
  verify(
    'a roof on the walls of the storey holding it is reported, naming the move',
    () =>
      scene(
        building(),
        level('level_0', 0),
        ...room('level_0', 'ground'),
        ...roofOver('level_0', 2.5),
      ),
    {
      contains: ['roof_mixed_in_storey'],
      mentions: ['dedicated roof level', 'move_roofs_to_roof_level', 'Move to the roof level'],
    },
  ),
  verify(
    "a lower wing's roof at the upper storey's floor, where the Roof tool puts it, is quiet",
    () =>
      twoStoreys(...stairOn('level_0'), RoofNode.parse({ id: 'roof_porch', parentId: 'level_1' })),
    { lacks: ['roof_mixed_in_storey'] },
  ),
  verify(
    "a lower storey's roof on the storey above it, bearing on the lower walls, is quiet",
    () =>
      scene(
        building(),
        level('level_0', 0),
        level('level_1', 1),
        ...room('level_0', 'ground'),
        ...room('level_1', 'upper'),
        ...stairOn('level_0'),
        // the upper storey's floor is 2.8 m up; the ground floor's walls top out at 2.5 m
        ...roofOver('level_1', -0.3),
      ),
    { lacks: ['roof_mixed_in_storey'] },
  ),
  verify(
    'a porch roof on its beam, under the walls’ tops, stays on its storey unreported',
    () =>
      scene(
        building(),
        level('level_0', 0),
        ...room('level_0', 'ground'),
        ...roofOver('level_0', 2.1),
      ),
    { lacks: ['roof_mixed_in_storey'] },
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
    'porch steps off the floor slab are not reported',
    () =>
      scene(
        building(),
        level('level_0', 0),
        ...room('level_0', 'ground'),
        ...stairOn('level_0', { fromLevelId: 'level_0', totalRise: 0.54, position: [2, 0, 4] }),
      ),
    { lacks: ['stair_outside_slab'] },
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
  // Since owned floor openings (#976) a stair's opening is a floor-opening node on the floor
  // above, owned by the stair; the slab hole it cuts carries the opening, not the stair.
  verify(
    "a stair whose owned floor opening sits on the floor above has its opening",
    () =>
      twoStoreys(
        ...stairOn('level_0', {
          fromLevelId: 'level_0',
          toLevelId: 'level_1',
          slabOpeningMode: 'destination',
        }),
        FloorOpeningNode.parse({
          id: 'floor-opening_stair',
          parentId: 'level_1',
          polygon: STAIR_HOLE,
          source: 'stair',
          ownerId: 'stair_level_0',
          surfaceId: 'slab_upper',
          drawnOn: 'floor',
        }),
      ),
    { lacks: ['stair_no_opening'] },
    { surfaces: ['core'] },
  ),
  verify(
    'a stair whose only owned opening is drawn on its own ceiling still misses the floor above',
    () =>
      twoStoreys(
        ...stairOn('level_0', {
          fromLevelId: 'level_0',
          toLevelId: 'level_1',
          slabOpeningMode: 'destination',
        }),
        FloorOpeningNode.parse({
          id: 'floor-opening_ceiling',
          parentId: 'level_0',
          polygon: STAIR_HOLE,
          source: 'stair',
          ownerId: 'stair_level_0',
          drawnOn: 'ceiling',
        }),
      ),
    { contains: ['stair_no_opening'] },
    { surfaces: ['core'] },
  ),
  verify(
    'a stair whose only owned opening is drawn on its own ceiling still misses the floor above',
    () =>
      twoStoreys(
        ...stairOn('level_0', {
          fromLevelId: 'level_0',
          toLevelId: 'level_1',
          slabOpeningMode: 'destination',
        }),
        FloorOpeningNode.parse({
          id: 'floor-opening_ceiling',
          parentId: 'level_0',
          polygon: STAIR_HOLE,
          source: 'stair',
          ownerId: 'stair_level_0',
          drawnOn: 'ceiling',
        }),
      ),
    { contains: ['stair_no_opening'] },
    { surfaces: ['core'] },
  ),
  verify(
    "a stair's floor opening is checked in its own building, not in the house next door",
    () =>
      scene(
        building(),
        level('level_0', 0),
        level('level_1', 1),
        ...room('level_0', 'ground'),
        ...room('level_1', 'upper').filter((node) => node.type !== 'slab'),
        SlabNode.parse({
          id: 'slab_upper',
          parentId: 'level_1',
          polygon: ROOM,
          holes: [
            [
              [1.5, 0.2],
              [2.5, 0.2],
              [2.5, 2.2],
              [1.5, 2.2],
            ],
          ],
          holeMetadata: [{ source: 'stair', stairId: 'stair_level_0' }],
        }),
        ...stairOn('level_0', {
          fromLevelId: 'level_0',
          toLevelId: 'level_1',
          slabOpeningMode: 'destination',
        }),
        building('building_annex'),
        level('level_annex_0', 0, { parentId: 'building_annex' }),
        level('level_annex_1', 1, { parentId: 'building_annex' }),
        ...room('level_annex_0', 'annex_ground'),
        ...room('level_annex_1', 'annex_upper'),
      ),
    { lacks: ['stair_no_opening'] },
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
    'a fridge standing in the middle of a room is reported',
    () =>
      scene(
        building(),
        level('level_0', 0),
        ...room('level_0', 'ground'),
        ItemNode.parse({
          id: 'item_fridge',
          parentId: 'level_0',
          position: [3, 0, 1.6],
          asset: asset('fridge', [0.7, 1.8, 0.72]),
        }),
      ),
    { contains: ['item_mid_room'], mentions: ['item_fridge'] },
  ),
  verify(
    'a fridge against a wall is not reported',
    () =>
      scene(
        building(),
        level('level_0', 0),
        ...room('level_0', 'ground'),
        ItemNode.parse({
          id: 'item_fridge',
          parentId: 'level_0',
          position: [3.6, 0, 1.5],
          asset: asset('fridge', [0.7, 1.8, 0.72]),
        }),
      ),
    { lacks: ['item_mid_room'] },
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
  // Each authored object stands in for something Pascal has no type for: the list names the gaps.
  verify(
    'authored objects are listed with what they stand in for',
    () =>
      scene(
        building(),
        level('level_0', 0),
        ...room('level_0', 'ground'),
        authoredItem('item_lantern', 'level_0', {
          name: 'Porch lantern',
          category: 'light',
          size: [0.2, 0.4, 0.2],
        }),
        authoredItem('item_cornice', 'level_0', {
          name: 'Cornice',
          category: 'trim',
          reason: 'Pascal has no cornice type.',
          size: [4, 0.3, 0.4],
        }),
        ItemNode.parse({
          id: 'item_sofa',
          parentId: 'level_0',
          position: [2, 0, 2],
          asset: asset('sofa', [2, 0.8, 0.9]),
        }),
      ),
    {
      result: {
        authoredObjects: [
          {
            id: 'item_cornice',
            name: 'Cornice',
            category: 'trim',
            reason: 'Pascal has no cornice type.',
          },
          { id: 'item_lantern', name: 'Porch lantern', category: 'light', reason: null },
        ],
      },
    },
  ),
]
