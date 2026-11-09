import {
  type AnyNode,
  BlockNode,
  BuildingNode,
  CabinetNode,
  CeilingNode,
  DoorNode,
  ItemNode,
  LevelNode,
  RoofNode,
  RoofSegmentNode,
  SiteNode,
  SlabNode,
  StairNode,
  StairSegmentNode,
  WallNode,
  WindowNode,
} from '../../schema'
import { MATERIAL_CATALOG } from '../../material-library'
import type { AgentToolCase, SceneGraph } from './cases'

/**
 * Slice F of the tool catalogue (`wiki/ai/tool-catalogue.md`): one finish tool. Architect's
 * `set_material` and `list_materials` retire into `paint` and `search_materials`, so each case
 * below is a call the retiring tool served (its contract, its guides, the calls stored threads and
 * Pro bench runs made), run as the replacement call that now serves it. A case's name says what
 * the retiring tool was asked, then how the replacement answers.
 */

const SIDING = 'library:siding-lap-white'
const SOFT_WHITE = 'library:preset-softwhite'
/** The library `finishScene`'s vase is from: paint reads its surfaces by the catalog's entry. */
const VASE_LIBRARY = [
  {
    id: 'vase',
    name: 'Vase',
    category: 'decor',
    tags: [],
    thumbnail: '/items/vase/thumbnail.webp',
    src: '/items/vase/model.glb',
    dimensions: [0.3, 0.5, 0.3] as [number, number, number],
  },
]
const SHINGLES = 'library:roof-greyshingles'
const CLAY_TILES = 'library:roof-claytiles'

/**
 * A 6 × 4 m house of two rooms (a partition at x = 3) under a roof of three segments: one plain,
 * one with a covering of its own, one with a catch-all finish from an older paint. Its walls run
 * counter-clockwise, so each outside wall's face a is in, b out. Beside it, a terrace, a garden wall
 * no room touches, whose stored sides say its front faces out (as a generator writes them), a
 * retaining wall whose sides nothing stored, and the parts set_material reached beyond walls and
 * roofs.
 */
function finishScene(): SceneGraph {
  const level = 'level_finish'
  const wall = (id: string, start: [number, number], end: [number, number], extra = {}) =>
    WallNode.parse({ id, parentId: level, start, end, ...extra })
  const door = DoorNode.parse({
    id: 'door_finish',
    parentId: 'wall_s',
    wallId: 'wall_s',
    position: [1, 1.05, 0],
  })
  const window = WindowNode.parse({
    id: 'window_finish',
    parentId: 'wall_n',
    wallId: 'wall_n',
    position: [4.5, 1.5, 0],
  })
  const walls = [
    wall('wall_s', [0, 0], [6, 0], { children: [door.id] }),
    wall('wall_e', [6, 0], [6, 4]),
    wall('wall_n', [6, 4], [0, 4], { children: [window.id] }),
    wall('wall_w', [0, 4], [0, 0]),
    wall('wall_mid', [3, 0], [3, 4]),
    wall('wall_garden', [8, 0], [12, 0], { frontSide: 'exterior', backSide: 'interior' }),
    // A retaining wall as add_wall leaves it: no room, sides unknown.
    wall('wall_free', [8, 3], [12, 3]),
  ]
  const footprint: [number, number][] = [
    [0, 0],
    [6, 0],
    [6, 4],
    [0, 4],
  ]
  // A terrace beside the house: a slab of its own, not the floor plate its rooms derive.
  const slab = SlabNode.parse({
    id: 'slab_finish',
    parentId: level,
    polygon: [
      [0, 5],
      [6, 5],
      [6, 7],
      [0, 7],
    ],
  })
  const ceiling = CeilingNode.parse({ id: 'ceiling_finish', parentId: level, polygon: footprint })
  const segments = [
    RoofSegmentNode.parse({
      id: 'rseg_plain',
      parentId: 'roof_finish',
      fasciaMaterialPreset: 'library:preset-nearblack',
    }),
    RoofSegmentNode.parse({ id: 'rseg_own', parentId: 'roof_finish', topMaterialPreset: CLAY_TILES }),
    RoofSegmentNode.parse({ id: 'rseg_legacy', parentId: 'roof_finish', materialPreset: CLAY_TILES }),
  ]
  const roof = RoofNode.parse({
    id: 'roof_finish',
    parentId: level,
    children: segments.map((segment) => segment.id),
  })
  const block = BlockNode.parse({ id: 'block_pier', parentId: level, position: [7, 0, 2] })
  const flight = StairSegmentNode.parse({ id: 'sseg_finish', parentId: 'stair_finish' })
  const stair = StairNode.parse({
    id: 'stair_finish',
    parentId: level,
    position: [1, 0, 2],
    children: [flight.id],
  })
  const cabinet = CabinetNode.parse({ id: 'cabinet_finish', parentId: level, position: [4, 0, 1] })
  const item = ItemNode.parse({
    id: 'item_vase',
    parentId: level,
    position: [5, 0, 3],
    asset: {
      id: 'vase',
      name: 'Vase',
      category: 'decor',
      thumbnail: '/items/vase/thumbnail.webp',
      src: '/items/vase/model.glb',
      dimensions: [0.3, 0.5, 0.3],
    },
    slots: { glaze: 'library:preset-navy' },
  })
  const parts = [door, window, slab, ceiling, roof, ...segments, block, stair, flight, cabinet, item]
  const nodes: AnyNode[] = [
    SiteNode.parse({ id: 'site_finish', children: ['building_finish'] }),
    BuildingNode.parse({ id: 'building_finish', parentId: 'site_finish', children: [level] }),
    LevelNode.parse({
      id: level,
      parentId: 'building_finish',
      level: 0,
      children: [
        ...walls.map((node) => node.id),
        ...[slab, ceiling, roof, block, stair, cabinet, item].map((node) => node.id),
      ],
    }),
    ...walls,
    ...parts,
  ]
  return {
    nodes: Object.fromEntries(nodes.map((node) => [node.id, node])),
    rootNodeIds: ['site_finish'],
  }
}

/**
 * A 10 m wall with a room the whole length of its north face (face a) and a room along only the
 * first 6 m of its south face (face b): past that, its south face is the garden's.
 */
function junctionScene(): SceneGraph {
  const level = 'level_junction'
  const wall = (id: string, start: [number, number], end: [number, number]) =>
    WallNode.parse({ id, parentId: level, start, end })
  const walls = [
    wall('wall_long', [0, 0], [10, 0]),
    wall('wall_ne', [10, 0], [10, 4]),
    wall('wall_nn', [10, 4], [0, 4]),
    wall('wall_nw', [0, 4], [0, 0]),
    wall('wall_sw', [0, 0], [0, -3]),
    wall('wall_ss', [0, -3], [6, -3]),
    wall('wall_se', [6, -3], [6, 0]),
  ]
  const nodes: AnyNode[] = [
    SiteNode.parse({ id: 'site_junction', children: ['building_junction'] }),
    BuildingNode.parse({ id: 'building_junction', parentId: 'site_junction', children: [level] }),
    LevelNode.parse({
      id: level,
      parentId: 'building_junction',
      level: 0,
      children: walls.map((node) => node.id),
    }),
    ...walls,
  ]
  return {
    nodes: Object.fromEntries(nodes.map((node) => [node.id, node])),
    rootNodeIds: ['site_junction'],
  }
}

type Nodes = Readonly<Record<string, AnyNode>>
const fields = (nodes: Nodes, id: string) => nodes[id] as unknown as Record<string, unknown>

/** The problems with a node's fields that a case wants gone. */
const gone =
  (id: string, ...keys: string[]) =>
  (_result: Record<string, unknown>, nodes: Nodes) =>
    keys.filter((key) => fields(nodes, id)[key] !== undefined).map((key) => `${id}.${key} is set`)

/** The wall's slot on a face, as the face shows it. */
const face = (nodes: Nodes, id: string, side: 'a' | 'b') =>
  (fields(nodes, id).slots as Record<string, string> | undefined)?.[side]

/** What set_material served on walls and roofs, and the other parts its "surface" slot reached. */
export const SET_MATERIAL_CASES: AgentToolCase[] = [
  {
    name: "set_material slot 'exterior' on a run of walls (a stored Pro call): paint role exterior, the face turned out of the rooms",
    tool: 'paint',
    scene: finishScene,
    input: { targets: ['wall_s', 'wall_e'], role: 'exterior', material: SIDING },
    expect: {
      result: {
        ok: true,
        painted: [
          { id: 'wall_s', roles: ['b'] },
          { id: 'wall_e', roles: ['b'] },
        ],
      },
      after: { wall_s: { slots: { b: SIDING } }, wall_e: { slots: { b: SIDING } } },
      check: (_result, nodes) =>
        ['wall_s', 'wall_e']
          .filter((id) => face(nodes, id, 'a') !== undefined)
          .map((id) => `${id}'s inside face was painted`),
    },
  },
  {
    name: "set_material slot 'interior' with a flat colour (a stored Pro call): paint role interior",
    tool: 'paint',
    scene: finishScene,
    input: { targets: ['wall_n', 'wall_w'], role: 'interior', material: SOFT_WHITE },
    expect: {
      result: {
        painted: [
          { id: 'wall_n', roles: ['a'] },
          { id: 'wall_w', roles: ['a'] },
        ],
      },
      after: { wall_n: { slots: { a: SOFT_WHITE } }, wall_w: { slots: { a: SOFT_WHITE } } },
    },
  },
  {
    name: "set_material 'interior' on a partition painted one face; paint paints both, a room on each",
    tool: 'paint',
    scene: finishScene,
    input: { targets: ['wall_mid'], role: 'interior', material: SOFT_WHITE },
    expect: {
      result: { painted: [{ id: 'wall_mid', roles: ['a', 'b'] }] },
      after: { wall_mid: { slots: { a: SOFT_WHITE, b: SOFT_WHITE } } },
    },
  },
  {
    name: "set_material 'exterior' on a partition painted a face inside the house; paint refuses: it has none",
    tool: 'paint',
    scene: finishScene,
    input: { targets: ['wall_mid'], role: 'exterior', material: SIDING },
    expect: { refusal: 'side_unknown', mentions: ['wall_mid', 'a or b'] },
  },
  {
    name: "set_material 'exterior' on a wall no room touches: paint reads its stored sides, as set_material did",
    tool: 'paint',
    scene: finishScene,
    input: { targets: ['wall_garden'], role: 'exterior', material: SIDING },
    expect: {
      result: { painted: [{ id: 'wall_garden', roles: ['a'] }] },
      after: { wall_garden: { slots: { a: SIDING } } },
    },
  },
  {
    name: "set_material 'exterior' on a wall no room touches and no side stored painted face b (its guess); paint asks for the face",
    tool: 'paint',
    scene: finishScene,
    input: { targets: ['wall_free'], role: 'exterior', material: SIDING },
    expect: { refusal: 'side_unknown', mentions: ['wall_free', 'a or b'] },
  },
  {
    name: "set_material 'interior' on a wall with rooms along all of one face and part of the other painted its stored side; paint asks for the face, as the part face is the garden's past its room",
    tool: 'paint',
    scene: junctionScene,
    input: { targets: ['wall_long'], role: 'interior', material: SOFT_WHITE },
    expect: { refusal: 'side_unknown', mentions: ['wall_long', 'face b', 'a or b'] },
  },
  {
    name: "set_material 'exterior' on that wall painted its stored side; paint asks for the face",
    tool: 'paint',
    scene: junctionScene,
    input: { targets: ['wall_long'], role: 'exterior', material: SIDING },
    expect: { refusal: 'side_unknown', mentions: ['wall_long', 'face b', 'a or b'] },
  },
  {
    name: 'set_material with no slot on a wall painted both faces: paint with no role does too',
    tool: 'paint',
    scene: finishScene,
    input: { targets: ['wall_e'], material: SOFT_WHITE },
    expect: {
      result: { painted: [{ id: 'wall_e', roles: ['a', 'b'] }] },
      after: { wall_e: { slots: { a: SOFT_WHITE, b: SOFT_WHITE } } },
    },
  },
  {
    name: "set_material took faces 'a' and 'b': so does paint",
    tool: 'paint',
    scene: finishScene,
    input: { targets: ['wall_w'], role: 'b', material: SIDING },
    expect: {
      result: { painted: [{ id: 'wall_w', roles: ['b'] }] },
      after: { wall_w: { slots: { b: SIDING } } },
    },
  },
  {
    name: "set_material took a bare library id ('siding-lap-white'): paint takes it, and writes library:<id>",
    tool: 'paint',
    scene: finishScene,
    input: { targets: ['wall_s'], role: 'exterior', material: 'siding-lap-white' },
    expect: { result: { finish: SIDING }, after: { wall_s: { slots: { b: SIDING } } } },
  },
  {
    name: "set_material on a roof, slot 'top' (its default): paint's default role on a roof is top",
    tool: 'paint',
    scene: finishScene,
    input: { targets: ['roof_finish'], material: SHINGLES },
    expect: {
      result: { painted: [{ id: 'roof_finish', roles: ['top'] }] },
      after: { roof_finish: { topMaterialPreset: SHINGLES } },
    },
  },
  {
    name: "set_material on a roof whose segment has its own covering: the roof's shows, the segment's goes",
    tool: 'paint',
    scene: finishScene,
    input: { targets: ['roof_finish'], role: 'top', material: SHINGLES },
    expect: {
      result: { painted: [{ id: 'roof_finish', roles: ['top'] }] },
      after: { roof_finish: { topMaterialPreset: SHINGLES } },
      check: gone('rseg_own', 'topMaterialPreset', 'topMaterial'),
    },
  },
  {
    name: "a segment's catch-all finish (an older paint) stays on its other surfaces when the roof's top is painted",
    tool: 'paint',
    scene: finishScene,
    input: { targets: ['roof_finish'], role: 'top', material: SHINGLES },
    expect: {
      result: { painted: [{ id: 'roof_finish', roles: ['top'] }] },
      after: { rseg_legacy: { edgeMaterialPreset: CLAY_TILES, wallMaterialPreset: CLAY_TILES } },
      check: gone('rseg_legacy', 'materialPreset', 'topMaterialPreset'),
    },
  },
  {
    name: 'set_material on a roof segment painted its roof: so does paint, and says so',
    tool: 'paint',
    scene: finishScene,
    input: { targets: ['rseg_plain'], material: SHINGLES },
    expect: {
      result: { painted: [{ id: 'roof_finish', roles: ['top'] }] },
      after: { roof_finish: { topMaterialPreset: SHINGLES } },
      mentions: ['rseg_plain is a roof segment'],
      check: (result, nodes) => [
        ...gone('rseg_plain', 'topMaterialPreset')(result, nodes),
        ...gone('rseg_own', 'topMaterialPreset')(result, nodes),
      ],
    },
  },
  {
    name: "set_material slot 'gable' (also 'edge', 'trim'): paint role edge, the gable ends and trim band",
    tool: 'paint',
    scene: finishScene,
    input: { targets: ['roof_finish'], role: 'edge', material: 'library:preset-nearblack' },
    expect: {
      result: { painted: [{ id: 'roof_finish', roles: ['edge'] }] },
      after: { roof_finish: { edgeMaterialPreset: 'library:preset-nearblack' } },
    },
  },
  {
    name: "set_material slot 'soffit' (also 'fascia', 'deck', 'wall'): paint role wall, the fascia and soffit",
    tool: 'paint',
    scene: finishScene,
    input: { targets: ['rseg_own'], role: 'wall', material: 'library:siding-lap-cedar' },
    expect: {
      result: { painted: [{ id: 'roof_finish', roles: ['wall'] }] },
      after: { roof_finish: { wallMaterialPreset: 'library:siding-lap-cedar' } },
    },
  },
  {
    name: "a fascia band with a finish of its own keeps it under role wall; role fascia paints the boards on every segment",
    tool: 'paint',
    scene: finishScene,
    input: { targets: ['rseg_own'], role: 'fascia', material: SOFT_WHITE },
    expect: {
      result: { painted: [{ id: 'roof_finish', roles: ['fascia'] }] },
      after: {
        rseg_plain: { fasciaMaterialPreset: SOFT_WHITE },
        rseg_own: { fasciaMaterialPreset: SOFT_WHITE },
        rseg_legacy: { fasciaMaterialPreset: SOFT_WHITE },
      },
      check: gone('roof_finish', 'fasciaMaterialPreset'),
    },
  },
  {
    name: 'a native material on the fascia boards is kept as a scene material each segment shows',
    tool: 'paint',
    scene: finishScene,
    input: {
      targets: ['roof_finish'],
      role: 'fascia',
      material: { preset: 'custom', properties: { color: '#1f2a36', roughness: 0.6, metalness: 0 } },
      materialName: 'Fascia, slate blue',
    },
    expect: {
      result: {
        painted: [{ id: 'roof_finish', roles: ['fascia'] }],
        createdMaterial: { name: 'Fascia, slate blue' },
      },
      check: (result, nodes) =>
        ['rseg_plain', 'rseg_own', 'rseg_legacy']
          .filter(
            (id) => fields(nodes, id).fasciaMaterialPreset !== `scene:${String(result.materialId)}`,
          )
          .map((id) => `${id}'s boards do not show the material`),
    },
  },
  {
    name: "roof_soffit's fascia on a segment with a catch-all finish (Architect's own writer, settleRoofPaint gone): role wall shows on it",
    tool: 'paint',
    scene: finishScene,
    input: { targets: ['roof_finish'], role: 'wall', material: 'library:preset-nearblack' },
    expect: {
      result: { painted: [{ id: 'roof_finish', roles: ['wall'] }] },
      after: {
        roof_finish: { wallMaterialPreset: 'library:preset-nearblack' },
        rseg_legacy: { topMaterialPreset: CLAY_TILES, edgeMaterialPreset: CLAY_TILES },
      },
      check: gone('rseg_legacy', 'materialPreset', 'wallMaterialPreset'),
    },
  },
  {
    name: "set_material's standing seam (ROOFING metal_black, a metal colour): paint a native metal material",
    tool: 'paint',
    scene: finishScene,
    input: {
      targets: ['roof_finish'],
      material: {
        preset: 'metal',
        properties: { color: '#2b2e32', roughness: 0.55, metalness: 0.45 },
      },
      materialName: 'Standing seam, matte black',
    },
    expect: {
      result: {
        painted: [{ id: 'roof_finish', roles: ['top'] }],
        createdMaterial: { name: 'Standing seam, matte black' },
      },
      check: (result, nodes) =>
        fields(nodes, 'roof_finish').topMaterialPreset === `scene:${String(result.materialId)}`
          ? []
          : ['the roof does not show the standing seam'],
    },
  },
  {
    name: "set_material on a slab, a terrace (its 'surface' default): paint's default on a slab is its surface",
    tool: 'paint',
    scene: finishScene,
    input: { targets: ['slab_finish'], material: 'library:wood-floorplank1' },
    expect: {
      result: { painted: [{ id: 'slab_finish', roles: ['surface'] }] },
      after: { slab_finish: { slots: { surface: 'library:wood-floorplank1' } } },
    },
  },
  {
    name: 'set_material on a ceiling: paint its surface',
    tool: 'paint',
    scene: finishScene,
    input: { targets: ['ceiling_finish'], material: SOFT_WHITE },
    expect: {
      result: { painted: [{ id: 'ceiling_finish', roles: ['surface'] }] },
      after: { ceiling_finish: { slots: { surface: SOFT_WHITE } } },
    },
  },
  {
    name: "set_material's window and door frames ('frame', preset-nearblack): paint role frame",
    tool: 'paint',
    scene: finishScene,
    input: {
      targets: ['window_finish', 'door_finish'],
      role: 'frame',
      material: 'library:preset-nearblack',
    },
    expect: {
      result: {
        painted: [
          { id: 'window_finish', roles: ['frame'] },
          { id: 'door_finish', roles: ['frame'] },
        ],
      },
      after: {
        window_finish: { slots: { frame: 'library:preset-nearblack' } },
        door_finish: { slots: { frame: 'library:preset-nearblack' } },
      },
    },
  },
  {
    name: "set_material on a block ('body'): paint's default on a block is its body",
    tool: 'paint',
    scene: finishScene,
    input: { targets: ['block_pier'], material: 'library:flooring-wallstone1' },
    expect: {
      result: { painted: [{ id: 'block_pier', roles: ['body'] }] },
      after: { block_pier: { slots: { body: 'library:flooring-wallstone1' } } },
    },
  },
  {
    name: "set_material on a stair and its flight ('treads'): paint role treads on both",
    tool: 'paint',
    scene: finishScene,
    input: { targets: ['stair_finish', 'sseg_finish'], role: 'treads', material: 'library:wood-woodplank48' },
    expect: {
      result: {
        painted: [
          { id: 'stair_finish', roles: ['treads'] },
          { id: 'sseg_finish', roles: ['treads'] },
        ],
      },
      after: {
        stair_finish: { slots: { treads: 'library:wood-woodplank48' } },
        sseg_finish: { slots: { treads: 'library:wood-woodplank48' } },
      },
    },
  },
  {
    name: "set_material on a cabinet ('front'): paint role front",
    tool: 'paint',
    scene: finishScene,
    input: { targets: ['cabinet_finish'], role: 'front', material: 'library:preset-navy' },
    expect: {
      result: { painted: [{ id: 'cabinet_finish', roles: ['front'] }] },
      after: { cabinet_finish: { slots: { front: 'library:preset-navy' } } },
    },
  },
  {
    name: "set_material wrote any slot asked ('surface' on a stair, which has none); paint names the stair's",
    tool: 'paint',
    scene: finishScene,
    input: { targets: ['stair_finish'], role: 'surface', material: SOFT_WHITE },
    expect: { refusal: 'unknown_role', mentions: ['treads', 'body'] },
  },
  {
    name: "set_material on a catalog item's slot ('body', its model's slot_body): paint role body writes it, as the editor's Paint does",
    tool: 'paint',
    scene: finishScene,
    input: { targets: ['item_vase'], role: 'body', material: SOFT_WHITE },
    expect: {
      result: { painted: [{ id: 'item_vase', roles: ['body'] }] },
      after: { item_vase: { slots: { glaze: 'library:preset-navy', body: SOFT_WHITE } } },
      mentions: ["an item's surfaces are its model's"],
    },
  },
  {
    name: "set_material on an item's slot named 'exterior' (its model's slot_exterior): on an item it is the slot's name",
    tool: 'paint',
    scene: finishScene,
    input: { targets: ['item_vase'], role: 'exterior', material: SOFT_WHITE },
    expect: {
      result: { painted: [{ id: 'item_vase', roles: ['exterior'] }] },
      after: { item_vase: { slots: { glaze: 'library:preset-navy', exterior: SOFT_WHITE } } },
    },
  },
  {
    name: "set_material with no slot on an item wrote a 'surface' it may lack; paint asks for the role, naming those painted",
    tool: 'paint',
    scene: finishScene,
    input: { targets: ['item_vase'], material: SOFT_WHITE },
    expect: { refusal: 'unknown_role', mentions: ['item_vase', 'glaze'] },
  },
  {
    name: "paint with no role on a catalog item lists the surfaces its model has, when the host read them",
    tool: 'paint',
    scene: finishScene,
    input: { targets: ['item_vase'], material: SOFT_WHITE },
    context: {
      catalog: VASE_LIBRARY,
      assetViews: { vase: { surfaces: ['body', 'glaze', 'rim'] } },
    },
    expect: {
      refusal: 'unknown_role',
      mentions: ['its surfaces: body, glaze, rim', 'painted so far: glaze'],
    },
  },
  {
    name: 'paint with no role on a catalog item whose model has no named surface asks for a role, as before',
    tool: 'paint',
    scene: finishScene,
    input: { targets: ['item_vase'], material: SOFT_WHITE },
    context: { catalog: VASE_LIBRARY, assetViews: { vase: { surfaces: [] } } },
    expect: { refusal: 'unknown_role', mentions: ['(painted so far: glaze)'] },
  },
  {
    name: "set_material took a bare community id ('mtl_…'): paint writes it as library:<id>",
    tool: 'paint',
    scene: finishScene,
    input: { targets: ['block_pier'], material: 'mtl_terrazzo_green' },
    expect: {
      result: { finish: 'library:mtl_terrazzo_green' },
      after: { block_pier: { slots: { body: 'library:mtl_terrazzo_green' } } },
    },
  },
  {
    name: 'set_material skipped an id not in the scene and painted the rest; paint refuses the call, painting nothing',
    tool: 'paint',
    scene: finishScene,
    input: { targets: ['wall_s', 'wall_gone'], role: 'exterior', material: SIDING },
    expect: { refusal: 'target_not_found', mentions: ['wall_gone'] },
  },
  {
    name: "set_material answered an unknown id with a plain text; paint refuses it with the library's nearest",
    tool: 'paint',
    scene: finishScene,
    input: { targets: ['wall_s'], role: 'exterior', material: 'library:siding-vinyl-beige' },
    expect: { refusal: 'unknown_material', mentions: ['siding-vinyl-beige', 'search_materials'] },
  },
]

/** What list_materials served: the whole library, a surface, a kind, a word. */
export const LIST_MATERIALS_CASES: AgentToolCase[] = [
  {
    name: 'list_materials with no filter listed the library: a browse with no words lists all of it by name',
    tool: 'search_materials',
    scene: finishScene,
    input: { queries: [{}] },
    expect: {
      result: {},
      check: (result) => {
        const [group] = result.groups as { results: { ref: string; label: string }[]; more?: number }[]
        const refs = new Set(group!.results.map((material) => material.ref))
        const labels = group!.results.map((material) => material.label)
        return [
          ...MATERIAL_CATALOG.filter((material) => !refs.has(`library:${material.id}`)).map(
            (material) => `${material.id} is not listed`,
          ),
          ...(labels.join() === [...labels].sort((a, b) => a.localeCompare(b)).join()
            ? []
            : ['not by name']),
          ...(group!.more === undefined ? [] : [`${group!.more} materials left out`]),
        ]
      },
    },
  },
  {
    name: "list_materials by surface ({surface: 'floor'}, a stored Pro call): a browse of the floor",
    tool: 'search_materials',
    scene: finishScene,
    input: { queries: [{ surface: 'floor' }] },
    expect: {
      result: {},
      check: (result) => {
        const [group] = result.groups as { results: { ref: string; surfaces: string[] }[] }[]
        return [
          ...(group!.results.some((material) => material.ref === 'library:wood-floorplank1')
            ? []
            : ['no flooring listed']),
          ...group!.results
            .filter(({ surfaces }) => surfaces.length && !surfaces.includes('floor'))
            .map(({ ref }) => `${ref} does not suit a floor`),
        ]
      },
    },
  },
  {
    name: "list_materials by category ('roofing'): a browse of a kind",
    tool: 'search_materials',
    scene: finishScene,
    input: { queries: [{ kind: 'roofing' }] },
    expect: {
      result: {},
      check: (result) => {
        const [group] = result.groups as { kind: string; results: { kind: string; ref: string }[] }[]
        return [
          ...(group!.kind === 'roofing' ? [] : ['the group does not say its kind']),
          ...(group!.results.some(({ ref }) => ref === SHINGLES) ? [] : ['no shingles listed']),
          ...group!.results
            .filter(({ kind }) => kind !== 'roofing')
            .map(({ ref }) => `${ref} is not roofing`),
        ]
      },
    },
  },
  {
    name: "list_materials by category 'paint' (a stored Pro call; no such category, so nothing listed): a browse of the flat colours",
    tool: 'search_materials',
    scene: finishScene,
    input: { queries: [{ kind: 'colors' }] },
    expect: {
      result: {},
      check: (result) => {
        const [group] = result.groups as { results: { ref: string; kind: string }[] }[]
        return [
          ...(group!.results.some(({ ref }) => ref === SOFT_WHITE) ? [] : ['no soft white listed']),
          ...group!.results
            .filter(({ kind }) => kind !== 'colors')
            .map(({ ref }) => `${ref} is not a flat colour`),
        ]
      },
    },
  },
  {
    name: "list_materials by a word ('stucco'): search the word",
    tool: 'search_materials',
    scene: finishScene,
    input: { queries: [{ query: 'stucco' }] },
    expect: {
      result: {},
      check: (result) => {
        const [group] = result.groups as { results: { ref: string }[] }[]
        return group!.results[0]?.ref === 'library:concrete-stucco' ? [] : ['stucco is not first']
      },
    },
  },
  {
    name: "list_materials listed every match of a word ('wood', 23 then): a search lists 12 at a time, saying how many more and the offset that lists them",
    tool: 'search_materials',
    scene: finishScene,
    input: { queries: [{ query: 'wood' }, { query: 'wood', offset: 12 }] },
    expect: {
      result: {},
      check: (result) => {
        const [first, second] = result.groups as {
          results: { ref: string }[]
          more?: number
          next?: number
        }[]
        const more = first!.more ?? 0
        const refs = [...first!.results, ...second!.results].map(({ ref }) => ref)
        return [
          ...(first!.results.length === 12 && first!.next === 12 && more > 0
            ? []
            : ['the first page does not say what is left']),
          ...(second!.results.length === Math.min(12, more) &&
          (second!.more ?? 0) === more - second!.results.length
            ? []
            : ['the next page does not list the rest']),
          ...(new Set(refs).size === refs.length ? [] : ['a material listed twice']),
        ]
      },
    },
  },
  {
    name: "list_materials matched nothing for a word too short or common ('tv', 'for the'): a search lists none, never the whole library",
    tool: 'search_materials',
    scene: finishScene,
    input: { queries: [{ query: 'tv' }, { query: 'for the' }] },
    expect: {
      result: {
        groups: [
          { query: 'tv', results: [], missing: ['tv'] },
          { query: 'for the', results: [], missing: ['for', 'the'] },
        ],
      },
    },
  },
  {
    name: "list_materials matched any piece of an id ('plank48', '48'): so does a search",
    tool: 'search_materials',
    scene: finishScene,
    input: { queries: [{ query: 'plank48' }, { query: '48' }] },
    expect: {
      result: {},
      check: (result) => {
        const groups = result.groups as { results: { ref: string }[] }[]
        return groups
          .filter((group) => !group.results.some(({ ref }) => ref === 'library:wood-woodplank48'))
          .map((_, index) => `query ${index}: no wood-woodplank48`)
      },
    },
  },
  {
    name: "list_materials matched three letters inside an id ('cco' of concrete-stucco): a search does when no word answers them",
    tool: 'search_materials',
    scene: finishScene,
    input: { queries: [{ query: 'cco' }] },
    expect: {
      result: {},
      check: (result) => {
        const [group] = result.groups as { results: { ref: string }[]; missing?: string[] }[]
        return group!.results.some(({ ref }) => ref === 'library:concrete-stucco') && !group!.missing
          ? []
          : ['no stucco found']
      },
    },
  },
  {
    name: "list_materials matched a word inside an id ('lap'): a search matches an id's words",
    tool: 'search_materials',
    scene: finishScene,
    input: { queries: [{ query: 'lap', surface: 'wall' }] },
    expect: {
      result: {},
      check: (result) => {
        const [group] = result.groups as { results: { ref: string }[] }[]
        return group!.results.some(({ ref }) => ref === SIDING) ? [] : ['no lap siding found']
      },
    },
  },
]

export const FINISH_CASES: AgentToolCase[] = [...SET_MATERIAL_CASES, ...LIST_MATERIALS_CASES]
