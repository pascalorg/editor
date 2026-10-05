import { artifactUrl } from '../../lib/artifact-store'
import { scriptSource } from '../../lib/geometry-script-node'
import {
  BuildingNode,
  type CompiledGeometryScript,
  GeometryArtifactManifest,
  type GeometryScriptMount,
  ItemNode,
  LevelNode,
  WallNode,
} from '../../schema'
import type { AgentSurface, SceneGraph } from './cases'

/**
 * `add_object`, the one way to author an object Pascal has no type for. Each new object says what
 * it stands in for (its reason, listed by verify_scene), so every one names a gap in Pascal; one
 * on a floor shaped like a wall or a floor plate is refused with the tool to use; one named
 * after something Pascal builds gets a hint, not a refusal (Hawkesbury run 2: a word gate refused
 * "entry door pull handle (brass)" and the agent relabelled it until the label named nothing).
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
    mount,
    params: {},
    manifest: GeometryArtifactManifest.parse({
      bounds: { min: [-width / 2, 0, -depth / 2], max: [width / 2, height, depth / 2] },
      triangles,
    }),
  }
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
  // Production saw whole houses of plain custom solids, nothing editable as walls or rooms.
  create(
    'a plain box with a wall’s size is refused: walls exist',
    { name: 'Panel', category: 'panel' },
    [4, 2.7, 0.2],
    { refusal: 'use_walls', mentions: ['add_wall'] },
  ),
  // A bookcase and Hawkesbury's breeze-block screen (about 1.4 m wide and the tall box's height)
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
    'a name naming a Pascal type is built, with a hint naming the tool for it',
    { name: 'Juliet balcony', category: 'railing' },
    [3, 1.1, 0.05],
    { result: { mount: 'floor' }, mentions: ['is something Pascal builds: balconies'] },
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
