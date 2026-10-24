import { artifactUrl } from '../../lib/artifact-store'
import { scriptSource } from '../../lib/geometry-script-node'
import {
  BuildingNode,
  type CompiledGeometryScript,
  GeometryArtifactManifest,
  type GeometryScriptMount,
  ItemNode,
  LevelNode,
  SlabNode,
  WallNode,
} from '../../schema'
import type { AgentSurface, SceneGraph } from './cases'

/**
 * `add_object`, the one way to author an object Pascal has no type for. Each new object says what
 * it stands in for (its reason, listed by verify_scene), so every one names a gap in Pascal; one
 * on a floor shaped like a wall, or like a floor plate with no floor under it (a rug lies over
 * one), is refused with the tool to use; one named
 * after something Pascal builds gets a hint, not a refusal (a word gate once refused "entry door
 * pull handle (brass)", and the agent relabelled it until the label named nothing).
 *
 * The surfaces compile `code` before the operation runs; a case carries what that compile
 * produced, and each runner hands it over in place of its own compile.
 */
export type AddObjectCase = {
  name: string
  scene: () => SceneGraph
  input: Record<string, unknown>
  compiled: CompiledGeometryScript
  context?: { activeLevelId?: string | null }
  surfaces?: AgentSurface[]
  expect:
    | {
        refusal: string
        mentions?: string[]
        /** Refused before the script runs: the compile is never called. */
        beforeCompile?: true
      }
    | {
        result: Record<string, unknown>
        /** Fields the object built or edited (the result's nodeId) has afterwards. */
        node?: Record<string, unknown>
        /** Text the result must include. */
        mentions?: string[]
      }
}

/**
 * A compile of a solid of this size, bottom-centre at the origin, as the compiler reports it: a
 * plain box (12 triangles) unless it has more detail.
 */
export function compiledSolid(
  [width, height, depth]: [number, number, number],
  mount: GeometryScriptMount = 'floor',
  triangles = 12,
): CompiledGeometryScript {
  return {
    sha256: 'a'.repeat(64),
    script: 'b'.repeat(64),
    language: 'three',
    mount,
    params: {},
    manifest: GeometryArtifactManifest.parse({
      bounds: { min: [-width / 2, 0, -depth / 2], max: [width / 2, height, depth / 2] },
      triangles,
    }),
  }
}

/**
 * What a compile that could not measure the object leaves in the manifest: a mesh at a position
 * that is not a number made every bound NaN. A structured clone (the chat's worker) keeps NaN; a
 * JSON hop (a tab job answering the server) turns it to null.
 */
export function compiledUnmeasured(
  hop: 'clone' | 'json',
  mount: GeometryScriptMount = 'floor',
): CompiledGeometryScript {
  const solid = compiledSolid([1.2, 2.8, 0.6], mount)
  const nan: [number, number, number] = [Number.NaN, Number.NaN, Number.NaN]
  const compiled = {
    ...solid,
    params: { width: 7.7, display: true },
    manifest: { ...solid.manifest, bounds: { min: nan, max: nan } },
  }
  return hop === 'json' ? JSON.parse(JSON.stringify(compiled)) : compiled
}

/** An object add_object built earlier, with the reason it was given. */
export function authoredItem(
  id: string,
  parentId: string,
  fields: { name: string; category: string; reason?: string; size: [number, number, number] },
) {
  const compiled = compiledSolid(fields.size)
  return ItemNode.parse({
    id,
    parentId,
    name: fields.name,
    source: scriptSource(compiled),
    asset: {
      id: `script_${compiled.sha256.slice(0, 16)}`,
      category: fields.category,
      name: fields.name,
      thumbnail: '',
      source: 'mine',
      src: artifactUrl(compiled.sha256),
      dimensions: fields.size,
    },
    ...(fields.reason ? { metadata: { reason: fields.reason } } : {}),
  })
}

/** One floor with a 6 m wall, and a screen built earlier with add_object. */
function floorScene(): SceneGraph {
  const wall = WallNode.parse({
    id: 'wall_south',
    parentId: 'level_0',
    start: [0, 0],
    end: [6, 0],
    height: 3,
  })
  const screen = authoredItem('item_screen', 'level_0', {
    name: 'Garden screen',
    category: 'screen',
    reason: 'No screen type.',
    size: [1.2, 1.8, 0.2],
  })
  const level = LevelNode.parse({
    id: 'level_0',
    parentId: 'building_main',
    level: 0,
    height: 3,
    children: [wall.id, screen.id],
  })
  const building = BuildingNode.parse({ id: 'building_main', children: [level.id] })
  return {
    nodes: Object.fromEntries([building, level, wall, screen].map((node) => [node.id, node])),
    rootNodeIds: [building.id],
  }
}

/** The floor with its declared roof level over it, the level a roof just placed brings into view. */
function roofedFloorScene(): SceneGraph {
  const { nodes, rootNodeIds } = floorScene()
  const roofLevel = LevelNode.parse({
    id: 'level_roof',
    parentId: 'building_main',
    level: 1,
    height: 2,
    metadata: { role: 'roof' },
  })
  const building = nodes.building_main as BuildingNode
  return {
    nodes: {
      ...nodes,
      [building.id]: { ...building, children: [...building.children, roofLevel.id] },
      [roofLevel.id]: roofLevel,
    },
    rootNodeIds,
  }
}

/**
 * The floor with a slab of a level beside its walls, as the host stores a room's floor plate: a
 * child of the level, its outline in the level's x and z.
 */
function floorWithSlab(
  polygon: [number, number][],
  { holes = [], levelId = 'level_0' }: { holes?: [number, number][][]; levelId?: string } = {},
) {
  return (): SceneGraph => {
    const { nodes, rootNodeIds } = levelId === 'level_0' ? floorScene() : roofedFloorScene()
    const slab = SlabNode.parse({
      id: 'slab_living',
      parentId: levelId,
      polygon,
      holes,
      boundary: 'auto',
    })
    const level = nodes[levelId] as LevelNode
    return {
      nodes: {
        ...nodes,
        [level.id]: { ...level, children: [...level.children, slab.id] },
        [slab.id]: slab,
      },
      rootNodeIds,
    }
  }
}

/** A living room's floor: 6 m along x, 5 m along z. */
const LIVING_ROOM: [number, number][] = [
  [0, 0],
  [6, 0],
  [6, 5],
  [0, 5],
]

/** The owner's rug (2026-10-19, "add a living room"): 2.40 × 3.18 m and 0.02 m thick. */
const RUG: [number, number, number] = [2.4, 0.02, 3.18]

const CODE = 'export default function build({ THREE }) { return new THREE.Group() }'

const create = (
  name: string,
  input: Record<string, unknown>,
  size: [number, number, number],
  expect: AddObjectCase['expect'],
  mount: GeometryScriptMount = 'floor',
  triangles?: number,
): AddObjectCase => ({
  name,
  scene: floorScene,
  input: { code: CODE, reason: 'Pascal has no type for it.', ...input },
  compiled: compiledSolid(size, mount, triangles),
  expect,
})

export const ADD_OBJECT_CASES: AddObjectCase[] = [
  // A roof just placed selects its level: an object given no host then landed among the roofs, the
  // storey's plan short of it. Refused, naming the storey it covers so one retry lands.
  {
    name: 'an object given no host while the roof level is in view is refused, naming the storey it covers',
    scene: roofedFloorScene,
    input: { code: CODE, name: 'Side table', reason: 'Pascal has no side table.' },
    compiled: compiledSolid([0.5, 0.6, 0.5]),
    context: { activeLevelId: 'level_roof' },
    expect: { refusal: 'roof_level', mentions: ['"Side table"', 'level_0'] },
  },
  // Named onto the roof level, it goes up with the roof.
  {
    name: 'an object named onto the roof level is made there: it goes up with the roof',
    scene: roofedFloorScene,
    input: {
      code: CODE,
      name: 'Chimney cap',
      reason: 'Pascal has no chimney cap.',
      parentId: 'level_roof',
    },
    compiled: compiledSolid([0.6, 0.4, 0.6]),
    expect: { result: { mount: 'floor' }, node: { parentId: 'level_roof' } },
  },
  create(
    'a new object keeps what it stands in for',
    {
      name: 'Cornice',
      category: 'trim',
      reason: 'Pascal has no cornice type.',
      position: [3, 2.4, 1],
    },
    [6, 0.3, 0.4],
    {
      result: { mount: 'floor' },
      node: {
        name: 'Cornice',
        parentId: 'level_0',
        asset: { category: 'trim' },
        metadata: { reason: 'Pascal has no cornice type.' },
      },
    },
  ),
  // Live over the MCP (2026-10-05): the script ran and its artifacts were stored before the missing
  // reason was refused.
  create(
    'a new object without a reason is refused before its script runs',
    { name: 'Planter', reason: undefined },
    [1.2, 0.5, 0.4],
    { refusal: 'reason_required', mentions: ['reason'], beforeCompile: true },
  ),
  // An agent's cabinet script put a material where a position goes, with one param on: the compile
  // answered with NaN bounds and the item schema threw its raw validation array at the model.
  {
    name: 'an object whose bounds are not numbers is refused before its asset is built',
    scene: floorScene,
    input: {
      code: CODE,
      name: 'Library wall',
      category: 'cabinet',
      reason: 'Pascal has no library wall.',
      params: { width: 7.7, display: true },
    },
    compiled: compiledUnmeasured('clone'),
    expect: {
      refusal: 'unmeasurable_object',
      mentions: ['"Library wall" cannot be measured', '"display":true', 'nothing was added'],
    },
  },
  {
    name: 'bounds that crossed a JSON hop as null are refused the same way',
    scene: floorScene,
    input: {
      code: CODE,
      name: 'Library wall',
      category: 'cabinet',
      reason: 'Pascal has no library wall.',
    },
    compiled: compiledUnmeasured('json'),
    expect: { refusal: 'unmeasurable_object', mentions: ['"Library wall" cannot be measured'] },
  },
  {
    name: 'an edit whose rebuild cannot be measured is refused and leaves the object as it was',
    scene: floorScene,
    input: { nodeId: 'item_screen', code: CODE, params: { display: true } },
    compiled: compiledUnmeasured('clone'),
    expect: {
      refusal: 'unmeasurable_object',
      mentions: ['item_screen cannot be measured', 'nothing was changed'],
    },
  },
  // Production saw whole houses of plain custom solids, nothing editable as walls or rooms.
  create(
    'a plain box with a wall’s size is refused: walls exist',
    { name: 'Panel', category: 'panel' },
    [4, 2.7, 0.2],
    { refusal: 'use_walls', mentions: ['add_wall'] },
  ),
  // A bookcase and a breeze-block screen (about 1.4 m wide and the tall box's height)
  // have a wall's box too, with shelves or holes in it: built, the wall tool named in case.
  create(
    'a detailed object with a wall’s size is built, with a hint naming the wall tool',
    { name: 'Breeze-block screen', category: 'screen' },
    [1.4, 5.6, 0.19],
    { result: { mount: 'floor' }, mentions: ['add_wall'] },
    'floor',
    1680,
  ),
  create(
    'a bookcase is built: furniture may have a wall’s box',
    { name: 'Bookcase', category: 'furniture' },
    [1.2, 2.1, 0.35],
    { result: { mount: 'floor' }, node: { name: 'Bookcase' } },
    'floor',
    96,
  ),
  create(
    'a floor plate is refused, measured as drawn in x and z: slabs exist',
    { name: 'Terrace', category: 'deck' },
    [8.05, 0.15, 13.52],
    { refusal: 'use_slab', mentions: ['slab', '8.05 × 13.52'] },
  ),
  create(
    'a turned floor plate is measured as it stands',
    { name: 'Terrace', category: 'deck', rotation: 90 },
    [8.05, 0.15, 13.52],
    { refusal: 'use_slab', mentions: ['13.52 × 8.05'] },
  ),
  // A flat object is refused only where it would serve as a floor: with no floor under it. The
  // owner's rug was refused twice on a living room's floor and the agent painted one instead.
  {
    name: 'a rug lying over a room’s floor is furniture and is built',
    scene: floorWithSlab(LIVING_ROOM),
    input: {
      code: CODE,
      name: 'Fringed wool rug',
      category: 'rug',
      reason: 'Pascal has no rug type.',
      position: [3, 0, 2.5],
    },
    compiled: compiledSolid(RUG),
    expect: { result: { mount: 'floor' }, node: { name: 'Fringed wool rug', parentId: 'level_0' } },
  },
  {
    name: 'a rug hanging over a floor’s edge, most of it on the floor, is built',
    scene: floorWithSlab(LIVING_ROOM),
    input: {
      code: CODE,
      name: 'Fringed wool rug',
      category: 'rug',
      reason: 'Pascal has no rug type.',
      position: [0.5, 0, 2.5],
    },
    compiled: compiledSolid(RUG),
    expect: { result: { mount: 'floor' }, node: { name: 'Fringed wool rug' } },
  },
  {
    name: 'the same plate on a level with no floor stays refused, with its fact',
    scene: floorScene,
    input: {
      code: CODE,
      name: 'Fringed wool rug',
      category: 'rug',
      reason: 'Pascal has no rug type.',
      position: [3, 0, 2.5],
    },
    compiled: compiledSolid(RUG),
    expect: {
      refusal: 'use_slab',
      mentions: [
        '2.40 × 3.18 m in x and z, 0.02 m thick, on the floor) is a floor plate: build it as a slab.',
      ],
    },
  },
  {
    name: 'the same plate where the level’s floor is not stays refused: bare ground beside a floor',
    scene: floorWithSlab(LIVING_ROOM),
    input: {
      code: CODE,
      name: 'Fringed wool rug',
      category: 'rug',
      reason: 'Pascal has no rug type.',
      position: [12, 0, 2.5],
    },
    compiled: compiledSolid(RUG),
    expect: { refusal: 'use_slab', mentions: ['is a floor plate: build it as a slab.'] },
  },
  {
    name: 'a plate mostly past the floor’s edge is a floor, not a rug: refused',
    scene: floorWithSlab(LIVING_ROOM),
    input: {
      code: CODE,
      name: 'Terrace',
      category: 'deck',
      reason: 'Pascal has no deck type.',
      position: [-0.9, 0, 2.5],
    },
    compiled: compiledSolid(RUG),
    expect: { refusal: 'use_slab', mentions: ['is a floor plate: build it as a slab.'] },
  },
  {
    name: 'a plate over the opening cut in a floor has no floor under it: refused',
    scene: floorWithSlab(LIVING_ROOM, {
      holes: [
        [
          [1, 0.5],
          [5, 0.5],
          [5, 4.5],
          [1, 4.5],
        ],
      ],
    }),
    input: {
      code: CODE,
      name: 'Fringed wool rug',
      category: 'rug',
      reason: 'Pascal has no rug type.',
      position: [3, 0, 2.5],
    },
    compiled: compiledSolid(RUG),
    expect: { refusal: 'use_slab', mentions: ['is a floor plate: build it as a slab.'] },
  },
  {
    name: 'a floor on another level is no floor under the plate: refused',
    scene: floorWithSlab(LIVING_ROOM, { levelId: 'level_roof' }),
    input: {
      code: CODE,
      name: 'Fringed wool rug',
      category: 'rug',
      reason: 'Pascal has no rug type.',
      position: [3, 0, 2.5],
    },
    compiled: compiledSolid(RUG),
    expect: { refusal: 'use_slab', mentions: ['is a floor plate: build it as a slab.'] },
  },
  // The floor is read where the plate stands, turned as it is: a strip of floor 1.4 m deep holds
  // 44% of the rug along z and 58% of the rug turned a quarter.
  {
    name: 'a rug short of the floor strip it lies along is refused, built once turned to lie along it',
    scene: floorWithSlab([
      [0, 0],
      [8, 0],
      [8, 1.4],
      [0, 1.4],
    ]),
    input: {
      code: CODE,
      name: 'Fringed wool rug',
      category: 'rug',
      reason: 'Pascal has no rug type.',
      position: [4, 0, 0.7],
    },
    compiled: compiledSolid(RUG),
    expect: { refusal: 'use_slab', mentions: ['is a floor plate: build it as a slab.'] },
  },
  {
    name: 'the same rug turned a quarter, 58% on the strip, is built',
    scene: floorWithSlab([
      [0, 0],
      [8, 0],
      [8, 1.4],
      [0, 1.4],
    ]),
    input: {
      code: CODE,
      name: 'Fringed wool rug',
      category: 'rug',
      reason: 'Pascal has no rug type.',
      position: [4, 0, 0.7],
      rotation: 90,
    },
    compiled: compiledSolid(RUG),
    expect: { result: { mount: 'floor' }, node: { name: 'Fringed wool rug' } },
  },
  create(
    'a plate held off the floor is built: a canopy is no slab',
    { name: 'Canopy', category: 'canopy', position: [3, 2.6, 1] },
    [4, 0.2, 3],
    { result: { mount: 'floor' }, node: { name: 'Canopy' } },
  ),
  create(
    'a wall-side object shaped like a wall is built: it dresses the wall',
    { name: 'Wainscot', category: 'panel', parentId: 'wall_south', position: [3, 0, 0] },
    [4, 2.6, 0.05],
    { result: { mount: 'wall-side' }, node: { parentId: 'wall_south' } },
    'wall-side',
  ),
  create(
    'a back-side wall mount defaults to facing away from its wall',
    { parentId: 'wall_south', side: 'back' },
    [1, 1, 0.04],
    { result: { mount: 'wall-side' }, node: { side: 'back', rotation: [0, Math.PI, 0] } },
    'wall-side',
  ),
  create(
    'a front-side wall mount defaults to facing away from its wall',
    { parentId: 'wall_south', side: 'front' },
    [1, 1, 0.04],
    { result: { mount: 'wall-side' }, node: { side: 'front', rotation: [0, 0, 0] } },
    'wall-side',
  ),
  create(
    'an explicit back-side wall mount rotation remains explicit',
    { parentId: 'wall_south', side: 'back', rotation: 0 },
    [1, 1, 0.04],
    { result: { mount: 'wall-side' }, node: { side: 'back', rotation: [0, 0, 0] } },
    'wall-side',
  ),
  {
    name: 'rebuilding a saved back-side wall object preserves its rotation',
    scene: () => {
      const scene = floorScene()
      const previous = ItemNode.parse(scene.nodes.item_screen)
      scene.nodes.item_screen = ItemNode.parse({
        ...previous, parentId: 'wall_south', wallId: 'wall_south', side: 'back',
        asset: { ...previous.asset, attachTo: 'wall-side' },
      })
      const wall = WallNode.parse(scene.nodes.wall_south)
      scene.nodes.wall_south = { ...wall, children: [previous.id] }
      const level = LevelNode.parse(scene.nodes.level_0)
      scene.nodes.level_0 = { ...level, children: [wall.id] }
      return scene
    },
    input: { nodeId: 'item_screen', code: CODE },
    compiled: compiledSolid([1, 1, 0.04], 'wall-side'),
    expect: { result: { nodeId: 'item_screen' }, node: { rotation: [0, 0, 0], side: 'back' } },
  },
  create(
    'a name naming a Pascal type is built, with a hint naming the tool for it',
    { name: 'Spiral staircase', category: 'stair' },
    [1.6, 2.8, 1.6],
    { result: { mount: 'floor' }, mentions: ['is something Pascal builds: create_stair'] },
  ),
  create(
    'a type word that only qualifies the name is built',
    { name: 'entry door pull handle (brass)', category: 'hardware', position: [1, 0.9, 1] },
    [0.04, 0.6, 0.06],
    { result: { mount: 'floor' }, node: { name: 'entry door pull handle (brass)' } },
  ),
  // The editor's inspector and resize handles rebuild an object through the same operation: a
  // person may make it any shape.
  {
    name: 'an edit is not judged by its shape, and keeps the reason',
    scene: floorScene,
    input: { nodeId: 'item_screen', code: CODE },
    compiled: compiledSolid([4, 2.6, 0.2]),
    expect: {
      result: { nodeId: 'item_screen', size: [4, 2.6, 0.2] },
      node: { metadata: { reason: 'No screen type.' } },
    },
  },
  {
    name: 'an edit takes a new reason',
    scene: floorScene,
    input: { nodeId: 'item_screen', code: CODE, reason: 'No breeze-block type.' },
    compiled: compiledSolid([1.2, 1.8, 0.2]),
    expect: {
      result: { nodeId: 'item_screen' },
      node: { metadata: { reason: 'No breeze-block type.' } },
    },
  },
]
