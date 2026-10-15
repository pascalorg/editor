import {
  type AnyNode,
  BlockNode,
  BuildingNode,
  CeilingNode,
  ColumnNode,
  DoorNode,
  ImportedMeshNode,
  ItemNode,
  LevelNode,
  SiteNode,
  SlabNode,
  WallNode,
  WindowNode,
  ZoneNode,
} from '../../schema'
import { authoredItem } from './add-object-cases'
import type { AgentToolCase, SceneGraph } from './cases'

/**
 * One finder and one node read (slice Q of the tool catalogue): `find_by_type` covers every case
 * the MCP's `find_nodes` served and `get_node` every one `describe_node` served, so both retire.
 * Each case names the retiring tool's call and what it answered, then runs the call that covers it
 * on the core, MCP and chat runners. `find_nodes` answered whole nodes, `find_by_type` answers each
 * node's id, name, kind, level and parent with its metadata and provenance, and `get_node` reads one
 * whole: the cases compare which nodes are found.
 */

type Pt = [number, number]

const rect = (x0: number, z0: number, x1: number, z1: number): Pt[] => [
  [x0, z0],
  [x1, z0],
  [x1, z1],
  [x0, z1],
]

/** A site, its building and two storeys, the ground one unnamed, with what each case adds. */
function scene(...nodes: (AnyNode | PluginNode)[]): SceneGraph {
  const site = SiteNode.parse({ id: 'site_lot' })
  const building = BuildingNode.parse({ id: 'building_main', parentId: site.id })
  const ground = LevelNode.parse({ id: 'level_0', parentId: building.id, level: 0, height: 2.8 })
  const upper = LevelNode.parse({
    id: 'level_1',
    parentId: building.id,
    level: 1,
    name: 'Upper',
    height: 2.8,
  })
  const all = [site, building, ground, upper, ...nodes] as (AnyNode & { children?: unknown[] })[]
  const byId = Object.fromEntries(all.map((node) => [node.id, { ...node }]))
  for (const node of Object.values(byId)) {
    const parent = node.parentId ? byId[node.parentId] : undefined
    if (parent && Array.isArray(parent.children) && !parent.children.includes(node.id))
      parent.children = [...parent.children, node.id]
  }
  return { nodes: byId, rootNodeIds: [site.id] }
}

/** A node of a plugin's kind, as a scene holds one where the plugin is installed. */
type PluginNode = { object: 'node'; id: string; type: string; parentId: string } & Record<
  string,
  unknown
>
const pluginNode = (id: string, type: string): PluginNode => ({
  object: 'node',
  id,
  type,
  parentId: 'level_0',
  visible: true,
  metadata: {},
  position: [0, 0, 0],
})

const wall = (id: string, start: Pt, end: Pt, extra: Record<string, unknown> = {}) =>
  WallNode.parse({ id, parentId: 'level_0', start, end, ...extra })

const kitchen = (levelId = 'level_0') =>
  ZoneNode.parse({
    id: 'zone_kitchen',
    parentId: levelId,
    name: 'Kitchen',
    polygon: rect(-5, -5, 5, 5),
  })

/** The ids of the whole nodes found, sorted, against the ones expected. */
const finds =
  (...expected: string[]) =>
  (result: Record<string, unknown>) => {
    const found = (result.results as { id: string; part?: string }[])
      .filter((entry) => !entry.part)
      .map((entry) => entry.id)
      .sort()
    const want = [...expected].sort()
    return JSON.stringify(found) === JSON.stringify(want)
      ? []
      : [`found ${found.join(', ') || 'nothing'}, expected ${want.join(', ') || 'nothing'}`]
  }

const find = (
  name: string,
  build: () => SceneGraph,
  input: Record<string, unknown>,
  expected: string[],
  extra: {
    result?: Record<string, unknown>
    contains?: Record<string, unknown>[]
    surfaces?: AgentToolCase['surfaces']
  } = {},
): AgentToolCase => ({
  name,
  tool: 'find_by_type',
  scene: build,
  input,
  ...(extra.surfaces && { surfaces: extra.surfaces }),
  expect: {
    result: { count: expected.length, ...extra.result },
    ...(extra.contains && { contains: { results: extra.contains } }),
    check: finds(...expected),
  },
})

// ─── Source ids: a slice of the converted /next house, as find_nodes' own tests seeded it ─────────

function sourceScene(): SceneGraph {
  const tagged = wall('wall_ground-exterior-01', [0, 0], [6, 0], {
    metadata: { sourceIds: ['ground/exterior-01'] },
  })
  const window = WindowNode.parse({
    id: 'window_primary-rear-window-1',
    parentId: tagged.id,
    wallId: tagged.id,
    position: [1, 1.2, 0],
    metadata: { sourceIds: ['ground/exterior-01/window-1', 'sketchup:641553'] },
  })
  const block = BlockNode.parse({
    id: 'block_screen-roof-gutter',
    parentId: 'level_0',
    metadata: { sourceIds: ['screen/roof-gutter'] },
  })
  const column = ColumnNode.parse({
    id: 'column_screen-native-640313-1259',
    parentId: 'level_0',
    metadata: { sourceIds: ['screen/post-640313'] },
  })
  // A legacy converter id kept raw, one written as typed provenance requires (printable ASCII,
  // the rest percent-encoded), and typed provenance refs with an alias.
  const legacy = wall('wall_legacy', [0, 2], [1, 2], {
    metadata: { sourceIds: ['Küche/Fenster-1'] },
  })
  const encoded = wall('wall_encoded', [0, 3], [1, 3], {
    metadata: { sourceIds: ['K%C3%BCche/Fenster-2'] },
  })
  const typed = wall('wall_typed', [0, 4], [1, 4], {
    provenance: {
      refs: [
        { ns: 'sketchup', id: 'K%C3%BCche/Fenster-3', role: 'primary' },
        { id: 'kitchen/alias-3', role: 'alias' },
      ],
    },
  })
  const untagged = wall('wall_untagged', [0, 5], [6, 5])
  return scene(tagged, window, block, column, legacy, encoded, typed, untagged)
}

// ─── Zones: what stands in one, by its plan point on the zone's level ──────────────────────────────

function zoneScene(): SceneGraph {
  const near = wall('wall_near', [-2, 0], [2, 0])
  // Wall-local x = 1 on a wall starting at x = 20: the window stands at x = 21, outside.
  const far = wall('wall_far', [20, 0], [26, 0])
  return scene(
    kitchen(),
    wall('wall_in', [-2, -2], [2, 2]),
    wall('wall_out', [50, 50], [60, 60]),
    near,
    far,
    WindowNode.parse({
      id: 'window_near',
      parentId: near.id,
      wallId: near.id,
      position: [1, 1.2, 0],
    }),
    WindowNode.parse({ id: 'window_far', parentId: far.id, wallId: far.id, position: [1, 1.2, 0] }),
    WallNode.parse({ id: 'wall_upper', parentId: 'level_1', start: [-2, 0], end: [2, 0] }),
    ColumnNode.parse({ id: 'column_in', parentId: 'level_0', position: [1, 0, 1] }),
    ColumnNode.parse({ id: 'column_out', parentId: 'level_0', position: [20, 0, 20] }),
    // A block's topology is centred on its origin.
    BlockNode.parse({ id: 'block_in', parentId: 'level_0', position: [2, 0, 2] }),
    // Converter meshes keep their origin at zero and their geometry in the vertices.
    ImportedMeshNode.parse({
      id: 'imesh_in',
      parentId: 'level_0',
      primitives: [{ positions: [2, 0, 2, 4, 0, 2, 4, 0, 4] }],
    }),
    ImportedMeshNode.parse({
      id: 'imesh_far',
      parentId: 'level_0',
      primitives: [{ positions: [30, 0, 30, 32, 0, 30, 32, 0, 32] }],
    }),
    // Geometry around local y = 10: a quarter turn about X swings it to plan z = 10, outside.
    ImportedMeshNode.parse({
      id: 'imesh_tilted',
      parentId: 'level_0',
      rotation: [Math.PI / 2, 0, 0],
      primitives: [{ positions: [-1, 9, -1, 1, 11, -1, 1, 11, 1] }],
    }),
    ImportedMeshNode.parse({
      id: 'imesh_upright',
      parentId: 'level_0',
      primitives: [{ positions: [-1, 9, -1, 1, 11, -1, 1, 11, 1] }],
    }),
  )
}

// ─── Kinds, parents and the driveway Architect's method looks for ──────────────────────────────────

function kindsScene(): SceneGraph {
  const host = wall('wall_host', [0, 0], [4, 0], { height: 2.5 })
  return scene(
    host,
    DoorNode.parse({ id: 'door_host', parentId: host.id, wallId: host.id, position: [1, 1.05, 0] }),
    WindowNode.parse({
      id: 'window_host',
      parentId: host.id,
      wallId: host.id,
      position: [3, 1.5, 0],
    }),
    wall('wall_side', [0, 0], [0, 3]),
    WallNode.parse({ id: 'wall_upper', parentId: 'level_1', start: [0, 0], end: [4, 0] }),
    SlabNode.parse({ id: 'slab_floor', parentId: 'level_0', polygon: rect(0, 0, 4, 3) }),
    SlabNode.parse({
      id: 'slab_drive',
      parentId: 'level_0',
      polygon: rect(4, -6, 7, 0),
      metadata: { flatwork: 'driveway' },
    }),
    BlockNode.parse({ id: 'block_bench', parentId: 'level_0' }),
    pluginNode('bench_plugin-1', 'fixture:bench'),
    pluginNode('studs_plugin-1', 'bones:studs'),
  )
}

const KIND_IDS = [
  'site_lot',
  'building_main',
  'level_0',
  'level_1',
  'wall_host',
  'door_host',
  'window_host',
  'wall_side',
  'wall_upper',
  'slab_floor',
  'slab_drive',
  'block_bench',
  'bench_plugin-1',
  'studs_plugin-1',
]

/** A zone drawn closed (its first corner repeated last), a column inside it and one far off. */
function closedZoneScene(): SceneGraph {
  return scene(
    ZoneNode.parse({
      id: 'zone_closed',
      parentId: 'level_0',
      name: 'Closed',
      polygon: [...rect(-5, -5, 5, 5), [-5, -5]],
    }),
    ColumnNode.parse({ id: 'column_inside', parentId: 'level_0', position: [1, 0, 1] }),
    ColumnNode.parse({ id: 'column_far', parentId: 'level_0', position: [100, 0, 100] }),
  )
}

/** A lamp that emits light, and a fan whose stored interactive part lists no effects. */
function lightsScene(): SceneGraph {
  const item = (id: string, name: string, interactive: Record<string, unknown>) =>
    ItemNode.parse({
      id,
      parentId: 'level_0',
      position: [1, 0, 1],
      asset: {
        id,
        name,
        category: 'furniture',
        thumbnail: '',
        src: `/items/${id}/model.glb`,
        dimensions: [0.5, 0.5, 0.5],
        interactive,
      },
    })
  const lamp = item('item_lamp', 'Lamp', {
    effects: [{ kind: 'light', intensityRange: [0, 2] }],
  })
  const fan = item('item_fan', 'Fan', { controls: [] })
  const asset = fan.asset as { interactive: Record<string, unknown> }
  const { effects: _effects, ...interactive } = asset.interactive
  return scene(lamp, { ...fan, asset: { ...fan.asset, interactive } } as never)
}

/** A plugin's kind in the singular alone. */
function singularKindScene(): SceneGraph {
  return scene(pluginNode('stud_plugin-1', 'bones:stud'))
}

/** A kind and its singular, both a plugin's, and one written with a capital. */
function pluralKindsScene(): SceneGraph {
  return scene(
    pluginNode('studs_plugin-1', 'bones:studs'),
    pluginNode('stud_plugin-1', 'bones:stud'),
    pluginNode('bench_plugin-2', 'fixture:Bench'),
  )
}

/** A wall a level lists that does not name the level back, as a scene assembled whole stores it. */
function unlinkedScene(): SceneGraph {
  const { nodes, rootNodeIds } = kindsScene()
  nodes.wall_side = { ...(nodes.wall_side as object), parentId: null }
  return { nodes, rootNodeIds }
}

/** A block stored without its topology beside a wall in the kitchen. */
function malformedBlockScene(): SceneGraph {
  const { nodes, rootNodeIds } = scene(
    kitchen(),
    wall('wall_in', [-2, -2], [2, 2]),
    BlockNode.parse({ id: 'block_broken', parentId: 'level_0', position: [1, 0, 1] }),
  )
  const { topology: _topology, ...broken } = nodes.block_broken as Record<string, unknown>
  nodes.block_broken = broken
  return { nodes, rootNodeIds }
}

/** An authored lantern with a glass pane, one whose manifest lists no parts, and a wall. */
function authoredScene(): SceneGraph {
  const lantern = authoredItem('item_lantern', 'level_0', {
    name: 'Lantern',
    category: 'lighting',
    size: [0.3, 0.5, 0.3],
  })
  lantern.source!.manifest.parts = [
    { id: 'pane', type: 'glass' },
    { id: 'cage', type: 'frame' },
  ] as never
  const bare = authoredItem('item_bare', 'level_0', {
    name: 'Plinth',
    category: 'decor',
    size: [1, 0.4, 1],
  })
  const { parts: _parts, ...manifest } = bare.source!.manifest as Record<string, unknown>
  return scene(
    lantern,
    { ...bare, source: { ...bare.source!, manifest } } as never,
    wall('wall_a', [0, 0], [4, 0]),
  )
}

/** A wall an IFC import tagged with a large property set, and one with a small mark. */
function recordsScene(): SceneGraph {
  const psets = Object.fromEntries(
    Array.from({ length: 40 }, (_, i) => [`Pset_WallCommon.Prop${i}`, `value ${i} `.repeat(4)]),
  )
  return scene(
    wall('wall_ifc', [0, 0], [4, 0], { metadata: { ifc: psets } }),
    wall('wall_marked', [0, 1], [4, 1], { metadata: { flatwork: 'walk' } }),
  )
}

/** 250 columns on the ground storey: more than find_by_type lists unless asked. */
function crowdedScene(): SceneGraph {
  return scene(
    ...Array.from({ length: 250 }, (_, i) =>
      ColumnNode.parse({
        id: `column_${String(i).padStart(3, '0')}`,
        parentId: 'level_0',
        position: [i, 0, 0],
      }),
    ),
  )
}

/**
 * A porch across the kitchen's edge, its column in the zone, one 20 m off and a beam between, and a
 * column post in the kitchen.
 */
function porchScene(): SceneGraph {
  const porch = authoredItem('item_porch', 'level_0', {
    name: 'Porch',
    category: 'porch',
    size: [21, 3, 1],
  })
  porch.source!.manifest.parts = [
    { id: 'near', type: 'column', bounds: { min: [-0.2, 0, -0.2], max: [0.2, 3, 0.2] } },
    { id: 'far', type: 'column', bounds: { min: [19.8, 0, -0.2], max: [20.2, 3, 0.2] } },
    { id: 'beam', type: 'beam', bounds: { min: [0, 2.8, 0], max: [20, 3, 0.2] } },
  ] as never
  return scene(
    kitchen(),
    porch,
    ColumnNode.parse({ id: 'column_post', parentId: 'level_0', position: [1, 0, 1] }),
  )
}

/**
 * A porch tipped a quarter turn about X, 3 m up: a column whose model middle is 8 m along its z
 * stands half a metre from the kitchen's middle, one 20 m along x stays off.
 */
function pitchedPorchScene(): SceneGraph {
  const porch = authoredItem('item_pitched', 'level_0', {
    name: 'Pitched porch',
    category: 'porch',
    size: [21, 3, 9],
  })
  porch.source!.manifest.parts = [
    { id: 'near', type: 'column', bounds: { min: [-0.2, 0, 7.8], max: [0.2, 1, 8.2] } },
    { id: 'far', type: 'column', bounds: { min: [19.8, 0, -0.2], max: [20.2, 1, 0.2] } },
    { id: 'beam', type: 'beam', bounds: { min: [0, 0, 0], max: [20, 0.2, 0.2] } },
  ] as never
  return scene(kitchen(), { ...porch, position: [0, 3, 0], rotation: [Math.PI / 2, 0, 0] } as never)
}

/** A room zone with a courtyard cut out of it, a wall in the courtyard and one in the room. */
function courtyardScene(): SceneGraph {
  return scene(
    ZoneNode.parse({
      id: 'zone_ring',
      parentId: 'level_0',
      name: 'Cloister',
      polygon: rect(-5, -5, 5, 5),
      holes: [rect(-1, -1, 1, 1)],
    }),
    wall('wall_courtyard', [-0.5, 0], [0.5, 0]),
    wall('wall_cloister', [-4, 3], [-2, 3]),
  )
}

/** A wall whose stored children name a door that is not in the scene. */
function danglingChildScene(): SceneGraph {
  const { nodes, rootNodeIds } = describedScene()
  nodes.wall_tall = { ...(nodes.wall_tall as object), children: ['door_gone'] }
  return { nodes, rootNodeIds }
}

/** How many results are listed, against the count. */
const lists =
  (listed: number) =>
  (result: Record<string, unknown>) =>
    (result.results as unknown[]).length === listed
      ? []
      : [`listed ${(result.results as unknown[]).length}, expected ${listed}`]

export const FIND_NODES_CASES: AgentToolCase[] = [
  find(
    'find_nodes { type: level } (every level, whole): every level, its id, kind and parent',
    kindsScene,
    { type: 'level' },
    ['level_0', 'level_1'],
    {
      contains: [
        { id: 'level_0', nodeType: 'level', levelId: 'level_0', parentId: 'building_main' },
      ],
    },
  ),
  find(
    'find_nodes { type: roof } on a scene with no roof ([]): nothing found',
    kindsScene,
    { type: 'roof' },
    [],
    {
      result: { type: 'roof', count: 0 },
    },
  ),
  find(
    'find_nodes { type: wall, levelId } (the walls of one storey): the same, the upper storey left out',
    kindsScene,
    { type: 'wall', levelId: 'level_0' },
    ['wall_host', 'wall_side'],
  ),
  find(
    "find_nodes { parentId } (a wall's doors and windows): the same",
    kindsScene,
    { parentId: 'wall_host' },
    ['door_host', 'window_host'],
  ),
  find('find_nodes {} (every node): every node', kindsScene, {}, KIND_IDS),
  find(
    'find_nodes { type: block } (a kind the first enum lacked): the block',
    kindsScene,
    { type: 'block' },
    ['block_bench'],
  ),
  find(
    'find_nodes { type: fixture:bench } (a plugin kind in the scene): the plugin node',
    kindsScene,
    { type: 'fixture:bench' },
    ['bench_plugin-1'],
  ),
  find(
    'find_nodes { type: bones:studs } (a plugin kind ending in s): the kind as written, not a singular of it',
    kindsScene,
    { type: 'bones:studs' },
    ['studs_plugin-1'],
  ),
  find(
    "find_nodes { type: slab }, then metadata.flatwork read off each (Architect's driveway check): each slab with its metadata",
    kindsScene,
    { type: 'slab' },
    ['slab_floor', 'slab_drive'],
    { contains: [{ id: 'slab_drive', metadata: { flatwork: 'driveway' } }] },
  ),
  find(
    'find_nodes { type: wall, zoneId } (walls whose midpoint is in the zone): the same',
    zoneScene,
    { type: 'wall', zoneId: 'zone_kitchen' },
    ['wall_in', 'wall_near'],
  ),
  find(
    "find_nodes { type: wall, zoneId } with a wall on the storey above (only the zone's level): the same",
    zoneScene,
    { zoneId: 'zone_kitchen', type: 'wall', levelId: 'level_0' },
    ['wall_in', 'wall_near'],
  ),
  find(
    'find_nodes { type: window, zoneId } (a window where its wall puts it): the near one',
    zoneScene,
    { type: 'window', zoneId: 'zone_kitchen' },
    ['window_near'],
  ),
  find(
    'find_nodes { type: column, zoneId } (a positioned node by its origin): the one inside',
    zoneScene,
    { type: 'column', zoneId: 'zone_kitchen' },
    ['column_in'],
  ),
  find(
    'find_nodes { type: block, zoneId } (a block by the middle of its topology): the block',
    zoneScene,
    { type: 'block', zoneId: 'zone_kitchen' },
    ['block_in'],
  ),
  find(
    'find_nodes { type: imported-mesh, zoneId } (a mesh by its vertex bounds, turned in 3D first): the near and the upright one',
    zoneScene,
    { type: 'imported-mesh', zoneId: 'zone_kitchen' },
    ['imesh_in', 'imesh_upright'],
  ),
  find(
    'find_nodes { zoneId } (everything in the zone): the zone, its walls, window, column, block and meshes',
    zoneScene,
    { zoneId: 'zone_kitchen' },
    [
      'zone_kitchen',
      'wall_in',
      'wall_near',
      'window_near',
      'column_in',
      'block_in',
      'imesh_in',
      'imesh_upright',
    ],
  ),
  {
    name: 'find_nodes { zoneId } of no zone ([]): refused zone_not_found, with the id',
    tool: 'find_by_type',
    scene: zoneScene,
    input: { type: 'wall', zoneId: 'zone_missing' },
    expect: { refusal: 'zone_not_found', mentions: ['zone_missing'] },
  },
  {
    name: 'find_nodes { zoneId } naming a wall ([]): refused not_a_zone',
    tool: 'find_by_type',
    scene: zoneScene,
    input: { zoneId: 'wall_in' },
    expect: { refusal: 'not_a_zone', mentions: ['wall_in'] },
  },
  {
    name: 'find_nodes { parentId } of no node ([]): refused node_not_found, with the id',
    tool: 'find_by_type',
    scene: kindsScene,
    input: { parentId: 'wall_missing' },
    expect: { refusal: 'node_not_found', mentions: ['wall_missing'] },
  },
  find(
    'find_nodes { sourceId } (any entry of metadata.sourceIds, exactly): the window, by either of its ids',
    sourceScene,
    { sourceId: 'sketchup:641553' },
    ['window_primary-rear-window-1'],
    {
      contains: [
        {
          id: 'window_primary-rear-window-1',
          metadata: { sourceIds: ['ground/exterior-01/window-1', 'sketchup:641553'] },
        },
      ],
    },
  ),
  find(
    'find_nodes { sourceId } with the second id: the window',
    sourceScene,
    { sourceId: 'ground/exterior-01/window-1' },
    ['window_primary-rear-window-1'],
  ),
  find(
    'find_nodes { sourceId } of a prefix only ([]): nothing found',
    sourceScene,
    { sourceId: 'ground/exterior' },
    [],
  ),
  find(
    'find_nodes { sourceIdPrefix } (every node with an id starting with it, any kind): the wall and its window',
    sourceScene,
    { sourceIdPrefix: 'ground/exterior-01' },
    ['wall_ground-exterior-01', 'window_primary-rear-window-1'],
  ),
  find(
    'find_nodes { sourceIdPrefix: screen/ }: the block and the column',
    sourceScene,
    { sourceIdPrefix: 'screen/' },
    ['block_screen-roof-gutter', 'column_screen-native-640313-1259'],
  ),
  find(
    'find_nodes { sourceIdPrefix } outside printable ASCII (raw and percent-encoded entries): the legacy, the encoded and the typed walls',
    sourceScene,
    { sourceIdPrefix: 'Küche/' },
    ['wall_legacy', 'wall_encoded', 'wall_typed'],
  ),
  find(
    'find_nodes { sourceId } outside printable ASCII, stored percent-encoded: that wall',
    sourceScene,
    { sourceId: 'Küche/Fenster-2' },
    ['wall_encoded'],
  ),
  find(
    'find_nodes { sourceId } of a typed provenance ref: that wall, with its provenance',
    sourceScene,
    { sourceId: 'Küche/Fenster-3' },
    ['wall_typed'],
    { contains: [{ id: 'wall_typed', provenance: { refs: expectRefs() } }] },
  ),
  find(
    "find_nodes { sourceId } of a typed provenance ref's alias: that wall",
    sourceScene,
    { sourceId: 'kitchen/alias-3' },
    ['wall_typed'],
  ),
  find(
    'find_nodes { sourceIdPrefix, type } (the filters combine): the window alone',
    sourceScene,
    { sourceIdPrefix: 'ground/', type: 'window' },
    ['window_primary-rear-window-1'],
  ),
  find(
    'find_nodes { sourceIdPrefix, parentId }: the window alone',
    sourceScene,
    { sourceIdPrefix: 'ground/', parentId: 'wall_ground-exterior-01' },
    ['window_primary-rear-window-1'],
  ),
  find(
    'find_nodes { sourceIdPrefix: screen/, type: wall } ([]): nothing found',
    sourceScene,
    { sourceIdPrefix: 'screen/', type: 'wall' },
    [],
  ),
  {
    name: 'find_nodes { type: not-a-type } (refused: no such kind): refused unknown_type, with the kinds the scene holds',
    tool: 'find_by_type',
    scene: kindsScene,
    input: { type: 'not-a-type' },
    expect: { refusal: 'unknown_type', mentions: ['not-a-type', 'wall', 'fixture:bench'] },
  },
  {
    name: 'find_nodes { type: windw } (a typo, refused): refused unknown_type',
    tool: 'find_by_type',
    scene: kindsScene,
    input: { type: 'windw', levelId: 'level_0' },
    expect: { refusal: 'unknown_type', mentions: ['windw'] },
  },
  find(
    'find_nodes { type: window } on a storey with none (a real kind, filtered out): nothing found, count 0',
    kindsScene,
    { type: 'window', levelId: 'level_1' },
    [],
    { result: { type: 'window', count: 0 } },
  ),
  find(
    'find_nodes { type: glass } on a level with no lantern (a part type the scene holds elsewhere): nothing found, count 0',
    authoredScene,
    { type: 'glass', levelId: 'level_1' },
    [],
    { result: { type: 'glass', count: 0 } },
  ),
  {
    name: 'find_nodes {} on a scene of 254 nodes (every node, unbounded): count says all, the first 200 listed, truncated with a hint',
    tool: 'find_by_type',
    scene: crowdedScene,
    input: {},
    expect: {
      result: { count: 254, nodes: 254, truncated: true },
      mentions: ['200 of 254 listed', 'limit'],
      check: lists(200),
    },
  },
  {
    name: 'find_nodes { type: column } on a scene of 250 columns (all 250): all of them with limit 250, not truncated',
    tool: 'find_by_type',
    scene: crowdedScene,
    input: { type: 'column', limit: 250 },
    expect: {
      result: { count: 250 },
      check: (result) => [...lists(250)(result), ...(result.truncated ? ['truncated'] : [])],
    },
  },
  {
    name: 'find_by_type { type: column, limit: 3 } (new, no find_nodes case): three listed, the count of all, truncated',
    tool: 'find_by_type',
    scene: crowdedScene,
    input: { type: 'column', limit: 3 },
    expect: { result: { count: 250, truncated: true }, check: lists(3) },
  },
  find(
    "find_by_type { type: column, zoneId } on a porch across the zone's edge (new, find_nodes found no parts): the post and the porch's column in the zone, by the part's own bounds, not the one 20 m off",
    porchScene,
    { type: 'column', zoneId: 'zone_kitchen' },
    ['column_post'],
    {
      result: { count: 2, nodes: 1, parts: 1 },
      contains: [{ id: 'item_porch', part: 'near', partType: 'column' }],
    },
  ),
  find(
    'find_by_type { type: column, zoneId } on a porch tipped about X (new): its column where the tilt puts it, not the one 20 m off',
    pitchedPorchScene,
    { type: 'column', zoneId: 'zone_kitchen' },
    [],
    {
      result: { count: 1, parts: 1 },
      contains: [{ id: 'item_pitched', part: 'near', partType: 'column' }],
    },
  ),
  {
    name: 'find_by_type { type: column, limit: 2 } on the porch and the post (new): two listed, the count of the node and both parts, truncated',
    tool: 'find_by_type',
    scene: porchScene,
    input: { type: 'column', limit: 2 },
    expect: { result: { count: 3, nodes: 1, parts: 2, truncated: true }, check: lists(2) },
  },
  find(
    'find_nodes { type: wall, zoneId } of a zone with a hole (a wall in the courtyard): the wall in the room alone',
    courtyardScene,
    { type: 'wall', zoneId: 'zone_ring' },
    ['wall_cloister'],
  ),
  find(
    'find_nodes { type: column, zoneId } on a zone drawn closed (its first corner repeated): the column inside, not the one far off',
    closedZoneScene,
    { type: 'column', zoneId: 'zone_closed' },
    ['column_inside'],
  ),
  find(
    'find_nodes { type: bones:studs } beside a bones:stud: the studs alone, under their own kind',
    pluralKindsScene,
    { type: 'bones:studs' },
    ['studs_plugin-1'],
    { result: { type: 'bones:studs' } },
  ),
  {
    name: 'find_nodes { type: bones:studs } with only a bones:stud in the scene (refused: no such kind): refused unknown_type, a plugin kind is never read as its singular',
    tool: 'find_by_type',
    scene: singularKindScene,
    input: { type: 'bones:studs' },
    expect: { refusal: 'unknown_type', mentions: ['bones:studs', 'bones:stud'] },
  },
  find(
    "find_nodes { type: glass } (no node kind; a part type ending in s): the lantern's glass pane, under type glass",
    authoredScene,
    { type: 'glass' },
    [],
    {
      result: { type: 'glass', count: 1, parts: 1 },
      contains: [{ id: 'item_lantern', part: 'pane', partType: 'glass' }],
    },
  ),
  find(
    'find_nodes { type: lights } beside an item whose stored interactive part lists no effects: the lamp',
    lightsScene,
    { type: 'lights' },
    ['item_lamp'],
  ),
  find(
    'find_nodes { type: wall } beside an authored item whose manifest lists no parts: the wall',
    authoredScene,
    { type: 'wall' },
    ['wall_a'],
  ),
  find(
    'find_nodes { type: fixture:Bench } (a kind written with a capital): that node, in any case',
    pluralKindsScene,
    { type: 'fixture:bench' },
    ['bench_plugin-2'],
  ),
  // Both stores link a node's parentId from its parent's children when they load a scene; the
  // core operation reads parentId, so this graph is the MCP's and the chat's.
  find(
    "find_nodes { type: wall, levelId } with a wall its level lists but that names no parent (the bridge's ancestry by children): the wall, on the stores' load",
    unlinkedScene,
    { type: 'wall', levelId: 'level_0' },
    ['wall_host', 'wall_side'],
    { surfaces: ['mcp', 'chat'] },
  ),
  find(
    'find_nodes { type: wall, zoneId } beside a block stored without its topology (find_nodes read kinds first): the wall',
    malformedBlockScene,
    { type: 'wall', zoneId: 'zone_kitchen' },
    ['wall_in'],
  ),
  find(
    'find_nodes { zoneId } beside a block stored without its topology: the zone, the wall and the block by its origin',
    malformedBlockScene,
    { zoneId: 'zone_kitchen' },
    ['zone_kitchen', 'wall_in', 'block_broken'],
  ),
  find(
    'find_nodes { type: wall } (whole nodes, metadata and all): a small mark comes with its node, a large property set is named in omitted for get_node',
    recordsScene,
    { type: 'wall' },
    ['wall_ifc', 'wall_marked'],
    {
      contains: [
        { id: 'wall_marked', metadata: { flatwork: 'walk' } },
        { id: 'wall_ifc', omitted: ['metadata'] },
      ],
    },
  ),
]

function expectRefs() {
  return [
    { ns: 'sketchup', id: 'K%C3%BCche/Fenster-3', role: 'primary' },
    { id: 'kitchen/alias-3', role: 'alias' },
  ]
}

// ─── describe_node: its ancestry, children, properties and sentence, from get_node ────────────────

function describedScene(): SceneGraph {
  const host = wall('wall_host', [0, 0], [5, 0])
  const kitchenZone = ZoneNode.parse({
    id: 'zone_kitchen',
    parentId: 'level_0',
    name: 'Kitchen',
    spaceRole: 'room',
    polygon: rect(0, 0, 5, 4),
  })
  return scene(
    host,
    DoorNode.parse({ id: 'door_host', parentId: host.id, wallId: host.id, position: [1, 1.05, 0] }),
    WindowNode.parse({
      id: 'window_host',
      parentId: host.id,
      wallId: host.id,
      position: [3.5, 1.5, 0],
    }),
    wall('wall_tall', [0, 4], [5, 4], { height: 3.1 }),
    kitchenZone,
    SlabNode.parse({
      id: 'slab_plate',
      parentId: 'level_0',
      plateRole: 'base',
      polygon: rect(0, 0, 5, 4),
      zoneIds: [kitchenZone.id],
    }),
    CeilingNode.parse({ id: 'ceiling_auto', parentId: 'level_0', polygon: rect(0, 0, 5, 4) }),
    CeilingNode.parse({
      id: 'ceiling_low',
      parentId: 'level_0',
      polygon: rect(0, 0, 2, 2),
      height: 2.4,
    }),
    ItemNode.parse({
      id: 'item_sofa',
      parentId: 'level_0',
      position: [2, 0, 2],
      asset: {
        id: 'sofa',
        name: 'Sofa',
        category: 'furniture',
        thumbnail: '/items/sofa/thumbnail.webp',
        src: '/items/sofa/model.glb',
        dimensions: [2, 0.8, 0.9],
      },
    }),
    pluginNode('bench_plugin-1', 'fixture:bench'),
  )
}

/** The default tree assembled whole, as `loadScene()` writes it: no `parentId` above the walls. */
function assembledScene(): SceneGraph {
  const { nodes, rootNodeIds } = describedScene()
  for (const id of ['site_lot', 'building_main', 'level_0', 'level_1'])
    nodes[id] = { ...(nodes[id] as object), parentId: null }
  return { nodes, rootNodeIds }
}

/** A wall whose stored children list its window but not its door. */
function unlistedChildScene(): SceneGraph {
  const { nodes, rootNodeIds } = describedScene()
  nodes.wall_host = { ...(nodes.wall_host as object), children: ['window_host'] }
  return { nodes, rootNodeIds }
}

/** A wall stored without its start. */
function brokenWallScene(): SceneGraph {
  const { nodes, rootNodeIds } = describedScene()
  const { start: _start, ...broken } = WallNode.parse({
    id: 'wall_broken',
    parentId: 'level_0',
    start: [0, 0],
    end: [4, 0],
  })
  nodes.wall_broken = broken
  nodes.level_0 = {
    ...(nodes.level_0 as { children: string[] }),
    children: [...(nodes.level_0 as { children: string[] }).children, 'wall_broken'],
  }
  return { nodes, rootNodeIds }
}

/** A door stored without its position, which its schema defaults. */
function bareDoorScene(): SceneGraph {
  const { nodes, rootNodeIds } = describedScene()
  const { position: _position, ...door } = DoorNode.parse({
    id: 'door_bare',
    parentId: 'wall_host',
    wallId: 'wall_host',
  })
  nodes.door_bare = door
  nodes.wall_host = {
    ...(nodes.wall_host as { children: string[] }),
    children: [...(nodes.wall_host as { children: string[] }).children, 'door_bare'],
  }
  return { nodes, rootNodeIds }
}

/** A slab stored without its polygon on the walls' level. */
function brokenSlabScene(): SceneGraph {
  const { nodes, rootNodeIds } = describedScene()
  const { polygon: _polygon, ...slab } = SlabNode.parse({
    id: 'slab_broken',
    parentId: 'level_0',
    polygon: rect(0, 0, 1, 1),
  })
  nodes.slab_broken = slab
  nodes.level_0 = {
    ...(nodes.level_0 as { children: string[] }),
    children: [...(nodes.level_0 as { children: string[] }).children, 'slab_broken'],
  }
  return { nodes, rootNodeIds }
}

const get = (
  name: string,
  id: string,
  result: Record<string, unknown>,
  build: () => SceneGraph = describedScene,
  surfaces?: AgentToolCase['surfaces'],
  mentions?: string[],
): AgentToolCase => ({
  name,
  tool: 'get_node',
  scene: build,
  input: { id },
  ...(surfaces && { surfaces }),
  expect: { result, ...(mentions && { mentions }) },
})

export const DESCRIBE_NODE_CASES: AgentToolCase[] = [
  get(
    'describe_node on a wall (type, parentId, properties): node.type, node.parentId and its fields',
    'wall_host',
    { node: { id: 'wall_host', type: 'wall', parentId: 'level_0', start: [0, 0], end: [5, 0] } },
  ),
  get(
    'describe_node on a wall stored with no thickness ("thickness 0.10m"): node.resolvedThickness',
    'wall_host',
    { node: { resolvedThickness: 0.1 } },
  ),
  get(
    "describe_node on a wall with no height of its own (properties' resolvedHeight 2.75, under the storey's 2.8, heightIsExplicit false): the same on node",
    'wall_host',
    { node: { resolvedHeight: 2.75, heightIsExplicit: false } },
  ),
  get(
    'describe_node on a wall with its own height (resolvedHeight 3.1, heightIsExplicit true): the same',
    'wall_tall',
    { node: { height: 3.1, resolvedHeight: 3.1, heightIsExplicit: true } },
  ),
  get(
    'describe_node ancestryIds (the level and the building above a wall): ancestorIds, parent first, to the site',
    'wall_host',
    { ancestorIds: ['level_0', 'building_main', 'site_lot'] },
  ),
  get(
    'describe_node ancestryIds of a window (its wall, the level, …): ancestorIds from its wall',
    'window_host',
    { ancestorIds: ['wall_host', 'level_0', 'building_main', 'site_lot'] },
  ),
  get(
    "describe_node ancestryIds in a tree assembled whole (no parentId above the walls, the bridge's ancestry by children): the same, on the stores' load",
    'wall_host',
    { ancestorIds: ['level_0', 'building_main', 'site_lot'] },
    assembledScene,
    ['mcp', 'chat'],
  ),
  get(
    "describe_node childrenIds of a wall whose stored children omit its door (the bridge's children by parentId): node.children with the door after the window, on the stores' load",
    'wall_host',
    { node: { children: ['window_host', 'door_host'] } },
    unlistedChildScene,
    ['mcp', 'chat'],
  ),
  get(
    'describe_node on a wall stored without its start (its properties as stored): the node as stored, unresolved says why',
    'wall_broken',
    {
      node: { id: 'wall_broken', type: 'wall', end: [4, 0] },
      ancestorIds: ['level_0', 'building_main', 'site_lot'],
    },
    brokenWallScene,
    undefined,
    ['schema rejects'],
  ),
  get(
    'describe_node on a door stored without its position (its schema fills it): the node as stored, with resolvedOpening',
    'door_bare',
    { node: { id: 'door_bare', type: 'door', resolvedOpening: { anchor: 'floor' } } },
    bareDoorScene,
  ),
  get(
    'describe_node on a wall beside a slab stored without its polygon: the wall as stored, unresolved names what does not read',
    'wall_tall',
    { node: { id: 'wall_tall', height: 3.1 } },
    brokenSlabScene,
    undefined,
    ['does not read'],
  ),
  {
    name: 'describe_node childrenIds of a wall (its door and window): node.children, and no missingChildIds',
    tool: 'get_node',
    scene: describedScene,
    input: { id: 'wall_host' },
    expect: {
      result: { node: { children: ['door_host', 'window_host'] } },
      check: (result) => ('missingChildIds' in result ? ['missingChildIds on a whole wall'] : []),
    },
  },
  get(
    'describe_node on a wall whose stored children name a door not in the scene (childrenIds [], properties.children as stored): node.children as stored, missingChildIds names it',
    'wall_tall',
    { node: { children: ['door_gone'] }, missingChildIds: ['door_gone'] },
    danglingChildScene,
  ),
  get('describe_node on an unnamed ground storey ("Ground floor"): node.displayName', 'level_0', {
    node: { id: 'level_0', displayName: 'Ground floor' },
    ancestorIds: ['building_main', 'site_lot'],
  }),
  get('describe_node on a named storey ("Upper"): node.displayName', 'level_1', {
    node: { name: 'Upper', displayName: 'Upper' },
  }),
  get(
    'describe_node on a floor plate (its footprint name, "Kitchen floor"): node.displayName',
    'slab_plate',
    { node: { plateRole: 'base', displayName: 'Kitchen floor' } },
  ),
  get(
    'describe_node on a ceiling that follows its storey ("height 2.79m", under the 2.8 m storey): node.resolvedHeight, heightIsExplicit false',
    'ceiling_auto',
    { node: { resolvedHeight: 2.79, heightIsExplicit: false } },
  ),
  get(
    'describe_node on a ceiling with its own height (2.4 m): node.resolvedHeight 2.4, heightIsExplicit true',
    'ceiling_low',
    { node: { height: 2.4, resolvedHeight: 2.4, heightIsExplicit: true } },
  ),
  get(
    'describe_node on a door ("Door (0.90m x 2.10m)"): node.width and node.height, with resolvedOpening',
    'door_host',
    { node: { type: 'door', width: 0.9, height: 2.1, resolvedOpening: { anchor: 'floor' } } },
  ),
  get(
    'describe_node on a zone ("Zone "Kitchen" with 4 vertices"): node.name and node.polygon',
    'zone_kitchen',
    { node: { name: 'Kitchen', polygon: rect(0, 0, 5, 4) } },
  ),
  get(
    'describe_node on an item ("Item "Sofa" at (2,0,2)"): node.asset.name and node.position',
    'item_sofa',
    { node: { asset: { name: 'Sofa' }, position: [2, 0, 2] } },
  ),
  get(
    'describe_node on a plugin node ("fixture:bench node", its properties): the node as stored',
    'bench_plugin-1',
    {
      node: { type: 'fixture:bench', position: [0, 0, 0] },
      ancestorIds: ['level_0', 'building_main', 'site_lot'],
    },
  ),
  {
    name: 'describe_node on an unknown id (an error): refused node_not_found, with the id',
    tool: 'get_node',
    scene: describedScene,
    input: { id: 'wall_nope' },
    expect: { refusal: 'node_not_found', mentions: ['wall_nope'] },
  },
]
