import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeDefinition,
  type AnyNodeId,
  applySceneSnapshot,
  BaseNode,
  BuildingNode,
  clearSceneHistory,
  emitter,
  getLevelElevations,
  ItemNode,
  LevelNode,
  loadPlugin,
  type NodeDefinition,
  nodeRegistry,
  nodeType,
  objectId,
  type RevealConfig,
  runAsSceneCommitAuthor,
  type SceneCommit,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { act, create } from '@react-three/test-renderer'
import { BoxGeometry, Group, Matrix4, Mesh, MeshBasicMaterial, Object3D } from 'three'
import { z } from 'zod'
import { NodeRenderer } from '../../components/renderers/node-renderer'
import { DustPool } from '../../lib/construction-dust'
import { OVERLAY_LAYER, scenePassLayers } from '../../lib/layers'
import { commitEditCandidates } from '../../lib/reveal-candidates'
import { hasRevealPose } from '../../lib/reveal-pose'
import {
  coverRangeAt,
  LAZY_REVEAL_TIMING,
  lazyRetractTimingAt,
  lazyTimingAt,
  RETRACT_TIMING,
  REVEAL_TIMING,
  retractTimingAt,
  revealTimingAt,
} from '../../lib/reveal-schedule'
import { revealWipeLevelOf } from '../../lib/reveal-wipe'
import useViewer from '../../store/use-viewer'
import { GeometrySystem } from '../geometry/geometry-system'
import { heldLevelY } from '../level/level-hold'
import { LevelSystem } from '../level/level-system'
import { visibleMaterialsOf, wallsInPlay } from '../wall/wall-cutout-cache'
import { ConstructionDust } from './construction-dust'

// Construction reveal, failure modes written before the code: a person's edit,
// a load, an undo, a capture, a selection, reduced motion and the read-only
// viewer are instant; an agent build mounts phase by phase and settles with
// every root back on its own transform.
import {
  ConstructionReveal,
  type ConstructionRevealDriver,
  type ConstructionRevealLevel,
  getRetractTurn,
  getRevealPlanSpeed,
  getRevealPlanState,
  getRevealTurn,
  isNodeRevealing,
  isRevealAssembling,
  isRevealWaiting,
  type RetractResult,
  type RevealEvent,
  type RevealPhaseEvent,
  retractNodes,
  revealClockMs,
  seatLiftedNow,
  setRevealPreroll,
  startConstructionReveal,
  subscribeRevealAssembling,
  subscribeRevealEvents,
  subscribeRevealPhases,
  subscribeRevealTicks,
  useRevealPlanActive,
} from './construction-reveal'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
globalThis.requestAnimationFrame ??= (callback) => {
  callback(0)
  return 0
}
globalThis.cancelAnimationFrame ??= () => {}

const PLUGIN_ID = 'fixture:reveal'
const base = { object: 'node', parentId: null, visible: true, metadata: {} } as const
// Hosts list their children like a level does.
const Children = { children: LevelNode.shape.children }

function revealKind(
  kind: string,
  prefix: string,
  reveal: RevealConfig | null,
  geometry: (node: AnyNode) => BoxGeometry | null,
  extra: Record<string, unknown> = {},
  revealOnEdit: readonly string[] = [],
): { schema: typeof BaseNode; definition: AnyNodeDefinition } {
  const schema = BaseNode.extend({
    id: objectId(prefix),
    type: nodeType(kind),
    ...Children,
    ...extra,
  })
  const definition: NodeDefinition<typeof schema> = {
    kind,
    schemaVersion: 1,
    schema,
    category: 'structure',
    defaults: () => base,
    capabilities: {
      ...(reveal ? { reveal } : {}),
      ...(revealOnEdit.length ? { revealOnEdit } : {}),
    },
    geometry: (node) => {
      const built = geometry(node as AnyNode)
      return built ? new Group().add(new Mesh(built)) : new Group()
    },
  }
  return { schema, definition: definition as unknown as AnyNodeDefinition }
}

const Slab = revealKind('fixture:slab', 'fxslab', { phase: 'foundation', style: 'scale' }, () =>
  new BoxGeometry(4, 0.2, 4).translate(2, -0.1, 2),
)
const Wall = revealKind('fixture:wall', 'fxwall', { phase: 'structure', style: 'rise' }, () =>
  new BoxGeometry(4, 2.5, 0.2).translate(2, 1.25, 0),
)
/** The walls the wall system has reached: a queued wall has no mesh before. */
const reached = new Set<string>()
const QueuedWall = revealKind(
  'fixture:queued-wall',
  'fxqwall',
  { phase: 'structure', style: 'rise' },
  (node) => (reached.has(node.id) ? new BoxGeometry(4, 2.5, 0.2).translate(2, 1.25, 0) : null),
)
/** A wall of the real kind's name: what a deletion dresses is a node of type `wall`. */
const RealWall = revealKind(
  'wall',
  'wall',
  { phase: 'structure', style: 'rise' },
  () => new BoxGeometry(4, 2.5, 0.2).translate(2, 1.25, 0),
  {
    start: z.tuple([z.number(), z.number()]).default([0, 0]),
    end: z.tuple([z.number(), z.number()]).default([4, 0]),
    height: z.number().default(2.5),
    thickness: z.number().default(0.2),
    frontSide: z.string().default('interior'),
    backSide: z.string().default('exterior'),
  },
)
const Door = revealKind('fixture:door', 'fxdoor', { phase: 'openings', style: 'scale' }, () =>
  new BoxGeometry(0.9, 2.1, 0.1).translate(0, 1.05, 0),
)
const Item = revealKind('fixture:item', 'fxitem', { phase: 'furnishing', style: 'scale' }, () =>
  new BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
)
// Slice 2's styles, each declaring its own height.
const Post = revealKind(
  'fixture:post',
  'fxpost',
  { phase: 'structure', style: 'drop', height: 4 },
  () => new BoxGeometry(0.3, 2.5, 0.3).translate(0, 1.25, 0),
)
const Plate = revealKind(
  'fixture:plate',
  'fxplate',
  { phase: 'foundation', style: 'settle', height: 0.08 },
  () => new BoxGeometry(4, 0.2, 4).translate(2, -0.1, 2),
)
// A wall that is bent or resized: its `scale` makes its picture, its `name` does not.
const Beam = revealKind(
  'fixture:beam',
  'fxbeam',
  { phase: 'structure', style: 'rise' },
  () => new BoxGeometry(4, 2.5, 0.2).translate(2, 1.25, 0),
  { scale: ItemNode.shape.scale },
  ['scale'],
)
// A slab edited the same way: the edit plays as a settle, as it came in.
const Floorplate = revealKind(
  'fixture:floorplate',
  'fxfloorplate',
  { phase: 'foundation', style: 'settle', height: 0.08 },
  () => new BoxGeometry(4, 0.2, 4).translate(2, -0.1, 2),
  { scale: ItemNode.shape.scale },
  ['scale'],
)
const Flight = revealKind(
  'fixture:flight',
  'fxflight',
  { phase: 'circulation', style: 'drop', height: 2.5 },
  () => new BoxGeometry(1, 2.5, 3).translate(0, 1.25, 1.5),
)
const Pane = revealKind('fixture:pane', 'fxpane', { phase: 'openings', style: 'cut' }, () =>
  new BoxGeometry(1, 1.2, 0.1).translate(0, 1.5, 0),
)
const Roof = revealKind(
  'fixture:roof',
  'fxroof',
  { phase: 'roof', style: 'assemble', height: 4 },
  () => new BoxGeometry(0.1, 0.1, 0.1).translate(0, 3, 0),
)
// A catalog piece: every model brings its own materials, so each model is a first draw of its own.
const Model = revealKind(
  'fixture:model',
  'fxmodel',
  { phase: 'furnishing', style: 'scale' },
  () => new BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
  { asset: ItemNode.shape.asset },
)
// A piece of furniture, as the editor's items are declared: it falls 30 cm and lands.
const Crate = revealKind(
  'fixture:crate',
  'fxcrate',
  { phase: 'furnishing', style: 'drop', height: 0.3 },
  () => new BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
)
// A piece of furniture that has a place of its own: position and rotation, as the editor's items do.
const Movable = revealKind(
  'fixture:movable',
  'fxmovable',
  { phase: 'furnishing', style: 'drop', height: 0.3 },
  () => new BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
  {
    position: ItemNode.shape.position,
    rotation: ItemNode.shape.rotation,
  },
)
// A roof that lifts out of the way while the furniture drops in, and seats again after.
const Lid = revealKind(
  'fixture:lid',
  'fxlid',
  { phase: 'roof', style: 'assemble', height: 4, clears: { for: 'furnishing', height: 2.4 } },
  () => new BoxGeometry(0.1, 0.1, 0.1).translate(0, 3, 0),
)
// A roof's part declares no reveal of its own: its host's `assemble` stages it.
const Part = revealKind('fixture:part', 'fxpart', null, () =>
  new BoxGeometry(3, 1, 4).translate(0, 3.5, 0),
)
// Roofs of three sizes: a small porch, a tall hip, a long flat one.
const Porch = revealKind(
  'fixture:porch',
  'fxporch',
  { phase: 'roof', style: 'assemble', height: 4 },
  () => new BoxGeometry(3, 0.7, 2).translate(0, 3.1, 0),
)
const Hip = revealKind(
  'fixture:hip',
  'fxhip',
  { phase: 'roof', style: 'assemble', height: 4 },
  () => new BoxGeometry(9, 5, 9).translate(0, 5.5, 0),
)
const LongFlat = revealKind(
  'fixture:longflat',
  'fxlongflat',
  { phase: 'roof', style: 'assemble', height: 4 },
  () => new BoxGeometry(14, 0.3, 4).translate(0, 3, 0),
)
// A pitched roof: it rises 1.6 m from its eave to its ridge.
const Gable = revealKind(
  'fixture:gable',
  'fxgable',
  { phase: 'roof', style: 'assemble', height: 4 },
  () => new BoxGeometry(6, 1.6, 4).translate(0, 3.6, 0),
)

const make = (kind: { schema: typeof BaseNode }, data: Record<string, unknown> = {}) =>
  kind.schema.parse(data) as AnyNode

const NO_CHILDREN: AnyNodeId[] = []

function LevelChildren({ levelId }: { levelId: AnyNodeId }) {
  const children = useScene(
    (state) =>
      (state.nodes[levelId] as { children?: AnyNodeId[] } | undefined)?.children ?? NO_CHILDREN,
  )
  return (
    <>
      {children.map((id) => (
        <NodeRenderer key={id} nodeId={id} />
      ))}
    </>
  )
}

type Renderer = Awaited<ReturnType<typeof create>>

let renderer: Renderer | null = null
let driver: ConstructionRevealDriver | null = null
let dust = new DustPool()
let level: ConstructionRevealLevel = 'full'
let restoreRegistry: () => void = () => {}
let now = 0
const previousScene = useScene.getState()
const previousViewer = useViewer.getState()

function loadLevels(count = 1): AnyNodeId[] {
  const levels = Array.from({ length: count }, (_, index) =>
    LevelNode.parse({ level: index, children: [] }),
  )
  const nodes: Record<string, AnyNode> = {}
  for (const level of levels) nodes[level.id] = level as AnyNode
  useScene.getState().setScene(nodes, levels.map((level) => level.id) as AnyNodeId[], {
    installedPlugins: [PLUGIN_ID],
    hasExplicitPluginInstallState: true,
  })
  clearSceneHistory()
  return levels.map((level) => level.id as AnyNodeId)
}

async function mount(levelIds: AnyNodeId[]) {
  renderer = await create(
    <>
      {levelIds.map((levelId) => (
        <LevelChildren key={levelId} levelId={levelId} />
      ))}
      <GeometrySystem />
    </>,
  )
  await frame(0)
}

/**
 * One frame in the viewer's order: the reveal advances (priority 0), the
 * systems build, and React mounts what started once the frame is over.
 */
async function frame(ms = 20) {
  now += ms
  await act(async () => {
    driver?.tick(now)
    await renderer?.advanceFrames(1, ms / 1000)
  })
}

async function frames(totalMs: number, ms = 20) {
  for (let elapsed = 0; elapsed < totalMs; elapsed += ms) await frame(ms)
}

async function agentWrites(write: () => void) {
  await act(async () => {
    runAsSceneCommitAuthor('agent', write)
  })
}

function start(
  options: {
    prefersReducedMotion?: () => boolean
    speed?: () => number
    deletes?: (commit: SceneCommit) => boolean
  } = {},
) {
  dust = new DustPool()
  driver = startConstructionReveal({
    reveals: (commit) => commit.author === 'agent',
    ...(options.deletes ? { deletes: options.deletes } : {}),
    prefersReducedMotion: options.prefersReducedMotion ?? (() => false),
    level: () => level,
    ...(options.speed ? { speed: options.speed } : {}),
    dust,
  })
}

const root = (id: string): Object3D | undefined => sceneRegistry.nodes.get(id)

/** The root's matrix as three composes it this frame, reveal pose included. */
function composed(object: Object3D): Matrix4 {
  object.updateMatrix()
  return object.matrix.clone()
}

/** Its own transform, with no reveal pose. */
function own(object: Object3D): Matrix4 {
  return new Matrix4().compose(object.position, object.quaternion, object.scale)
}

const yScale = (object: Object3D) => composed(object).elements[5]!
/** How far above its own position the reveal holds the root, in its parent's frame. */
const lift = (object: Object3D) => composed(object).elements[13]! - object.position.y

beforeEach(async () => {
  restoreRegistry = nodeRegistry._snapshot()
  nodeRegistry._reset()
  await loadPlugin({
    id: PLUGIN_ID,
    apiVersion: 1,
    nodes: [
      Slab.definition,
      Wall.definition,
      RealWall.definition,
      QueuedWall.definition,
      Door.definition,
      Item.definition,
      Post.definition,
      Plate.definition,
      Flight.definition,
      Beam.definition,
      Floorplate.definition,
      Pane.definition,
      Roof.definition,
      Lid.definition,
      Crate.definition,
      Movable.definition,
      Model.definition,
      Part.definition,
      Gable.definition,
      Porch.definition,
      Hip.definition,
      LongFlat.definition,
    ],
  })
  now = 0
  level = 'full'
  reached.clear()
})

afterEach(async () => {
  setRevealPreroll(null)
  await act(async () => driver?.stop())
  driver = null
  await renderer?.unmount()
  renderer = null
  restoreRegistry()
  useScene.setState(previousScene)
  useViewer.setState(previousViewer)
  sceneRegistry.clear()
})

describe('an agent build', () => {
  test('mounts phase by phase over frames, rises walls from their base and settles on their own transforms', async () => {
    const [levelId] = loadLevels()
    await mount([levelId!])
    start()
    const slab = make(Slab)
    const walls = [make(Wall), make(Wall), make(Wall)]
    const door = make(Door)
    const item = make(Item)
    await agentWrites(() =>
      useScene
        .getState()
        .createNodes([
          { node: item, parentId: levelId },
          ...walls.map((node) => ({ node, parentId: levelId })),
          { node: slab, parentId: levelId },
        ]),
    )
    await agentWrites(() => useScene.getState().createNode(door, walls[0]!.id as AnyNodeId))

    // The write is done, the store holds it, and nothing has mounted yet.
    expect(useScene.getState().nodes[item.id]).toBeDefined()
    for (const node of [slab, ...walls, door, item]) expect(root(node.id)).toBeUndefined()

    const mountedAt = new Map<string, number>()
    let roseFromBase = false
    while (now < REVEAL_TIMING.capMs + 1000) {
      await frame()
      for (const node of [slab, ...walls, door, item]) {
        if (root(node.id) && !mountedAt.has(node.id)) mountedAt.set(node.id, now)
      }
      const wall = root(walls[0]!.id)
      if (wall?.children.length) {
        const matrix = composed(wall)
        const sy = matrix.elements[5]!
        if (sy > 0.05 && sy < 0.95) {
          roseFromBase = true
          expect(matrix.elements[0]).toBeCloseTo(1)
          expect(matrix.elements[13]).toBeCloseTo(0)
        }
      }
    }

    // The first of each kind mounts up front, hidden (see 'a warm start'); the rest keep to the phases.
    const at = (node: AnyNode) => mountedAt.get(node.id)!
    const first = [slab, item, walls[0]!, door]
    const upFront = Math.max(...first.map(at))
    for (const node of first) expect(at(node)).toBeLessThanOrEqual(40)
    const later = walls.slice(1)
    expect(Math.min(...later.map(at))).toBeGreaterThan(upFront)
    expect(Math.max(...later.map(at))).toBeLessThanOrEqual(REVEAL_TIMING.capMs)
    expect(roseFromBase).toBe(true)
    for (const node of [slab, ...walls, door, item]) {
      const object = root(node.id)!
      expect(isNodeRevealing(node.id)).toBe(false)
      expect(composed(object).equals(own(object))).toBe(true)
    }
  })

  test('<ConstructionReveal> stages it on the canvas frame clock', async () => {
    const [levelId] = loadLevels()
    renderer = await create(
      <>
        <LevelChildren levelId={levelId!} />
        <GeometrySystem />
        <ConstructionReveal reveals={(commit) => commit.author === 'agent'} />
      </>,
    )
    await frame(0)
    const wall = make(Wall)
    await agentWrites(() => useScene.getState().createNode(wall, levelId))
    expect(root(wall.id)).toBeUndefined()

    await frames(1500)
    expect(root(wall.id)).toBeDefined()
    expect(isNodeRevealing(wall.id)).toBe(false)
  })

  test('scales a slab in from its own centre, not the level origin', async () => {
    const [levelId] = loadLevels()
    await mount([levelId!])
    start()
    const slab = make(Slab)
    await agentWrites(() => useScene.getState().createNode(slab, levelId))

    let checked = false
    while (now < 2000 && !checked) {
      await frame()
      const object = root(slab.id)
      if (!object?.children.length) continue
      const matrix = composed(object)
      const s = matrix.elements[0]!
      if (s <= 0.05 || s >= 0.95) continue
      // The footprint's centre (2, 2) stays put while the slab grows.
      const centre = { x: 2, z: 2 }
      expect(s * centre.x + matrix.elements[12]!).toBeCloseTo(centre.x)
      expect(s * centre.z + matrix.elements[14]!).toBeCloseTo(centre.z)
      checked = true
    }
    expect(checked).toBe(true)
  })

  test('announces each (phase, level) once, not each node', async () => {
    const levelIds = loadLevels(2)
    await mount(levelIds)
    start()
    const events: RevealPhaseEvent[] = []
    const stop = subscribeRevealPhases((event) => events.push(event))
    try {
      await agentWrites(() =>
        useScene
          .getState()
          .createNodes(
            levelIds.flatMap((levelId) => [
              ...Array.from({ length: 6 }, () => ({ node: make(Wall), parentId: levelId })),
              ...Array.from({ length: 4 }, () => ({ node: make(Item), parentId: levelId })),
            ]),
          ),
      )
      await frames(REVEAL_TIMING.capMs + 500)
    } finally {
      stop()
    }
    expect(events).toEqual([
      { phase: 'structure', levelId: levelIds[0]! },
      { phase: 'structure', levelId: levelIds[1]! },
      { phase: 'furnishing', levelId: levelIds[0]! },
      { phase: 'furnishing', levelId: levelIds[1]! },
    ])
  })
})

// Victor run 11: one build made 1,545 walls. A wall builds once its reveal mounts it, a few each
// frame, so the queue fell behind the reveal; the walls it reached after the build timeout had
// risen while empty and appeared at full height.
describe('a long build queue', () => {
  test('every wall rises once it is built, however long the queue', async () => {
    const [levelId] = loadLevels()
    await mount([levelId!])
    start()
    const walls = Array.from({ length: 60 }, () => make(QueuedWall))
    await agentWrites(() =>
      useScene.getState().createNodes(walls.map((node) => ({ node, parentId: levelId! }))),
    )
    const queue: string[] = []
    const rose = new Set<string>()
    for (let step = 0; step < 400 && rose.size < walls.length; step += 1) {
      for (const wall of walls) {
        const object = root(wall.id)
        if (object && !reached.has(wall.id) && !queue.includes(wall.id)) queue.push(wall.id)
        const scale = object ? yScale(object) : 0
        if (object?.children.length && scale > 0.05 && scale < 0.95) rose.add(wall.id)
      }
      // The system reaches one wall every 200 ms; the others wait, unbuilt.
      const next = step % 4 === 0 ? queue.shift() : undefined
      if (next) reached.add(next)
      await act(async () => {
        for (const id of next ? [next, ...queue] : queue)
          useScene.getState().markDirty(id as AnyNodeId)
      })
      await frame(50)
    }
    expect(rose.size).toBe(walls.length)
  })
})

describe('a node starts when it moves, not when it is let in', () => {
  test('its start is said at its first move, so a card and the camera do not run ahead of a slow build', async () => {
    const [levelId] = loadLevels()
    await mount([levelId!])
    start()
    const [first, second] = [make(QueuedWall), make(QueuedWall)]
    reached.add(first.id)
    await agentWrites(() =>
      useScene
        .getState()
        .createNodes([first, second].map((node) => ({ node, parentId: levelId! }))),
    )
    const events: RevealEvent[] = []
    const stop = subscribeRevealEvents((event) => events.push(event))
    const starts = (id: string) =>
      events.filter((event) => event.type === 'node-start' && event.id === id)
    // The second wall's turn comes, and its geometry has not been built: it stays unsaid.
    for (let elapsed = 0; elapsed < 1500; elapsed += 50) {
      await act(async () => useScene.getState().markDirty(second.id as AnyNodeId))
      await frame(50)
    }
    expect(starts(first.id)).toHaveLength(1)
    expect(starts(second.id)).toHaveLength(0)
    // It is built: it starts, and it is moving on that very frame or the next.
    reached.add(second.id)
    let startedAt = -1
    let movingAt = -1
    for (let elapsed = 0; elapsed < 1500 && movingAt < 0; elapsed += 20) {
      await act(async () => useScene.getState().markDirty(second.id as AnyNodeId))
      await frame(20)
      const object = root(second.id)
      if (startedAt < 0 && starts(second.id).length > 0) startedAt = now
      if (object?.children.length && yScale(object) > 0.02) movingAt = now
    }
    stop()
    expect(startedAt).toBeGreaterThan(0)
    expect(movingAt - startedAt).toBeLessThanOrEqual(40)
  })
})

describe('always instant', () => {
  test("a person's own edit mounts at once", async () => {
    const [levelId] = loadLevels()
    await mount([levelId!])
    start()
    const wall = make(Wall)
    await act(async () => useScene.getState().createNode(wall, levelId))

    expect(root(wall.id)).toBeDefined()
    expect(isNodeRevealing(wall.id)).toBe(false)
    await frame()
    expect(composed(root(wall.id)!).equals(own(root(wall.id)!))).toBe(true)
  })

  test('a load or a hydration shows everything, and ends a reveal under way', async () => {
    const [levelId] = loadLevels()
    await mount([levelId!])
    start()
    const building = make(Wall)
    await agentWrites(() => useScene.getState().createNode(building, levelId))
    expect(isNodeRevealing(building.id)).toBe(true)

    const loaded = make(Wall)
    const { nodes, rootNodeIds, collections, materials, installedPlugins } = useScene.getState()
    const level = nodes[levelId!] as AnyNode & { children: string[] }
    await agentWrites(() =>
      applySceneSnapshot(
        {
          nodes: {
            ...nodes,
            [loaded.id]: { ...loaded, parentId: levelId } as AnyNode,
            [levelId!]: { ...level, children: [...level.children, loaded.id] } as AnyNode,
          },
          rootNodeIds,
          collections,
          materials,
          installedPlugins,
        },
        { origin: 'load' },
      ),
    )

    expect(root(loaded.id)).toBeDefined()
    expect(root(building.id)).toBeDefined()
    expect(isNodeRevealing(building.id)).toBe(false)
  })

  test('an undo during a reveal ends it without throwing on the removed nodes', async () => {
    const [levelId] = loadLevels()
    await mount([levelId!])
    start()
    const walls = [make(Wall), make(Wall)]
    const items = [make(Item), make(Item)]
    await agentWrites(() =>
      useScene
        .getState()
        .createNodes(walls.map((node) => ({ node, parentId: levelId as AnyNodeId }))),
    )
    await agentWrites(() =>
      useScene
        .getState()
        .createNodes(items.map((node) => ({ node, parentId: levelId as AnyNodeId }))),
    )
    while (!(root(walls[0]!.id)?.children.length && yScale(root(walls[0]!.id)!) < 0.9))
      await frame()

    await act(async () => useScene.temporal.getState().undo())
    await frames(200)

    expect(useScene.getState().nodes[items[0]!.id]).toBeUndefined()
    for (const node of [...walls, ...items]) expect(isNodeRevealing(node.id)).toBe(false)
    for (const wall of walls) {
      const object = root(wall.id)!
      expect(composed(object).equals(own(object))).toBe(true)
    }
  })

  test('a capture or an export never sees a half-risen wall', async () => {
    const [levelId] = loadLevels()
    await mount([levelId!])
    start()
    const walls = [make(Wall), make(Wall), make(Wall)]
    await agentWrites(() =>
      useScene
        .getState()
        .createNodes(walls.map((node) => ({ node, parentId: levelId as AnyNodeId }))),
    )
    while (!(root(walls[0]!.id)?.children.length && yScale(root(walls[0]!.id)!) > 0.05)) {
      await frame()
    }
    expect(yScale(root(walls[0]!.id)!)).toBeLessThan(1)
    expect(dust.live).toBeGreaterThan(0)

    // Synchronous, like the capture itself: no frame runs before the clone.
    emitter.emit('thumbnail:before-capture', undefined)
    expect(yScale(root(walls[0]!.id)!)).toBe(1)
    expect(dust.live).toBe(0)
    await act(async () => {})
    for (const wall of walls) expect(isNodeRevealing(wall.id)).toBe(false)

    const next = make(Wall)
    await agentWrites(() => useScene.getState().createNode(next, levelId))
    expect(isNodeRevealing(next.id)).toBe(true)
    await act(async () => useViewer.getState().setExporting(true))
    expect(isNodeRevealing(next.id)).toBe(false)
    expect(root(next.id)).toBeDefined()
  })

  test('selecting a node the agent just made shows it and its host at once', async () => {
    const [levelId] = loadLevels()
    await mount([levelId!])
    start()
    const wall = make(Wall)
    const door = make(Door)
    await agentWrites(() => {
      useScene.getState().createNode(wall, levelId)
      useScene.getState().createNode(door, wall.id as AnyNodeId)
    })
    expect(root(door.id)).toBeUndefined()

    await act(async () => useViewer.getState().setSelection({ selectedIds: [door.id] } as never))
    await frame()

    expect(root(wall.id)).toBeDefined()
    expect(root(door.id)).toBeDefined()
    expect(isNodeRevealing(door.id)).toBe(false)
    expect(isNodeRevealing(wall.id)).toBe(false)
    expect(composed(root(wall.id)!).equals(own(root(wall.id)!))).toBe(true)
  })

  test('reduced motion and the read-only viewer show the build at once, one cue per phase', async () => {
    const [levelId] = loadLevels()
    await mount([levelId!])
    start({ prefersReducedMotion: () => true })
    const events: RevealPhaseEvent[] = []
    const stop = subscribeRevealPhases((event) => events.push(event))
    try {
      const walls = [make(Wall), make(Wall)]
      await agentWrites(() =>
        useScene
          .getState()
          .createNodes(walls.map((node) => ({ node, parentId: levelId as AnyNodeId }))),
      )
      for (const wall of walls) expect(root(wall.id)).toBeDefined()
      expect(events).toEqual([{ phase: 'structure', levelId: levelId! }])
      await frames(200)
      expect(dust.live).toBe(0)

      await act(async () => driver?.stop())
      start()
      useViewer.getState().setRenderContext('viewer')
      const published = make(Wall)
      await agentWrites(() => useScene.getState().createNode(published, levelId))
      expect(root(published.id)).toBeDefined()
      expect(isNodeRevealing(published.id)).toBe(false)
      await frames(200)
      expect(dust.live).toBe(0)
    } finally {
      stop()
    }
  })

  test('with no reveal mounted, an agent build mounts at once', async () => {
    const [levelId] = loadLevels()
    await mount([levelId!])
    const wall = make(Wall)
    await agentWrites(() => useScene.getState().createNode(wall, levelId))
    expect(root(wall.id)).toBeDefined()
  })
})

describe('the root stays its own', () => {
  test('a floor lift on position.y mid-rise moves the wall, and survives the settle', async () => {
    const [levelId] = loadLevels()
    await mount([levelId!])
    start()
    const wall = make(Wall)
    await agentWrites(() => useScene.getState().createNode(wall, levelId))
    while (!(root(wall.id)?.children.length && yScale(root(wall.id)!) > 0.05)) await frame()

    const object = root(wall.id)!
    object.position.y = 1.5
    expect(composed(object).elements[13]).toBeCloseTo(1.5)
    expect(yScale(object)).toBeLessThan(1)

    await frames(1000)
    expect(object.position.y).toBe(1.5)
    expect(composed(object).equals(own(object))).toBe(true)
  })

  test('a rebuild during the rise keeps the rise going', async () => {
    const [levelId] = loadLevels()
    await mount([levelId!])
    start()
    const wall = make(Wall)
    await agentWrites(() => useScene.getState().createNode(wall, levelId))
    while (!(root(wall.id)?.children.length && yScale(root(wall.id)!) > 0.05)) await frame()

    const before = yScale(root(wall.id)!)
    const builtChild = root(wall.id)!.children[0]
    await act(async () => useScene.getState().markDirty(wall.id as AnyNodeId))
    await frame()

    expect(root(wall.id)!.children[0]).not.toBe(builtChild)
    const after = yScale(root(wall.id)!)
    expect(after).toBeGreaterThan(before)
    expect(after).toBeLessThan(1)
  })
})

/** Frames until `done` holds, at most `limitMs` of them. */
async function until(done: () => boolean, limitMs = REVEAL_TIMING.capMs + 1000) {
  const stopAt = now + limitMs
  while (!done() && now < stopAt) await frame()
  expect(done()).toBe(true)
}

describe('slice two styles', () => {
  test('a post drops from its declared height, never below its seat, and keeps its own position.y', async () => {
    const [levelId] = loadLevels()
    await mount([levelId!])
    start()
    const post = make(Post)
    await agentWrites(() => useScene.getState().createNode(post, levelId))
    await until(() => Boolean(root(post.id)?.children.length) && lift(root(post.id)!) > 0)

    const object = root(post.id)!
    // A floor lift lands on the root's own position while it falls.
    object.position.y = 1.5
    const lifts: number[] = []
    while (isNodeRevealing(post.id)) {
      lifts.push(lift(object))
      await frame()
    }

    expect(Math.max(...lifts)).toBeGreaterThan(0)
    expect(Math.min(...lifts)).toBeGreaterThanOrEqual(0)
    expect(object.position.y).toBe(1.5)
    expect(composed(object).equals(own(object))).toBe(true)
  })

  test('a pane grows through its wall, and nothing is left mid-pose', async () => {
    const [levelId] = loadLevels()
    await mount([levelId!])
    start()
    const plate = make(Plate)
    const wall = make(Wall)
    const pane = make(Pane)
    await agentWrites(() => {
      useScene.getState().createNodes([
        { node: plate, parentId: levelId! },
        { node: wall, parentId: levelId! },
      ])
      useScene.getState().createNode(pane, wall.id as AnyNodeId)
    })

    let paneDepth = 1
    while (isNodeRevealing(plate.id) || isNodeRevealing(wall.id) || isNodeRevealing(pane.id)) {
      await frame()
      const paneRoot = root(pane.id)
      const elements = paneRoot?.children.length ? composed(paneRoot).elements : null
      // Once it shows (past the hidden pose before its first build), only its depth moves.
      if (elements && elements[0]! > 0.01) {
        expect(elements[0]).toBeCloseTo(1)
        expect(elements[5]).toBeCloseTo(1)
        paneDepth = Math.min(paneDepth, elements[10]!)
      }
      expect(now).toBeLessThan(REVEAL_TIMING.capMs + 1000)
    }

    expect(paneDepth).toBeLessThan(1)
    for (const node of [plate, wall, pane]) {
      expect(composed(root(node.id)!).equals(own(root(node.id)!))).toBe(true)
    }
  })
})

describe('a roof assembles from its parts', () => {
  async function buildRoof(partCount = 3) {
    const [levelId] = loadLevels()
    await mount([levelId!])
    start()
    const roof = make(Roof)
    const parts = Array.from({ length: partCount }, () => make(Part))
    await agentWrites(() => {
      useScene.getState().createNode(roof, levelId)
      useScene
        .getState()
        .createNodes(parts.map((node) => ({ node, parentId: roof.id as AnyNodeId })))
    })
    return { roof, parts }
  }

  test('its parts drop in one by one, the roof itself holds still, and it reports when whole', async () => {
    const { roof, parts } = await buildRoof()
    const changes: boolean[] = []
    const stop = subscribeRevealAssembling(roof.id, (assembling) => changes.push(assembling))
    let roofStarted = false
    const stopEvents = subscribeRevealEvents((event) => {
      if (event.type === 'start' && event.phase === 'roof') roofStarted = true
    })
    try {
      expect(isRevealAssembling(roof.id)).toBe(true)
      const mountedAt = new Map<string, number>()
      const highest = new Map<string, number>()
      while (isRevealAssembling(roof.id)) {
        await frame()
        expect(now).toBeLessThan(REVEAL_TIMING.capMs + 1000)
        const roofRoot = root(roof.id)
        if (roofRoot && !mountedAt.has(roof.id)) mountedAt.set(roof.id, now)
        // Still while its parts drop in (until the roof starts it is hidden, mounted up front).
        if (roofRoot?.children.length && roofStarted)
          expect(composed(roofRoot).equals(own(roofRoot))).toBe(true)
        for (const part of parts) {
          const partRoot = root(part.id)
          if (!partRoot) continue
          if (!mountedAt.has(part.id)) mountedAt.set(part.id, now)
          if (partRoot.children.length)
            highest.set(part.id, Math.max(highest.get(part.id) ?? 0, lift(partRoot)))
        }
      }

      const partStarts = parts.map((part) => mountedAt.get(part.id)!)
      expect(Math.min(...partStarts)).toBeGreaterThanOrEqual(mountedAt.get(roof.id)!)
      expect(new Set(partStarts).size).toBe(parts.length)
      for (const part of parts) expect(highest.get(part.id)!).toBeGreaterThan(3)
      expect(changes).toEqual([false])
      for (const node of [roof, ...parts]) {
        expect(isNodeRevealing(node.id)).toBe(false)
        expect(composed(root(node.id)!).equals(own(root(node.id)!))).toBe(true)
      }
    } finally {
      stop()
      stopEvents()
    }
  })

  test('a capture mid-assembly makes the roof whole in the same tick', async () => {
    const { roof, parts } = await buildRoof()
    await until(() => parts.some((part) => Boolean(root(part.id))))
    let whole = false
    const stop = subscribeRevealAssembling(roof.id, (assembling) => {
      whole = !assembling
    })
    try {
      emitter.emit('thumbnail:before-capture', undefined)
      expect(whole).toBe(true)
      expect(isRevealAssembling(roof.id)).toBe(false)
      for (const part of parts) expect(isNodeRevealing(part.id)).toBe(false)
    } finally {
      stop()
    }
  })

  test('selecting one part ends the whole assembly', async () => {
    const { roof, parts } = await buildRoof()
    await until(() => Boolean(root(parts[0]!.id)) || Boolean(root(parts[1]!.id)))
    const shown = parts.find((part) => root(part.id))!
    await act(async () => useViewer.getState().setSelection({ selectedIds: [shown.id] } as never))
    expect(isRevealAssembling(roof.id)).toBe(false)
    for (const node of [roof, ...parts]) expect(isNodeRevealing(node.id)).toBe(false)
  })
})

describe('a roof at the framing level is covered in place, not dropped', () => {
  async function buildGable(partCount = 2) {
    level = 'framing'
    const [levelId] = loadLevels()
    await mount([levelId!])
    start()
    const roof = make(Gable)
    const parts = Array.from({ length: partCount }, () => make(Part))
    await agentWrites(() => {
      useScene.getState().createNode(roof, levelId)
      useScene
        .getState()
        .createNodes(parts.map((node) => ({ node, parentId: roof.id as AnyNodeId })))
    })
    return { roof, parts, levelId: levelId! }
  }

  /** Runs the build a frame at a time, noting what the roof's root shows. */
  async function watch(roofId: string, until_ = 20000) {
    const lifts: number[] = []
    const levels: number[] = []
    const begun = now
    while ((isNodeRevealing(roofId) || !root(roofId)) && now - begun < until_) {
      await frame()
      const roofRoot = root(roofId)
      if (!roofRoot?.children.length) continue
      lifts.push(lift(roofRoot))
      const at = revealWipeLevelOf(roofRoot)
      if (at !== null) levels.push(at)
    }
    return { lifts, levels, took: now - begun }
  }

  test('it is staged as a covering: nothing drops, and no part is staged on its own', async () => {
    const { roof, parts } = await buildGable()
    expect(isRevealAssembling(roof.id)).toBe(false)
    const styles = new Map<string, string>()
    const stop = subscribeRevealEvents((event) => {
      if (event.type === 'node-start') styles.set(event.id, event.style)
    })
    try {
      const { lifts } = await watch(roof.id)
      expect(styles.get(roof.id)).toBe('cover')
      for (const part of parts) expect(styles.has(part.id)).toBe(false)
      expect(Math.max(...lifts)).toBe(0)
      expect(isNodeRevealing(roof.id)).toBe(false)
    } finally {
      stop()
    }
  })

  test('the covering is laid from the eave to the ridge, row after row, until the last has landed', async () => {
    const { roof } = await buildGable()
    const { levels } = await watch(roof.id)
    expect(levels.length).toBeGreaterThan(4)
    for (let i = 1; i < levels.length; i += 1)
      expect(levels[i]!).toBeGreaterThanOrEqual(levels[i - 1]!)
    // The eave is at 2.8 m and the ridge at 4.4 m: it starts low and is closed at the top.
    expect(levels[0]!).toBeLessThan(3.4)
    expect(levels.at(-1)!).toBeGreaterThanOrEqual(4.4)
    // Nothing is left dressed once it is whole.
    const roofRoot = root(roof.id)!
    expect(revealWipeLevelOf(roofRoot)).toBeNull()
    roofRoot.traverse((child) => {
      const mesh = child as Mesh
      if (mesh.isMesh) expect((mesh.material as { maskNode?: unknown }).maskNode).toBeUndefined()
    })
  })

  test('the covering moves with every frame: strictly increasing, closed at the top at the end', async () => {
    const { roof } = await buildGable()
    const { levels } = await watch(roof.id)
    expect(levels.length).toBeGreaterThan(30)
    for (let i = 1; i < levels.length; i += 1) expect(levels[i]!).toBeGreaterThan(levels[i - 1]!)
    // The ridge is at 4.4 m: the last frame it is drawn in has closed it.
    expect(levels.at(-1)!).toBeGreaterThanOrEqual(4.4)
  })

  test('it takes as long as it is big, within a floor and a ceiling', async () => {
    const range = coverRangeAt(1)
    const took: Record<string, number> = {}
    for (const [name, kind] of [
      ['porch', Porch],
      ['hip', Hip],
      ['flat', LongFlat],
    ] as const) {
      await renderer?.unmount()
      renderer = null
      await act(async () => driver?.stop())
      driver = null
      sceneRegistry.clear()
      now = 0
      level = 'framing'
      const [levelId] = loadLevels()
      await mount([levelId!])
      start()
      const roof = make(kind)
      await agentWrites(() => useScene.getState().createNode(roof, levelId))
      const { levels, took: ms } = await watch(roof.id, 60000)
      expect(levels.length).toBeGreaterThan(0)
      took[name] = ms
    }
    const near = (ms: number, want: number) => Math.abs(ms - want) <= 600
    // A 0.7 m rise is under the floor; a 5 m rise follows its size; 14 m of flat roof is capped.
    expect(near(took.porch!, range.minMs)).toBe(true)
    expect(near(took.hip!, 5.02 * range.perMeterMs)).toBe(true)
    expect(near(took.flat!, range.maxMs)).toBe(true)
    expect(took.porch!).toBeLessThan(took.hip!)
    expect(took.hip!).toBeLessThan(took.flat!)
  })

  test('it plays at the person’s animation speed', async () => {
    const took: Record<number, number> = {}
    for (const speed of [0.5, 2]) {
      await renderer?.unmount()
      renderer = null
      await act(async () => driver?.stop())
      driver = null
      sceneRegistry.clear()
      now = 0
      level = 'framing'
      const [levelId] = loadLevels()
      await mount([levelId!])
      start({ speed: () => speed })
      const roof = make(Gable)
      await agentWrites(() => useScene.getState().createNode(roof, levelId))
      const { levels, took: ms } = await watch(roof.id, 60000)
      expect(levels.length).toBeGreaterThan(0)
      took[speed] = ms
    }
    expect(took[2]!).toBeLessThan(took[0.5]! / 2.5)
  })

  test('the full level still drops the roof whole, part by part', async () => {
    level = 'full'
    const [levelId] = loadLevels()
    await mount([levelId!])
    start()
    const roof = make(Gable)
    const parts = [make(Part), make(Part)]
    await agentWrites(() => {
      useScene.getState().createNode(roof, levelId)
      useScene
        .getState()
        .createNodes(parts.map((node) => ({ node, parentId: roof.id as AnyNodeId })))
    })
    expect(isRevealAssembling(roof.id)).toBe(true)
    const highest = new Map<string, number>()
    while (isRevealAssembling(roof.id)) {
      await frame()
      expect(now).toBeLessThan(REVEAL_TIMING.capMs + 1000)
      for (const part of parts) {
        const partRoot = root(part.id)
        if (partRoot?.children.length)
          highest.set(part.id, Math.max(highest.get(part.id) ?? 0, lift(partRoot)))
      }
      expect(revealWipeLevelOf(root(roof.id) ?? new Object3D())).toBeNull()
    }
    for (const part of parts) expect(highest.get(part.id)!).toBeGreaterThan(3)
  })

  test('simple scales it in and off shows it at once: neither lays a covering', async () => {
    for (const at of ['simple', 'off'] as const) {
      await renderer?.unmount()
      renderer = null
      await act(async () => driver?.stop())
      driver = null
      sceneRegistry.clear()
      now = 0
      level = at
      const [levelId] = loadLevels()
      await mount([levelId!])
      start()
      const roof = make(Gable)
      await agentWrites(() => useScene.getState().createNode(roof, levelId))
      for (let i = 0; i < 80; i += 1) {
        await frame()
        const roofRoot = root(roof.id)
        if (roofRoot) expect(revealWipeLevelOf(roofRoot)).toBeNull()
      }
    }
  })

  test('an undo lifts the covering off from the ridge, then the bare node is gone', async () => {
    const { roof } = await buildGable()
    await watch(roof.id)
    const roofRoot = root(roof.id)!
    let result: RetractResult | null = null
    await act(async () => {
      retractNodes([roof.id]).then((value) => {
        result = value
      })
    })
    const levels: number[] = []
    const begun = now
    while (!result && now < begun + 8000) {
      await frame(20)
      const at = revealWipeLevelOf(roofRoot)
      if (at !== null) levels.push(at)
      // It never lifts off whole: only its covering goes, then the bare node.
      if (yScale(roofRoot) > 0.5) expect(lift(roofRoot)).toBe(0)
    }
    expect(result).not.toBeNull()
    expect(yScale(roofRoot)).toBeLessThan(0.01)
    expect(levels.length).toBeGreaterThan(10)
    // It lifts continuously from the ridge: every frame is lower than the one before.
    for (let i = 1; i < levels.length; i += 1) expect(levels[i]!).toBeLessThan(levels[i - 1]!)
    expect(levels[0]!).toBeGreaterThan(4)
    expect(levels.at(-1)!).toBeLessThan(3.4)
  })
})

describe('the animation level', () => {
  test('off shows the build at once, with no dust', async () => {
    level = 'off'
    const [levelId] = loadLevels()
    await mount([levelId!])
    start()
    const post = make(Post)
    const wall = make(Wall)
    await agentWrites(() =>
      useScene.getState().createNodes([
        { node: post, parentId: levelId! },
        { node: wall, parentId: levelId! },
      ]),
    )
    expect(root(post.id)).toBeDefined()
    expect(root(wall.id)).toBeDefined()
    expect(isNodeRevealing(post.id)).toBe(false)
    await frames(300)
    expect(dust.live).toBe(0)
    expect(lift(root(post.id)!)).toBe(0)
  })

  test('simple keeps the scattered stagger with rise and scale only: no fall, no dust, no parts', async () => {
    level = 'simple'
    const [levelId] = loadLevels()
    await mount([levelId!])
    start()
    const post = make(Post)
    const wall = make(Wall)
    const roof = make(Roof)
    const part = make(Part)
    await agentWrites(() => {
      useScene.getState().createNodes([
        { node: post, parentId: levelId! },
        { node: wall, parentId: levelId! },
        { node: roof, parentId: levelId! },
      ])
      useScene.getState().createNode(part, roof.id as AnyNodeId)
    })
    expect(root(post.id)).toBeUndefined()
    expect(isRevealAssembling(roof.id)).toBe(false)

    let grew = false
    while (isNodeRevealing(post.id) || isNodeRevealing(wall.id) || isNodeRevealing(roof.id)) {
      await frame()
      expect(now).toBeLessThan(REVEAL_TIMING.capMs + 1000)
      const postRoot = root(post.id)
      if (postRoot?.children.length) {
        expect(lift(postRoot)).toBeCloseTo(0, 9)
        if (composed(postRoot).elements[0]! < 0.95) grew = true
      }
      // The part shows with its roof, not after it.
      if (root(roof.id)) expect(isNodeRevealing(part.id)).toBe(false)
      expect(dust.live).toBe(0)
    }
    expect(grew).toBe(true)
  })

  test('framing plays like full in the viewer: the fall and the dust', async () => {
    level = 'framing'
    const [levelId] = loadLevels()
    await mount([levelId!])
    start()
    const post = make(Post)
    await agentWrites(() => useScene.getState().createNode(post, levelId))
    let highest = 0
    while (isNodeRevealing(post.id)) {
      await frame()
      expect(now).toBeLessThan(5000)
      const postRoot = root(post.id)
      if (postRoot?.children.length) highest = Math.max(highest, lift(postRoot))
    }
    expect(highest).toBeGreaterThan(3)
    expect(dust.live).toBeGreaterThan(0)
  })

  test('turning it off mid-build finishes the build', async () => {
    const [levelId] = loadLevels()
    await mount([levelId!])
    start()
    const walls = [make(Wall), make(Wall), make(Wall)]
    await agentWrites(() =>
      useScene
        .getState()
        .createNodes(walls.map((node) => ({ node, parentId: levelId as AnyNodeId }))),
    )
    await frame()
    level = 'off'
    await frame()
    for (const wall of walls) {
      expect(isNodeRevealing(wall.id)).toBe(false)
      expect(root(wall.id)).toBeDefined()
    }
    expect(dust.live).toBe(0)
  })
})

describe('the plan view reads the same reveal', () => {
  test('each node waits, then grows from 0 to 1 on the reveal clock, then is done', async () => {
    const [levelId] = loadLevels()
    await mount([levelId!])
    start()
    const wall = make(Wall)
    await agentWrites(() => useScene.getState().createNode(wall, levelId))
    expect(getRevealPlanState(wall.id)).toEqual({ style: 'rise', progress: 0 })

    let ticks = 0
    const stop = subscribeRevealTicks(() => {
      ticks += 1
    })
    try {
      const progress: number[] = []
      while (getRevealPlanState(wall.id)) {
        progress.push(getRevealPlanState(wall.id)!.progress)
        await frame()
        expect(now).toBeLessThan(5000)
      }
      expect(progress.some((value) => value > 0 && value < 1)).toBe(true)
      for (let index = 1; index < progress.length; index += 1) {
        expect(progress[index]!).toBeGreaterThanOrEqual(progress[index - 1]!)
      }
      expect(ticks).toBeGreaterThan(5)
      const settled = ticks
      await frames(200)
      expect(ticks).toBe(settled)
    } finally {
      stop()
    }
    expect(getRevealPlanState(make(Wall).id)).toBeNull()
  })

  test('<ConstructionReveal> keeps its clock while the canvas is paused, as when only the plan shows', async () => {
    const [levelId] = loadLevels()
    renderer = await create(
      <>
        <LevelChildren levelId={levelId!} />
        <ConstructionReveal reveals={(commit) => commit.author === 'agent'} />
      </>,
    )
    const queued: FrameRequestCallback[] = []
    const previousRequest = globalThis.requestAnimationFrame
    const previousCancel = globalThis.cancelAnimationFrame
    globalThis.requestAnimationFrame = (callback) => queued.push(callback)
    globalThis.cancelAnimationFrame = () => {}
    try {
      await act(async () => useViewer.setState({ renderPaused: true } as never))
      const wall = make(Wall)
      await agentWrites(() => useScene.getState().createNode(wall, levelId))
      expect(root(wall.id)).toBeUndefined()

      let clock = 0
      for (let step = 0; step < 100 && !root(wall.id); step += 1) {
        clock += 16
        const due = queued.splice(0)
        await act(async () => {
          for (const callback of due) callback(clock)
        })
      }
      expect(root(wall.id)).toBeDefined()
    } finally {
      globalThis.requestAnimationFrame = previousRequest
      globalThis.cancelAnimationFrame = previousCancel
    }
  })
})

describe('the nodes playing are named for the cutaway', () => {
  test('a wall is listed while it moves in, and not before or after', async () => {
    const levelIds = loadLevels(1)
    await mount(levelIds)
    start()
    const wall = make(Wall)
    await agentWrites(() => useScene.getState().createNode(wall, levelIds[0]!))
    await frame()
    await until(() => useViewer.getState().nodesRevealing.includes(wall.id), 6000)
    expect(useViewer.getState().wallMode).not.toBe('down')
    await until(() => !isNodeRevealing(wall.id), 9000)
    expect(useViewer.getState().nodesRevealing).toEqual([])
  })

  test('the person’s wall mode is not written by a build', async () => {
    const levelIds = loadLevels(1)
    await mount(levelIds)
    useViewer.getState().setWallMode('cutaway')
    start()
    const wall = make(Wall)
    await agentWrites(() => useScene.getState().createNode(wall, levelIds[0]!))
    await until(() => useViewer.getState().nodesRevealing.includes(wall.id), 6000)
    expect(useViewer.getState().wallMode).toBe('cutaway')
    await until(() => !isNodeRevealing(wall.id), 9000)
    expect(useViewer.getState().wallMode).toBe('cutaway')
  })
})

describe('the level the work is on shows while it plays', () => {
  const GROUND_ONLY = (levelIds: AnyNodeId[]) =>
    useViewer.setState({
      hideLevelsAboveSelection: true,
      selection: { ...useViewer.getState().selection, levelId: levelIds[0]! },
    } as never)

  test('a wall built above the selected level is revealed, and its level is on show meanwhile', async () => {
    const levelIds = loadLevels(2)
    await mount(levelIds)
    GROUND_ONLY(levelIds)
    start()
    const below = make(Wall)
    const above = make(Wall)
    await agentWrites(() =>
      useScene.getState().createNodes([
        { node: above, parentId: levelIds[1]! },
        { node: below, parentId: levelIds[0]! },
      ]),
    )
    await frame()
    expect(isNodeRevealing(above.id)).toBe(true)
    expect(isNodeRevealing(below.id)).toBe(true)
    expect(useViewer.getState().levelsRevealing).toContain(levelIds[1]!)

    await until(() => Boolean(root(above.id)) && hasRevealPose(root(above.id)!))
    await until(() => !isNodeRevealing(above.id) && !isNodeRevealing(below.id), 9000)
    expect(composed(root(above.id)!).equals(own(root(above.id)!))).toBe(true)
    expect(useViewer.getState().levelsRevealing).toEqual([])
  })

  test('the solo view of the ground floor does not hide a storey being built', async () => {
    const levelIds = loadLevels(2)
    await mount(levelIds)
    useViewer.setState({
      levelMode: 'solo',
      selection: { ...useViewer.getState().selection, levelId: levelIds[0]! },
    } as never)
    start()
    const above = make(Wall)
    await agentWrites(() => useScene.getState().createNode(above, levelIds[1]!))
    await frame()
    expect(isNodeRevealing(above.id)).toBe(true)
    expect(useViewer.getState().levelsRevealing).toEqual([levelIds[1]!])
  })

  test('a level the author hid still shows its build at once and holds no slot', async () => {
    const levelIds = loadLevels(2)
    await mount(levelIds)
    useScene.getState().updateNode(levelIds[1]!, { visible: false } as never)
    start()
    const hidden = make(Wall)
    const seen = make(Wall)
    await agentWrites(() =>
      useScene.getState().createNodes([
        { node: hidden, parentId: levelIds[1]! },
        { node: seen, parentId: levelIds[0]! },
      ]),
    )
    await frame()
    expect(root(hidden.id)).toBeDefined()
    expect(isNodeRevealing(hidden.id)).toBe(false)
    expect(isNodeRevealing(seen.id)).toBe(true)
    expect(useViewer.getState().levelsRevealing).not.toContain(levelIds[1]!)
  })

  test('a volume over two storeys plays on both while the person watches the ground floor', async () => {
    const levelIds = loadLevels(2)
    await mount(levelIds)
    GROUND_ONLY(levelIds)
    start()
    const walls = [make(Wall), make(Wall)]
    const upperWalls = [make(Wall), make(Wall)]
    const upperRoof = make(Roof)
    await agentWrites(() =>
      useScene
        .getState()
        .createNodes([
          ...walls.map((node) => ({ node, parentId: levelIds[0]! })),
          ...upperWalls.map((node) => ({ node, parentId: levelIds[1]! })),
          { node: upperRoof, parentId: levelIds[1]! },
        ]),
    )
    await frame()
    for (const node of [...walls, ...upperWalls, upperRoof]) {
      expect(isNodeRevealing(node.id)).toBe(true)
    }
    await until(
      () => [...walls, ...upperWalls, upperRoof].every((node) => !isNodeRevealing(node.id)),
      12000,
    )
    expect(useViewer.getState().levelsRevealing).toEqual([])
  })

  test('a stair across two storeys plays on the upper one too', async () => {
    const levelIds = loadLevels(2)
    await mount(levelIds)
    GROUND_ONLY(levelIds)
    start()
    const flight = make(Flight)
    const landing = make(Plate)
    await agentWrites(() =>
      useScene.getState().createNodes([
        { node: flight, parentId: levelIds[0]! },
        { node: landing, parentId: levelIds[1]! },
      ]),
    )
    await frame()
    expect(isNodeRevealing(flight.id)).toBe(true)
    expect(isNodeRevealing(landing.id)).toBe(true)
    expect(useViewer.getState().levelsRevealing).toEqual(
      expect.arrayContaining([levelIds[0]!, levelIds[1]!]),
    )
  })

  test("the person's later choice of level does not cut the animation short", async () => {
    const levelIds = loadLevels(2)
    await mount(levelIds)
    GROUND_ONLY(levelIds)
    start()
    const upperWalls = Array.from({ length: 4 }, () => make(Wall))
    await agentWrites(() =>
      useScene.getState().createNodes(upperWalls.map((node) => ({ node, parentId: levelIds[1]! }))),
    )
    await frames(200)
    // They look at the ground floor again, then at the upper one: the build is on show either way.
    await act(async () =>
      useViewer.setState({
        selection: { ...useViewer.getState().selection, levelId: levelIds[0]! },
      } as never),
    )
    await frame()
    expect(upperWalls.some((node) => isNodeRevealing(node.id))).toBe(true)
    expect(useViewer.getState().levelsRevealing).toEqual([levelIds[1]!])
    await until(() => upperWalls.every((node) => !isNodeRevealing(node.id)), 9000)
    for (const node of upperWalls) {
      expect(composed(root(node.id)!).equals(own(root(node.id)!))).toBe(true)
    }
  })

  test('a piece the agent moves on an upper level glides while the person watches the ground floor', async () => {
    const levelIds = loadLevels(2)
    await mount(levelIds)
    start()
    const piece = make(Movable, { position: [0, 0, 0] })
    await agentWrites(() => useScene.getState().createNode(piece, levelIds[1]!))
    await until(() => !isNodeRevealing(piece.id) && root(piece.id) !== undefined, 9000)
    GROUND_ONLY(levelIds)
    await agentWrites(() =>
      useScene
        .getState()
        .updateNodes([{ id: piece.id as AnyNodeId, data: { position: [3, 0, 2] } as never }]),
    )
    await frame()
    expect(isNodeRevealing(piece.id)).toBe(true)
    expect(useViewer.getState().levelsRevealing).toEqual([levelIds[1]!])
  })

  test('an undo plays back a build on an upper level the display hides', async () => {
    const levelIds = loadLevels(2)
    await mount(levelIds)
    start()
    const above = make(Wall)
    await agentWrites(() => useScene.getState().createNode(above, levelIds[1]!))
    await until(() => !isNodeRevealing(above.id) && root(above.id) !== undefined, 9000)
    GROUND_ONLY(levelIds)
    let result: RetractResult | null = null
    await act(async () => {
      retractNodes([above.id]).then((value) => {
        result = value
      })
    })
    expect(useViewer.getState().levelsRevealing).toEqual([levelIds[1]!])
    await until(() => result !== null, 6000)
    expect((result as RetractResult | null)?.retracted).toEqual([above.id])
    expect((result as RetractResult | null)?.instant).toBe(false)
  })
})

// The owner, 15 October: a wall bent to a curve, or turned curtain, jumped to its new shape. An edit
// that changes what a node looks like plays its reveal again, quickly; any other edit stays instant.
describe('an edit that changes a picture plays again', () => {
  async function builtBeam() {
    const [levelId] = loadLevels()
    await mount([levelId!])
    start()
    const beam = make(Beam)
    await agentWrites(() => useScene.getState().createNode(beam, levelId))
    await until(() => !isNodeRevealing(beam.id) && root(beam.id) !== undefined, 9000)
    return { levelId: levelId!, beam }
  }
  const edit = (id: string, data: Record<string, unknown>) =>
    agentWrites(() =>
      useScene.getState().updateNodes([{ id: id as AnyNodeId, data: data as never }]),
    )

  for (const at of ['simple', 'full', 'framing'] as const) {
    test(`${at}: a changed geometry field re-rises the node and it ends at rest`, async () => {
      level = at
      const { beam } = await builtBeam()
      const events: RevealEvent[] = []
      const stop = subscribeRevealEvents((event) => events.push(event))
      await edit(beam.id, { scale: [1, 1, 1.5] })
      await frame()
      await frame()
      expect(isNodeRevealing(beam.id)).toBe(true)
      while (!(root(beam.id) && hasRevealPose(root(beam.id)!))) await frame()
      expect(yScale(root(beam.id)!)).toBeLessThan(1)
      await until(() => !isNodeRevealing(beam.id), 4000)
      stop()
      expect(composed(root(beam.id)!).equals(own(root(beam.id)!))).toBe(true)
      expect(events.some((e) => e.type === 'node-start' && e.changed === true)).toBe(true)
      expect(events.at(-1)).toMatchObject({ type: 'complete', changed: true })
    })
  }

  test('an edit of a field that is not geometry stays instant', async () => {
    const { beam } = await builtBeam()
    await edit(beam.id, { name: 'North wall' })
    await frames(100)
    expect(isNodeRevealing(beam.id)).toBe(false)
    expect(hasRevealPose(root(beam.id)!)).toBe(false)
  })

  test("a person's own edit stays instant", async () => {
    const { beam } = await builtBeam()
    await act(async () =>
      useScene
        .getState()
        .updateNodes([{ id: beam.id as AnyNodeId, data: { scale: [2, 1, 1] } as never }]),
    )
    await frames(100)
    expect(isNodeRevealing(beam.id)).toBe(false)
  })

  test('what the structure reconciler derived is not an edit, but its field-by-field writes leave the edit alone', async () => {
    const [levelId] = loadLevels()
    await mount([levelId!])
    start()
    const plate = make(Floorplate)
    await agentWrites(() => useScene.getState().createNode(plate, levelId))
    await until(() => !isNodeRevealing(plate.id) && root(plate.id) !== undefined, 9000)
    const before = useScene.getState().nodes
    const after = { ...before, [plate.id]: { ...before[plate.id as AnyNodeId]!, scale: [3, 1, 3] } }
    const commit = {
      origin: 'local',
      author: 'agent',
      before: { nodes: before },
      current: { nodes: after },
    } as unknown as SceneCommit
    expect(commitEditCandidates(commit, 'full').map((c) => c.id)).toEqual([plate.id])
    const derived = {
      ...commit,
      derivedWrites: new Map([[plate.id as AnyNodeId, new Set(['scale'])]]),
    } as SceneCommit
    expect(commitEditCandidates(derived, 'full')).toEqual([])
    const authored = {
      ...commit,
      derivedWrites: new Map([[plate.id as AnyNodeId, new Set(['name'])]]),
    } as SceneCommit
    expect(commitEditCandidates(authored, 'full').map((c) => c.id)).toEqual([plate.id])
  })

  test('a slab edit settles, as a slab came in', async () => {
    const [levelId] = loadLevels()
    await mount([levelId!])
    start()
    const plate = make(Floorplate)
    await agentWrites(() => useScene.getState().createNode(plate, levelId))
    await until(() => !isNodeRevealing(plate.id) && root(plate.id) !== undefined, 9000)
    const events: RevealEvent[] = []
    const stop = subscribeRevealEvents((event) => events.push(event))
    await edit(plate.id, { scale: [2, 1, 2] })
    await frames(300)
    stop()
    expect(events.find((e) => e.type === 'node-start')).toMatchObject({
      style: 'settle',
      changed: true,
    })
  })

  test('it plays at the person’s animation speed', async () => {
    const took: Record<string, number> = {}
    for (const speed of [0.5, 2]) {
      await act(async () => driver?.stop())
      await renderer?.unmount()
      renderer = null
      sceneRegistry.clear()
      const [levelId] = loadLevels()
      await mount([levelId!])
      start({ speed: () => speed })
      const beam = make(Beam)
      await agentWrites(() => useScene.getState().createNode(beam, levelId))
      await until(() => !isNodeRevealing(beam.id) && root(beam.id) !== undefined, 20000)
      await edit(beam.id, { scale: [1, 1, 1.5] })
      const began = now
      await frame()
      await until(() => !isNodeRevealing(beam.id) && !hasRevealPose(root(beam.id)!), 8000)
      took[speed] = now - began
    }
    expect(took[2]!).toBeLessThan(took[0.5]! / 1.5)
  })

  test('many edits begin spread over the same time, not piled on its last frame', async () => {
    const [levelId] = loadLevels()
    await mount([levelId!])
    start()
    const beams = Array.from({ length: 24 }, () => make(Beam))
    await agentWrites(() =>
      useScene.getState().createNodes(beams.map((node) => ({ node, parentId: levelId }))),
    )
    await until(() => beams.every((b) => !isNodeRevealing(b.id) && root(b.id)), 30000)
    const starts: number[] = []
    const stop = subscribeRevealEvents((event) => {
      if (event.type === 'node-start') starts.push(event.atMs)
    })
    await agentWrites(() =>
      useScene
        .getState()
        .updateNodes(
          beams.map((b) => ({ id: b.id as AnyNodeId, data: { scale: [1, 1, 2] } as never })),
        ),
    )
    await until(() => beams.every((b) => !isNodeRevealing(b.id)), 12000)
    stop()
    expect(starts).toHaveLength(24)
    const span = Math.max(...starts) - Math.min(...starts)
    expect(span).toBeLessThanOrEqual(1300)
    // No frame starts more than a few: the last ones are not clamped onto one moment.
    const perMoment = new Map<number, number>()
    for (const at of starts) perMoment.set(at, (perMoment.get(at) ?? 0) + 1)
    expect(Math.max(...perMoment.values())).toBeLessThanOrEqual(3)
  })

  test('with the animation off, an edit is instant', async () => {
    level = 'off'
    const { beam } = await builtBeam()
    await edit(beam.id, { scale: [1, 1, 1.5] })
    await frames(100)
    expect(isNodeRevealing(beam.id)).toBe(false)
    expect(hasRevealPose(root(beam.id)!)).toBe(false)
  })
})

// A deletion plays the creation backwards. The node is out of the scene at once; a snapshot of its
// picture plays out, and is taken away.
describe('a deletion plays the creation backwards', () => {
  /** What stands in the scene that is not a mounted node: the snapshots. */
  const pictures = () =>
    (renderer!.scene.instance as Object3D).children.filter(
      (child) => ![...sceneRegistry.nodes.values()].includes(child) && child.children.length > 0,
    )
  const remove = (ids: string[], author: 'agent' | null = 'agent') =>
    act(async () => {
      const run = () => useScene.getState().deleteNodes(ids as AnyNodeId[])
      if (author) runAsSceneCommitAuthor(author, run)
      else run()
    })

  async function builtWalls(count: number) {
    const [levelId] = loadLevels()
    await mount([levelId!])
    start()
    const walls = Array.from({ length: count }, () => make(Wall))
    await agentWrites(() =>
      useScene.getState().createNodes(walls.map((node) => ({ node, parentId: levelId }))),
    )
    await until(() => walls.every((w) => !isNodeRevealing(w.id) && root(w.id)), 12000)
    return { levelId: levelId!, walls }
  }

  for (const at of ['simple', 'full', 'framing'] as const) {
    test(`${at}: the node is gone from the store at once and its picture plays out, then goes`, async () => {
      level = at
      const { walls } = await builtWalls(1)
      const [wall] = walls
      await remove([wall!.id])
      expect(useScene.getState().nodes[wall!.id as AnyNodeId]).toBeUndefined()
      await frame()
      expect(pictures()).toHaveLength(1)
      await frames(120)
      const picture = pictures()[0]!
      expect(hasRevealPose(picture)).toBe(true)
      await until(() => pictures().length === 0, 4000)
    })
  }

  // The owner's rule (15 Oct): a node that plays is never hidden by the cutaway.
  test('a wall the cutaway was hiding plays its deletion whole, not as its stipple, then goes', async () => {
    const [levelId] = loadLevels()
    await mount([levelId!])
    start()
    const wall = make(RealWall)
    await agentWrites(() => useScene.getState().createNode(wall, levelId))
    await until(() => !isNodeRevealing(wall.id) && Boolean(root(wall.id)), 12000)
    // The wall as the wall system leaves it in cutaway: its mesh in the stipple, stamped hidden.
    const stipple = new MeshBasicMaterial({ transparent: true, opacity: 0.2 })
    const geometry = new BoxGeometry(4, 2.5, 0.2)
    // One group over the whole mesh, as a wall's own geometry draws it: the palette covers it.
    geometry.clearGroups()
    geometry.addGroup(0, 6, 0)
    const mesh = new Mesh(geometry, [stipple, stipple, stipple])
    mesh.userData.wallHidden = true
    // ...with the visible variant it keeps for whoever draws a copy of it.
    visibleMaterialsOf.set(mesh, [new MeshBasicMaterial()])
    root(wall.id)!.parent!.add(mesh)
    sceneRegistry.nodes.set(wall.id, mesh)
    useViewer.setState({ wallMode: 'cutaway' })
    const copies = () => {
      const found: Mesh[] = []
      ;(renderer!.scene.instance as Object3D).traverse((object) => {
        const candidate = object as Mesh
        if (candidate.isMesh && candidate !== mesh && candidate.userData.wallHidden === true)
          found.push(candidate)
      })
      return found
    }
    await remove([wall.id])
    await frame()
    const [copy] = copies()
    expect(copy).toBeDefined()
    const worn = copy!.material
    expect(Array.isArray(worn) ? worn[0] : worn).not.toBe(stipple)
    // It plays: the same visible variant on every frame of the reverse play, until it is taken away.
    for (let step = 0; step < 6; step += 1) {
      await frames(100)
      if (!copies().includes(copy!)) break
      expect(copy!.material).toBe(worn)
    }
    await until(() => !copies().includes(copy!), 6000)
  })

  test('a wall the cutaway showed plays its deletion in what it wore', async () => {
    const [levelId] = loadLevels()
    await mount([levelId!])
    start()
    const wall = make(RealWall)
    await agentWrites(() => useScene.getState().createNode(wall, levelId))
    await until(() => !isNodeRevealing(wall.id) && Boolean(root(wall.id)), 12000)
    const own = new MeshBasicMaterial()
    const mesh = new Mesh(new BoxGeometry(4, 2.5, 0.2), own)
    mesh.userData.wallHidden = false
    root(wall.id)!.parent!.add(mesh)
    sceneRegistry.nodes.set(wall.id, mesh)
    useViewer.setState({ wallMode: 'cutaway' })
    await remove([wall.id])
    await frame()
    const copy: Mesh | undefined = (renderer!.scene.instance as Object3D).getObjectByProperty(
      'type',
      'Mesh',
    ) as Mesh | undefined
    const ghosts: Mesh[] = []
    ;(renderer!.scene.instance as Object3D).traverse((object) => {
      const candidate = object as Mesh
      if (candidate.isMesh && candidate !== mesh && candidate.material === own)
        ghosts.push(candidate)
    })
    expect(copy).toBeDefined()
    expect(ghosts.length).toBe(1)
  })

  test('many deletions stagger, the last built going first', async () => {
    const { walls } = await builtWalls(4)
    const events: RevealEvent[] = []
    const stop = subscribeRevealEvents((event) => events.push(event))
    await remove(walls.map((w) => w.id))
    const poses: number[] = []
    for (let step = 0; step < 100; step += 1) {
      await frame()
      poses.push(pictures().filter((p) => hasRevealPose(p)).length)
    }
    stop()
    expect(Math.max(...poses)).toBeGreaterThan(0)
    // Not all at once: some are still waiting for their turn while others are moving.
    expect(poses.some((count) => count > 0 && count < walls.length)).toBe(true)
    await until(() => pictures().length === 0, 6000)
    const retract = events.filter((e) => e.type === 'retract-start' || e.type === 'retract-end')
    expect(retract.map((e) => e.type)).toEqual(['retract-start', 'retract-end'])
  })

  test('it plays at the person’s animation speed', async () => {
    const took: Record<string, number> = {}
    for (const speed of [0.5, 2]) {
      await act(async () => driver?.stop())
      await renderer?.unmount()
      renderer = null
      sceneRegistry.clear()
      const [levelId] = loadLevels()
      await mount([levelId!])
      start({ speed: () => speed })
      const wall = make(Wall)
      await agentWrites(() => useScene.getState().createNode(wall, levelId))
      await until(() => !isNodeRevealing(wall.id) && root(wall.id) !== undefined, 20000)
      await remove([wall.id])
      const began = now
      await frame()
      await until(() => pictures().length === 0, 8000)
      took[speed] = now - began
    }
    expect(took[2]!).toBeLessThan(took[0.5]! / 1.5)
  })

  test("a person's delete plays when the host says so, and not otherwise", async () => {
    const { walls } = await builtWalls(2)
    await remove([walls[0]!.id], null)
    await frame()
    expect(pictures()).toHaveLength(0)

    await act(async () => driver?.stop())
    start({ deletes: () => true })
    await remove([walls[1]!.id], null)
    await frame()
    expect(pictures()).toHaveLength(1)
  })

  test('an undo plays its own reverse and leaves no second picture', async () => {
    const [levelId] = loadLevels()
    await mount([levelId!])
    start()
    const wall = make(Wall)
    await agentWrites(() => useScene.getState().createNode(wall, levelId))
    await until(() => !isNodeRevealing(wall.id) && root(wall.id) !== undefined, 9000)
    await act(async () => useScene.temporal.getState().undo())
    await frame()
    expect(useScene.getState().nodes[wall.id as AnyNodeId]).toBeUndefined()
    expect(pictures()).toHaveLength(0)
  })

  test('nothing plays with the animation off', async () => {
    level = 'off'
    const { walls } = await builtWalls(1)
    await remove([walls[0]!.id])
    await frame()
    expect(pictures()).toHaveLength(0)
  })

  test('a load clears what is playing', async () => {
    const { walls } = await builtWalls(1)
    await remove([walls[0]!.id])
    await frame()
    expect(pictures()).toHaveLength(1)
    await act(async () => {
      const { nodes, rootNodeIds } = useScene.getState()
      applySceneSnapshot(
        { nodes, rootNodeIds, collections: {}, materials: {}, installedPlugins: [PLUGIN_ID] },
        { origin: 'load' },
      )
    })
    expect(pictures()).toHaveLength(0)
  })

  test('the level it was on shows while its picture plays', async () => {
    const levelIds = loadLevels(2)
    await mount(levelIds)
    start()
    const wall = make(Wall)
    await agentWrites(() => useScene.getState().createNode(wall, levelIds[1]!))
    await until(() => !isNodeRevealing(wall.id) && root(wall.id) !== undefined, 9000)
    useViewer.setState({
      hideLevelsAboveSelection: true,
      selection: { ...useViewer.getState().selection, levelId: levelIds[0]! },
    } as never)
    await remove([wall.id])
    await frame()
    expect(useViewer.getState().levelsRevealing).toEqual([levelIds[1]!])
    await until(() => pictures().length === 0, 6000)
    await frame()
    expect(useViewer.getState().levelsRevealing).toEqual([])
  })

  // The owner's rule (15 Oct): a node that plays is never hidden by the cutaway; the wall a
  // departing opening stands in is no exception, though the opening is already out of the scene.
  test('the wall an opening is leaving stays in play for as long as its picture plays', async () => {
    const [levelId] = loadLevels()
    await mount([levelId!])
    start()
    const wall = make(RealWall)
    const door = make(Door)
    await agentWrites(() => useScene.getState().createNode(wall, levelId))
    await agentWrites(() => useScene.getState().createNode(door, wall.id as AnyNodeId))
    await until(
      () => !isNodeRevealing(wall.id) && !isNodeRevealing(door.id) && Boolean(root(door.id)),
      12000,
    )
    expect(useViewer.getState().nodesRevealing).toEqual([])
    await remove([door.id])
    await frame()
    expect(getRetractTurn(door.id)).not.toBeNull()
    const inPlay = () => wallsInPlay(useScene.getState().nodes, useViewer.getState().nodesRevealing)
    expect(inPlay().has(wall.id)).toBe(true)
    await until(() => getRetractTurn(door.id) === null, 6000)
    await frame()
    expect(useViewer.getState().nodesRevealing).toEqual([])
    expect(inPlay().size).toBe(0)
  })
})

// Deleting a room or a whole floor takes it apart: every node it removes plays its build backwards,
// room by room and floor by floor, the furniture first and the slab last.
describe('deleting a floor or a room deconstructs it', () => {
  const pictures = () =>
    (renderer!.scene.instance as Object3D).children.filter(
      (child) => ![...sceneRegistry.nodes.values()].includes(child) && child.children.length > 0,
    )

  /** A floor: its slab, walls with a pane in the first, and crates. */
  const floor = (levelId: AnyNodeId) => {
    const slab = make(Slab)
    const walls = [make(Wall), make(Wall)]
    const pane = make(Pane)
    const crates = [make(Crate), make(Crate)]
    return {
      slab,
      walls,
      pane,
      crates,
      levelId,
      all: [slab, ...walls, pane, ...crates],
      create: () => {
        const store = useScene.getState()
        store.createNodes([
          { node: slab, parentId: levelId },
          ...walls.map((node) => ({ node, parentId: levelId })),
          ...crates.map((node) => ({ node, parentId: levelId })),
        ])
        store.createNode(pane, walls[0]!.id as AnyNodeId)
      },
    }
  }

  async function builtFloors(count: number) {
    const levelIds = loadLevels(count)
    await mount(levelIds)
    start({ deletes: () => true })
    const floors = levelIds.map((levelId) => floor(levelId))
    await agentWrites(() => {
      for (const one of floors) one.create()
    })
    const everything = floors.flatMap((one) => one.all)
    await until(() => everything.every((node) => !isNodeRevealing(node.id) && root(node.id)), 60000)
    return { levelIds, floors, everything }
  }

  const removeLevels = (ids: string[]) =>
    act(async () => {
      runAsSceneCommitAuthor('agent', () => useScene.getState().deleteNodes(ids as AnyNodeId[]))
    })

  for (const at of ['full', 'framing'] as const) {
    test(`${at}: a floor delete plays every node it removes, the furniture first and the slab last`, async () => {
      level = at
      const { floors, levelIds } = await builtFloors(1)
      const [one] = floors
      await removeLevels([levelIds[0]!])
      for (const node of one!.all)
        expect(useScene.getState().nodes[node.id as AnyNodeId]).toBeUndefined()
      const turn = (id: string) => getRetractTurn(id)
      for (const node of one!.all) expect(turn(node.id)).not.toBeNull()
      const starts = (nodes: AnyNode[]) => nodes.map((node) => turn(node.id)!.startMs)
      const furniture = Math.max(...starts(one!.crates))
      const opening = turn(one!.pane.id)!.startMs
      const walls = Math.min(...starts(one!.walls))
      const slab = turn(one!.slab.id)!.startMs
      expect(furniture).toBeLessThanOrEqual(opening)
      expect(opening).toBeLessThanOrEqual(walls)
      expect(walls).toBeLessThanOrEqual(slab)
      // They play, and then every picture is gone.
      await frame()
      expect(pictures().length).toBeGreaterThan(0)
      await until(() => pictures().length === 0, 60000)
      for (const node of one!.all) expect(getRetractTurn(node.id)).toBeNull()
    })
  }

  test('framing: two floors come apart from the top down, each floor in its own order', async () => {
    level = 'framing'
    const { floors, levelIds } = await builtFloors(2)
    await removeLevels(levelIds as string[])
    const [ground, top] = floors
    const wallStart = (one: ReturnType<typeof floor>) =>
      Math.min(...one.walls.map((wall) => getRetractTurn(wall.id)!.startMs))
    expect(wallStart(top!)).toBeLessThan(wallStart(ground!))
    for (const one of floors) {
      const furniture = Math.max(...one.crates.map((crate) => getRetractTurn(crate.id)!.startMs))
      expect(furniture).toBeLessThanOrEqual(wallStart(one))
    }
    await until(() => pictures().length === 0, 90000)
  })

  test('framing: the pictures of a deleted floor stand in their building, not in the floor that goes', async () => {
    level = 'framing'
    const building = BuildingNode.parse({ children: [] })
    const [levelId] = loadLevels()
    const levelNode = useScene.getState().nodes[levelId!] as AnyNode & { parentId: string | null }
    useScene.setState({
      nodes: {
        ...useScene.getState().nodes,
        [building.id]: { ...building, children: [levelId] } as AnyNode,
        [levelId!]: { ...levelNode, parentId: building.id } as AnyNode,
      },
    } as never)
    await mount([levelId!])
    start({ deletes: () => true })
    const one = floor(levelId!)
    await agentWrites(() => one.create())
    await until(() => one.all.every((node) => !isNodeRevealing(node.id) && root(node.id)), 60000)
    // The host's renderers register a group for the building and one for the floor that holds the roots.
    const buildingGroup = new Group()
    const levelGroup = new Group()
    buildingGroup.add(levelGroup)
    sceneRegistry.nodes.set(building.id, buildingGroup)
    sceneRegistry.nodes.set(levelId!, levelGroup)
    for (const node of one.all) levelGroup.add(root(node.id)!)
    await removeLevels([levelId!])
    await frame()
    const standing = buildingGroup.children.filter((child) => child !== levelGroup)
    expect(standing.length).toBeGreaterThan(0)
    // The floor goes: its group is taken out of the building, and the pictures are still there.
    buildingGroup.remove(levelGroup)
    await frames(200)
    expect(buildingGroup.children.length).toBeGreaterThan(0)
    await until(() => buildingGroup.children.length === 0, 60000)
  })

  test('with the animation off a floor delete is instant: nothing plays', async () => {
    level = 'off'
    const { levelIds, floors } = await builtFloors(1)
    await removeLevels([levelIds[0]!])
    await frame()
    expect(pictures()).toHaveLength(0)
    for (const node of floors[0]!.all) expect(getRetractTurn(node.id)).toBeNull()
  })

  test('a big floor is planned in one frame’s budget', async () => {
    level = 'framing'
    const [levelId] = loadLevels()
    await mount([levelId!])
    start({ deletes: () => true })
    const walls = Array.from({ length: 120 }, () => make(Wall))
    const crates = Array.from({ length: 120 }, () => make(Crate))
    await agentWrites(() =>
      useScene
        .getState()
        .createNodes([...walls, ...crates].map((node) => ({ node, parentId: levelId }))),
    )
    await until(
      () => [...walls, ...crates].every((node) => !isNodeRevealing(node.id) && root(node.id)),
      120000,
    )
    const began = performance.now()
    await removeLevels([levelId!])
    const planned = performance.now() - began
    expect(getRetractTurn(walls[0]!.id)).not.toBeNull()
    // Planning 240 snapshots in the commit itself: well under what would hitch a frame twice over.
    expect(planned).toBeLessThan(120)
    const ends = [...walls, ...crates].map((node) => {
      const turn = getRetractTurn(node.id)!
      return turn.startMs + turn.durationMs
    })
    // However many pieces, the whole play ends within the cap of the reverse plan.
    expect(Math.max(...ends) - now).toBeLessThanOrEqual(14_000 + 1000)
  })
})

// Deleting a storey takes it apart where it stands. What stands above it (the roof level, the roofs
// and everything on them) keeps its place meanwhile and comes down onto what is below in one eased
// move once the floor has gone, so the roof is never drawn inside the storey that is coming apart.
describe('what stands above a floor being deleted waits for it', () => {
  const FLOOR_HEIGHT = 3

  /** A two-storey house with a roof level on top: the stack create_roof leaves for a gable roof. */
  async function houseWithRoof({ speed = 1, reducedMotion = false } = {}) {
    const building = BuildingNode.parse({ children: [] })
    const levels = [0, 1, 2].map((index) =>
      LevelNode.parse({ level: index, height: FLOOR_HEIGHT, parentId: building.id, children: [] }),
    )
    const nodes: Record<string, AnyNode> = {
      [building.id]: { ...building, children: levels.map((one) => one.id) } as AnyNode,
    }
    for (const one of levels) nodes[one.id] = one as AnyNode
    useScene.getState().setScene(nodes, [building.id] as AnyNodeId[], {
      installedPlugins: [PLUGIN_ID],
      hasExplicitPluginInstallState: true,
    })
    clearSceneHistory()
    const [ground, upper, roofLevel] = levels.map((one) => one.id as AnyNodeId) as [
      AnyNodeId,
      AnyNodeId,
      AnyNodeId,
    ]
    const objects = new Map<string, Object3D>()
    const register = (id: string) => {
      const object = new Object3D()
      objects.set(id, object)
      sceneRegistry.nodes.set(id as AnyNodeId, object)
      sceneRegistry.byType.level!.add(id as AnyNodeId)
      return object
    }
    for (const id of [ground, upper, roofLevel]) register(id)
    const roof = make(Gable)
    useScene.getState().createNode(roof, roofLevel)
    renderer = await create(
      <>
        {[ground, upper, roofLevel].map((levelId) => (
          <LevelChildren key={levelId} levelId={levelId} />
        ))}
        <GeometrySystem />
        <LevelSystem />
      </>,
    )
    await frame(0)
    // The roof's picture stands in its level's object, as the host's renderer mounts it.
    objects.get(roofLevel)!.add(root(roof.id)!)
    start({ deletes: () => true, speed: () => speed, prefersReducedMotion: () => reducedMotion })
    const floors = [ground, upper].map((levelId) => {
      const slab = make(Slab)
      const walls = [make(Wall), make(Wall)]
      const crates = [make(Crate), make(Crate)]
      return { levelId, slab, walls, crates, all: [slab, ...walls, ...crates] }
    })
    await agentWrites(() => {
      for (const one of floors)
        useScene.getState().createNodes(
          [one.slab, ...one.walls, ...one.crates].map((node) => ({
            node,
            parentId: one.levelId,
          })),
        )
    })
    const everything = floors.flatMap((one) => one.all)
    await until(() => everything.every((node) => !isNodeRevealing(node.id) && root(node.id)), 60000)
    await frames(100)
    const y = (id: AnyNodeId) => objects.get(id)!.position.y
    const dismantling = () => floors[1]!.all.some((node) => getRetractTurn(node.id) !== null)
    /** The upper floor goes: its object leaves the registry as its renderer unmounts. */
    const deleteUpper = async () => {
      await removeLevel(upper)
      sceneRegistry.nodes.delete(upper)
      sceneRegistry.byType.level!.delete(upper)
    }
    return {
      ground,
      upper,
      roofLevel,
      roof,
      floors,
      objects,
      register,
      y,
      dismantling,
      deleteUpper,
    }
  }

  const removeLevel = (id: AnyNodeId) =>
    act(async () => {
      runAsSceneCommitAuthor('agent', () => useScene.getState().deleteNodes([id]))
    })

  /** Frames until the dismantle has ended and the roof level is at rest; what each frame showed. */
  async function playOut(house: Awaited<ReturnType<typeof houseWithRoof>>, targetY: number) {
    const trace: { roofY: number; dismantling: boolean; held: boolean }[] = []
    for (let elapsed = 0; elapsed < 60000; elapsed += 20) {
      await frame()
      trace.push({
        roofY: house.y(house.roofLevel),
        dismantling: house.dismantling(),
        held: heldLevelY(house.roofLevel) !== undefined,
      })
      if (!house.dismantling() && Math.abs(house.y(house.roofLevel) - targetY) < 1e-4) break
    }
    await frames(400)
    return trace
  }

  for (const at of ['full', 'framing'] as const) {
    test(`${at}: the roof level keeps its place while the floor comes apart, then eases down onto what is below`, async () => {
      level = at
      const house = await houseWithRoof()
      expect(house.y(house.roofLevel)).toBeCloseTo(2 * FLOOR_HEIGHT, 6)
      await house.deleteUpper()
      expect(house.dismantling()).toBe(true)
      // The store already stacks the roof level on the ground floor; what is drawn waits.
      expect(getLevelElevations(useScene.getState().nodes).get(house.roofLevel)?.baseY).toBeCloseTo(
        FLOOR_HEIGHT,
        6,
      )
      expect(heldLevelY(house.roofLevel)).toBeCloseTo(2 * FLOOR_HEIGHT, 6)
      await frame()
      expect(useViewer.getState().levelsRevealing).toContain(house.roofLevel)

      const trace = await playOut(house, FLOOR_HEIGHT)
      const lowering = trace.findIndex((sample) => sample.roofY < 2 * FLOOR_HEIGHT - 1e-9)
      expect(lowering).toBeGreaterThan(0)
      // Nothing overlaps: every frame the floor is in pieces, the roof is where it stood.
      for (const sample of trace.slice(0, lowering)) expect(sample.roofY).toBeCloseTo(6, 9)
      for (const sample of trace.filter((one) => one.dismantling))
        expect(sample.roofY).toBeCloseTo(6, 9)
      expect(trace.slice(lowering).every((sample) => !sample.dismantling)).toBe(true)
      // One eased move: down only, ending exactly on the stack's elevation, slower at both ends.
      const down = trace.slice(lowering - 1).map((sample) => sample.roofY)
      for (let i = 1; i < down.length; i += 1)
        expect(down[i]!).toBeLessThanOrEqual(down[i - 1]! + 1e-9)
      expect(down.at(-1)!).toBeCloseTo(FLOOR_HEIGHT, 3)
      const steps = down.slice(1).map((value, i) => down[i]! - value)
      expect(steps[0]!).toBeLessThan(Math.max(...steps) / 2)
      expect(steps.at(-2)!).toBeLessThan(Math.max(...steps) / 2)
      // It takes the rewind's own drop time at this level.
      const dropMs = (at === 'framing' ? lazyRetractTimingAt(1) : retractTimingAt(1)).durationMs
        .drop
      const lowered = trace.filter((sample) => sample.held && sample.roofY < 6 - 1e-9).length
      expect(lowered * 20).toBeGreaterThanOrEqual(dropMs - 40)
      expect(lowered * 20).toBeLessThanOrEqual(dropMs + 40)
      // The hold is gone, and so is the level's reason to show.
      expect(heldLevelY(house.roofLevel)).toBeUndefined()
      await frame()
      expect(useViewer.getState().levelsRevealing).toEqual([])
      expect(house.y(house.roofLevel)).toBeCloseTo(FLOOR_HEIGHT, 6)
      // What is below does not move, and the roof's picture is still in its level.
      expect(house.y(house.ground)).toBe(0)
      expect(root(house.roof.id)!.parent).toBe(house.objects.get(house.roofLevel)!)
    })
  }

  test('the drop follows the animation speed', async () => {
    level = 'framing'
    const took: Record<number, number> = {}
    for (const speed of [1, 2]) {
      const house = await houseWithRoof({ speed })
      await house.deleteUpper()
      const trace = await playOut(house, FLOOR_HEIGHT)
      took[speed] = trace.filter((sample) => sample.held && sample.roofY < 6 - 1e-9).length
      await act(async () => driver?.stop())
      await renderer?.unmount()
      renderer = null
      sceneRegistry.clear()
    }
    expect(took[2]!).toBeLessThan(took[1]! * 0.65)
  })

  test('with the animation off, or motion reduced, nothing is held: the stack settles as it always did', async () => {
    for (const mode of ['off', 'reduced'] as const) {
      level = mode === 'off' ? 'off' : 'framing'
      const house = await houseWithRoof({ reducedMotion: mode === 'reduced' })
      await house.deleteUpper()
      expect(heldLevelY(house.roofLevel)).toBeUndefined()
      await frame()
      expect(house.dismantling()).toBe(false)
      expect(useViewer.getState().levelsRevealing).toEqual([])
      expect(house.y(house.roofLevel)).toBeLessThan(2 * FLOOR_HEIGHT)
      await frames(1500)
      expect(house.y(house.roofLevel)).toBeCloseTo(FLOOR_HEIGHT, 3)
      await act(async () => driver?.stop())
      await renderer?.unmount()
      renderer = null
      sceneRegistry.clear()
    }
  })

  test('an undo mid-dismantle puts the floor back whole and the roof never moves', async () => {
    level = 'framing'
    const house = await houseWithRoof()
    await house.deleteUpper()
    await frames(400)
    expect(house.dismantling()).toBe(true)
    await act(async () => useScene.temporal.getState().undo())
    const object = house.register(house.upper)
    await frame()
    expect(house.dismantling()).toBe(false)
    expect(heldLevelY(house.roofLevel)).toBeUndefined()
    expect(house.y(house.upper)).toBeCloseTo(FLOOR_HEIGHT, 6)
    expect(object.position.y).toBeCloseTo(FLOOR_HEIGHT, 6)
    for (let i = 0; i < 20; i += 1) {
      await frame()
      expect(house.y(house.roofLevel)).toBeCloseTo(2 * FLOOR_HEIGHT, 6)
    }
  })

  test('the undo of a finished deletion brings the roof up and the floor back together, never through each other', async () => {
    level = 'framing'
    const house = await houseWithRoof()
    await house.deleteUpper()
    await playOut(house, FLOOR_HEIGHT)
    expect(house.y(house.roofLevel)).toBeCloseTo(FLOOR_HEIGHT, 6)
    await act(async () => useScene.temporal.getState().undo())
    // The restored floor mounts at the origin, as every new level object does.
    house.register(house.upper)
    for (let i = 0; i < 30; i += 1) {
      await frame()
      // The floor's top never reaches the roof's base, and neither moves through the other.
      expect(house.y(house.roofLevel) - house.y(house.upper)).toBeGreaterThanOrEqual(
        FLOOR_HEIGHT - 1e-6,
      )
      expect(house.y(house.upper)).toBeCloseTo(FLOOR_HEIGHT, 6)
      expect(house.y(house.roofLevel)).toBeCloseTo(2 * FLOOR_HEIGHT, 6)
    }
  })
})

// Victor run 12: the dust showed through walls. It drew on the overlay layer, which composites on
// top of the scene with no depth test.
describe('the dust', () => {
  test('draws inside the scene pass, behind the walls in front of it', async () => {
    renderer = await create(<ConstructionDust clock={{ current: 0 }} pool={new DustPool()} />)
    const mesh = (renderer.scene.instance as Object3D).getObjectByName('construction-dust') as Mesh
    expect(mesh).toBeDefined()
    expect(mesh.layers.test(scenePassLayers())).toBe(true)
    expect(mesh.layers.isEnabled(OVERLAY_LAYER)).toBe(false)
    const material = mesh.material as { depthTest: boolean; depthWrite: boolean }
    expect(material.depthTest).toBe(true)
    // It writes no depth: the screen-space ink reads the depth buffer and must not outline it.
    expect(material.depthWrite).toBe(false)
  })

  test('draws one invisible sprite when asked to warm up, so the first puff is not the first draw', async () => {
    const pool = new DustPool()
    renderer = await create(<ConstructionDust clock={{ current: 0 }} pool={pool} />)
    const mesh = (renderer.scene.instance as Object3D).getObjectByName(
      'construction-dust',
    ) as Mesh & {
      count: number
    }
    await renderer.advanceFrames(2, 0.02)
    expect(mesh.visible).toBe(false)
    pool.requestWarm(2)
    await renderer.advanceFrames(1, 0.02)
    // Drawn (visible, one instance) with no opacity: nothing to see.
    expect(mesh.visible).toBe(true)
    expect(mesh.count).toBe(1)
    await renderer.advanceFrames(4, 0.02)
    expect(mesh.visible).toBe(false)
    expect(mesh.count).toBe(0)
  })
})

// Victor run 12: walls rose with their window holes already cut, empty until the openings phase.
// The user's pick: the wall stays whole, and each opening is cut when its own turn comes.
describe('an opening and its wall', () => {
  test('the wall leaves out an opening that waits, and rebuilds when its turn comes', async () => {
    const [levelId] = loadLevels()
    await mount([levelId!])
    start()
    const wall = make(Wall)
    const pane = make(Pane)
    await agentWrites(() => {
      useScene.getState().createNode(wall, levelId!)
      useScene.getState().createNode(pane, wall.id as AnyNodeId)
    })
    const marks: number[] = []
    const markDirty = useScene.getState().markDirty
    useScene.setState({
      markDirty: (id) => {
        if (id === wall.id) marks.push(now)
        markDirty(id)
      },
    })
    const stop = () => useScene.setState({ markDirty })
    try {
      expect(isRevealWaiting(pane.id)).toBe(true)
      let turn: number | null = null
      while (isNodeRevealing(pane.id)) {
        await frame()
        if (turn === null && !isRevealWaiting(pane.id)) turn = now
        expect(now).toBeLessThan(REVEAL_TIMING.capMs + 1000)
      }
      expect(turn).not.toBeNull()
      expect(marks).toContain(turn!)
    } finally {
      stop()
    }
  })

  test('an opening released at once still has its wall rebuilt', async () => {
    const [levelId] = loadLevels()
    await mount([levelId!])
    start()
    const wall = make(Wall)
    const pane = make(Pane)
    await agentWrites(() => {
      useScene.getState().createNode(wall, levelId!)
      useScene.getState().createNode(pane, wall.id as AnyNodeId)
    })
    expect(isRevealWaiting(pane.id)).toBe(true)
    await frame()
    useScene.getState().clearDirty(wall.id as AnyNodeId)
    await act(async () => driver?.stop())
    driver = null
    expect(isRevealWaiting(pane.id)).toBe(false)
    expect(useScene.getState().dirtyNodes.has(wall.id as AnyNodeId)).toBe(true)
  })
})

// One rhythm: the chat's step cards, the sounds and the camera that follows the build all listen to
// what the reveal says it is doing, on its own clock. A phase on a level starts when its first node
// begins, lands when its first node makes contact (a drop's impact), settles when its last is at
// rest; the build completes when nothing is left. A person who sees it at once (off, reduced
// motion) gets the same words in the same turn.
describe('what the build says it is doing', () => {
  const kinds = (events: RevealEvent[], type: RevealEvent['type']) =>
    events.filter((event) => event.type === type)
  const phaseEvents = (events: RevealEvent[], phase: string) =>
    events.filter(
      (event): event is Extract<RevealEvent, { nodeIds: readonly string[] }> =>
        'nodeIds' in event && event.phase === phase,
    )

  async function buildHouse() {
    const [levelId] = loadLevels()
    await mount([levelId!])
    start()
    const events: RevealEvent[] = []
    const stop = subscribeRevealEvents((event) => events.push(event))
    const staged = {
      slab: make(Slab),
      walls: [make(Wall), make(Wall), make(Wall)],
      post: make(Post),
      door: make(Door),
      item: make(Item),
    }
    await agentWrites(() =>
      useScene
        .getState()
        .createNodes([
          { node: staged.item, parentId: levelId },
          { node: staged.post, parentId: levelId },
          ...staged.walls.map((node) => ({ node, parentId: levelId })),
          { node: staged.slab, parentId: levelId },
        ]),
    )
    await agentWrites(() =>
      useScene.getState().createNode(staged.door, staged.walls[0]!.id as AnyNodeId),
    )
    return { levelId: levelId!, events, staged, stop }
  }

  test('each phase starts, lands and settles, with the ids it stages, and the build completes once', async () => {
    const { levelId, events, staged, stop } = await buildHouse()
    try {
      await frames(REVEAL_TIMING.capMs + 1000)
    } finally {
      stop()
    }
    const ids = {
      foundation: [staged.slab.id],
      structure: [...staged.walls.map((node) => node.id), staged.post.id],
      openings: [staged.door.id],
      furnishing: [staged.item.id],
    }
    for (const [phase, group] of Object.entries(ids)) {
      const own = phaseEvents(events, phase)
      expect(own.map((event) => event.type)).toEqual(['start', 'land', 'settle'])
      for (const event of own) {
        expect(event).toMatchObject({ phase, levelId, source: 'agent', instant: false })
        expect([...(event as { nodeIds: string[] }).nodeIds].sort()).toEqual([...group].sort())
      }
      const [begun, landed, settled] = own.map((event) => event.atMs)
      expect(begun!).toBeLessThanOrEqual(landed!)
      expect(landed!).toBeLessThanOrEqual(settled!)
    }
    const complete = kinds(events, 'complete')
    expect(complete).toHaveLength(1)
    expect(complete[0]).toMatchObject({ nodeCount: 7, source: 'agent', instant: false })
    expect(events.at(-1)).toBe(complete[0])
    const lastSettle = Math.max(...kinds(events, 'settle').map((event) => event.atMs))
    expect(complete[0]!.atMs).toBeGreaterThanOrEqual(lastSettle)
  })

  test('a drop lands at its impact, not when it starts', async () => {
    const [levelId] = loadLevels()
    await mount([levelId!])
    start()
    const events: RevealEvent[] = []
    const stop = subscribeRevealEvents((event) => events.push(event))
    try {
      await agentWrites(() => useScene.getState().createNode(make(Post), levelId))
      await frames(REVEAL_TIMING.durationMs.drop + 600)
    } finally {
      stop()
    }
    const [begun] = phaseEvents(events, 'structure')
    const landed = phaseEvents(events, 'structure').find((event) => event.type === 'land')!
    // The impact is part way through the drop: after it starts, before it has ended.
    expect(landed.atMs).toBeGreaterThan(begun!.atMs)
    expect(landed.atMs - begun!.atMs).toBeLessThan(REVEAL_TIMING.durationMs.drop)
  })

  test('every node says when it starts, in the order it starts', async () => {
    const { events, staged, stop } = await buildHouse()
    try {
      await frames(REVEAL_TIMING.capMs + 1000)
    } finally {
      stop()
    }
    const nodes = kinds(events, 'node-start') as Extract<RevealEvent, { type: 'node-start' }>[]
    expect(nodes).toHaveLength(7)
    expect(new Set(nodes.map((event) => event.id))).toEqual(
      new Set(
        [staged.slab, ...staged.walls, staged.post, staged.door, staged.item].map((n) => n.id),
      ),
    )
    expect(nodes.map((event) => event.atMs)).toEqual(
      [...nodes.map((event) => event.atMs)].sort((a, b) => a - b),
    )
    expect(nodes[0]).toMatchObject({ id: staged.slab.id, phase: 'foundation', style: 'scale' })
  })

  test('shown at once, it says all the same, in the same turn, flagged instant', async () => {
    level = 'off'
    const { events, staged, stop } = await buildHouse()
    try {
      // No frame has run: the build is on screen and the words have been said.
      for (const node of [staged.slab, ...staged.walls, staged.door, staged.item])
        expect(root(node.id)).toBeDefined()
    } finally {
      stop()
    }
    for (const phase of ['foundation', 'structure', 'openings', 'furnishing']) {
      const own = phaseEvents(events, phase)
      expect(own.map((event) => event.type)).toEqual(['start', 'land', 'settle'])
      expect(own.every((event) => (event as { instant: boolean }).instant)).toBe(true)
    }
    // Two writes, each shown the moment it is made: each one completes.
    expect(kinds(events, 'complete')).toHaveLength(2)
    expect(
      kinds(events, 'complete').every((event) => (event as { instant: boolean }).instant),
    ).toBe(true)
  })

  test('a phase cue plays once per phase and level: the phase stream is unchanged', async () => {
    const { levelId, stop } = await buildHouse()
    const starts: RevealPhaseEvent[] = []
    const stopPhases = subscribeRevealPhases((event) => starts.push(event))
    try {
      await frames(REVEAL_TIMING.capMs + 1000)
    } finally {
      stop()
      stopPhases()
    }
    // Subscribed after the writes: only what had not started yet is heard, never a land or a settle.
    for (const event of starts) expect(Object.keys(event).sort()).toEqual(['levelId', 'phase'])
    expect(starts.every((event) => event.levelId === levelId)).toBe(true)
  })
})

// The owner's feel (2026-10-08): a hair of lift before a roof piece drops; the last piece of a build
// lands with a slightly bigger beat, and the build says when.
describe('the roof pieces and the last piece to land', () => {
  test('the build says its last piece landed, once, at its impact', async () => {
    const [levelId] = loadLevels()
    await mount([levelId!])
    start()
    const events: RevealEvent[] = []
    const stop = subscribeRevealEvents((event) => events.push(event))
    const posts = Array.from({ length: 4 }, () => make(Post))
    try {
      await agentWrites(() =>
        useScene.getState().createNodes(posts.map((node) => ({ node, parentId: levelId }))),
      )
      await frames(REVEAL_TIMING.capMs + 1500)
    } finally {
      stop()
    }
    const starts = events.filter((event) => event.type === 'node-start')
    const last = starts.at(-1)!
    const finale = events.filter((event) => event.type === 'finale')
    expect(finale).toHaveLength(1)
    expect(finale[0]).toMatchObject({ id: (last as { id: string }).id, phase: 'structure' })
    // On its landing: after it began, before its drop is over.
    const fell = finale[0]!.atMs - last.atMs
    expect(fell).toBeGreaterThan(0)
    expect(fell).toBeLessThan(REVEAL_TIMING.durationMs.drop)
  })

  test('a build shown at once has no finale to land', async () => {
    level = 'off'
    const [levelId] = loadLevels()
    await mount([levelId!])
    start()
    const events: RevealEvent[] = []
    const stop = subscribeRevealEvents((event) => events.push(event))
    try {
      await agentWrites(() => useScene.getState().createNode(make(Post), levelId))
    } finally {
      stop()
    }
    expect(events.some((event) => event.type === 'finale')).toBe(false)
  })
})

// "The roof lifts so the furniture can drop in" (the owner's prototype): while a furnishing group plays,
// a roof that declares it clears for it rises out of the way and turns ghostly, so the rooms show from
// above; once the furniture has landed it seats again, and that is the build's finish.
describe('a roof out of the way of the furniture', () => {
  const meshesOf = (object: Object3D) => {
    const meshes: Mesh[] = []
    object.traverse((child) => {
      if ((child as Mesh).isMesh) meshes.push(child as Mesh)
    })
    return meshes
  }
  const opacityOf = (object: Object3D) =>
    Math.min(...meshesOf(object).map((mesh) => (mesh.material as { opacity: number }).opacity))

  async function finishedHouse() {
    const [levelId] = loadLevels()
    await mount([levelId!])
    start()
    const lid = make(Lid)
    const parts = [make(Part), make(Part)]
    await agentWrites(() => {
      useScene.getState().createNode(lid, levelId)
      useScene
        .getState()
        .createNodes(parts.map((node) => ({ node, parentId: lid.id as AnyNodeId })))
    })
    await until(() => !isRevealAssembling(lid.id) && !isNodeRevealing(lid.id))
    return { levelId: levelId!, lid }
  }

  async function furnish(levelId: AnyNodeId, count = 3) {
    const items = Array.from({ length: count }, () => make(Crate))
    await agentWrites(() =>
      useScene.getState().createNodes(items.map((node) => ({ node, parentId: levelId }))),
    )
    return items
  }

  test('it rises while the furniture lands, and seats exactly again after', async () => {
    const { levelId, lid } = await finishedHouse()
    const events: RevealEvent[] = []
    const stop = subscribeRevealEvents((event) => events.push(event))
    const items = await furnish(levelId)
    const roof = root(lid.id)!
    let highest = 0
    let upAtFirstLanding = 0
    try {
      while (now < REVEAL_TIMING.capMs * 3) {
        await frame(20)
        highest = Math.max(highest, lift(roof))
        if (
          !upAtFirstLanding &&
          events.some((event) => event.type === 'land' && event.phase === 'furnishing')
        )
          upAtFirstLanding = lift(roof)
        if (highest > 2 && lift(roof) === 0 && items.every((item) => !isNodeRevealing(item.id)))
          break
      }
    } finally {
      stop()
    }
    expect(highest).toBeGreaterThan(2.3)
    expect(highest).toBeLessThanOrEqual(2.4 + 0.05)
    // The furniture lands under a roof that is already up.
    expect(upAtFirstLanding).toBeGreaterThan(1.2)
    expect(composed(roof).equals(own(roof))).toBe(true)
    const settled = events.find((event) => event.type === 'settle' && event.phase === 'furnishing')!
    const seated = events.find((event) => event.type === 'finale')!
    // It waits for the last piece, and a beat, before it comes back: the seat is the finish.
    expect(seated).toMatchObject({ id: lid.id })
    expect(seated.atMs - settled.atMs).toBeGreaterThan(500)
    expect(events.filter((event) => event.type === 'finale')).toHaveLength(1)
  })

  test('it stays up while the furnishing goes on, and comes back once it has stopped for a while', async () => {
    const { levelId, lid } = await finishedHouse()
    const roof = root(lid.id)!
    await furnish(levelId, 2)
    // A second piece of furnishing, a second and a half after the first has landed.
    let lowest = Number.POSITIVE_INFINITY
    let wroteSecond = false
    let up = 0
    while (now < REVEAL_TIMING.capMs * 4) {
      await frame(20)
      if (lift(roof) > 2) up += 1
      if (!wroteSecond && now > 2400) {
        wroteSecond = true
        await furnish(levelId, 2)
      }
      // Between the two writes (after the first has landed) the roof is up: it never starts back down.
      if (now > 1500 && now < 3800) lowest = Math.min(lowest, lift(roof))
      if (wroteSecond && lift(roof) === 0 && up > 5) break
    }
    expect(lowest).toBeGreaterThan(2.2)
    // And it does come back, whole.
    expect(composed(roof).equals(own(roof))).toBe(true)
  })

  test('the host can bring it down now: the turn is over', async () => {
    const { levelId, lid } = await finishedHouse()
    const roof = root(lid.id)!
    const events: RevealEvent[] = []
    const stop = subscribeRevealEvents((event) => events.push(event))
    await furnish(levelId)
    while (lift(roof) < 2 && now < REVEAL_TIMING.capMs * 2) await frame(20)
    let settledAt = Number.POSITIVE_INFINITY
    while (
      !events.some((event) => event.type === 'settle' && event.phase === 'furnishing') &&
      now < REVEAL_TIMING.capMs * 2
    )
      await frame(20)
    settledAt = now
    await act(async () => seatLiftedNow())
    while (lift(roof) > 0 && now < settledAt + 3000) await frame(20)
    stop()
    // A beat after the last piece, not the hold's seconds.
    expect(lift(roof)).toBe(0)
    expect(now - settledAt).toBeLessThan(1800)
    expect(
      events
        .filter((event) => event.type === 'finale')
        .map((event) => (event as { id: string }).id),
    ).toEqual([lid.id])
  })

  test('it turns ghostly while it is up, casts no shadow, and is itself again after', async () => {
    const { levelId, lid } = await finishedHouse()
    const roof = root(lid.id)!
    const originals = meshesOf(roof).map((mesh) => ({
      mesh,
      material: mesh.material,
      cast: mesh.castShadow,
    }))
    for (const mesh of meshesOf(roof)) mesh.castShadow = true
    await furnish(levelId)
    let faintest = 1
    let shadowed = true
    while (now < REVEAL_TIMING.capMs * 3) {
      await frame(20)
      faintest = Math.min(faintest, opacityOf(roof))
      if (lift(roof) > 1.5) shadowed = shadowed && meshesOf(roof).some((mesh) => mesh.castShadow)
      if (faintest < 0.3 && lift(roof) === 0) break
    }
    expect(faintest).toBeLessThan(0.3)
    expect(shadowed).toBe(false)
    for (const { mesh, material } of originals) {
      expect(mesh.material).toBe(material)
      expect(mesh.castShadow).toBe(true)
      expect((mesh.material as { opacity: number }).opacity).toBe(1)
    }
  })

  test('only the full construction lifts it: simple and off leave the roof where it is', async () => {
    for (const mode of ['simple', 'off'] as const) {
      level = 'full'
      const { levelId, lid } = await finishedHouse()
      level = mode
      let highest = 0
      await furnish(levelId)
      for (let elapsed = 0; elapsed < 6000; elapsed += 40) {
        await frame(40)
        highest = Math.max(highest, lift(root(lid.id)!))
      }
      expect({ mode, highest }).toEqual({ mode, highest: 0 })
      await act(async () => driver?.stop())
      await renderer?.unmount()
      renderer = null
      sceneRegistry.clear()
    }
  })

  test('a capture while it is up seats it in the same tick', async () => {
    const { levelId, lid } = await finishedHouse()
    const roof = root(lid.id)!
    await furnish(levelId)
    while (lift(roof) < 1 && now < REVEAL_TIMING.capMs * 2) await frame(20)
    expect(lift(roof)).toBeGreaterThan(1)
    emitter.emit('thumbnail:before-capture', undefined)
    expect(composed(roof).equals(own(roof))).toBe(true)
    expect(opacityOf(roof)).toBe(1)
  })

  test('a roof that has not asked for it never moves for furniture', async () => {
    const [levelId] = loadLevels()
    await mount([levelId!])
    start()
    const plain = make(Roof)
    const part = make(Part)
    await agentWrites(() => {
      useScene.getState().createNode(plain, levelId)
      useScene.getState().createNode(part, plain.id as AnyNodeId)
    })
    await until(() => !isRevealAssembling(plain.id) && !isNodeRevealing(plain.id))
    await furnish(levelId!)
    let highest = 0
    for (let elapsed = 0; elapsed < 6000; elapsed += 40) {
      await frame(40)
      highest = Math.max(highest, lift(root(plain.id)!))
    }
    expect(highest).toBe(0)
  })
})

describe('an agent that moves what is already there', () => {
  /** A level with a placed piece of furniture, built and at rest. */
  async function placed(position: [number, number, number] = [0, 0, 0]) {
    const [levelId] = loadLevels()
    await mount([levelId!])
    start()
    const piece = make(Movable, { position })
    await agentWrites(() => useScene.getState().createNode(piece, levelId))
    await until(() => !isNodeRevealing(piece.id) && root(piece.id) !== undefined, 9000)
    return { levelId: levelId!, piece }
  }

  const hear = () => {
    const events: RevealEvent[] = []
    const stop = subscribeRevealEvents((event) => events.push(event))
    return { events, stop }
  }
  const move = (id: string, patch: Record<string, unknown>) => () =>
    useScene.getState().updateNode(id as AnyNodeId, patch as never)

  test('says the move: its group starts and settles with the piece that moved, and the build completes', async () => {
    const { levelId, piece } = await placed()
    const { events, stop } = hear()
    await agentWrites(move(piece.id, { position: [2, 0, 1] }))
    await frames(2500)
    stop()
    expect(events.map((event) => event.type)).toEqual([
      'start',
      'node-start',
      'land',
      'settle',
      'complete',
    ])
    const [started, nodeStart, , settled, complete] = events as [
      RevealEvent & { type: 'start' },
      RevealEvent & { type: 'node-start' },
      RevealEvent,
      RevealEvent & { type: 'settle' },
      RevealEvent & { type: 'complete' },
    ]
    expect(started).toMatchObject({
      phase: 'furnishing',
      levelId,
      nodeIds: [piece.id],
      source: 'agent',
      changed: true,
    })
    expect(nodeStart).toMatchObject({ id: piece.id, phase: 'furnishing', changed: true })
    expect(settled).toMatchObject({ nodeIds: [piece.id], changed: true })
    expect(complete).toMatchObject({ nodeCount: 1, source: 'agent', changed: true })
  })

  test('says a turn of the piece too, and each piece of a rearranged room once', async () => {
    const [levelId] = loadLevels()
    await mount([levelId!])
    start()
    const pieces = [make(Movable), make(Movable), make(Movable)]
    await agentWrites(() =>
      useScene.getState().createNodes(pieces.map((node) => ({ node, parentId: levelId }))),
    )
    await until(() => pieces.every((node) => !isNodeRevealing(node.id) && root(node.id)), 9000)
    const { events, stop } = hear()
    await agentWrites(() =>
      useScene.getState().updateNodes([
        { id: pieces[0]!.id as AnyNodeId, data: { position: [1, 0, 0] } as never },
        { id: pieces[1]!.id as AnyNodeId, data: { rotation: [0, 1.2, 0] } as never },
      ]),
    )
    await frames(3000)
    stop()
    const said = events
      .filter((event) => event.type === 'node-start')
      .map((event) => (event as { id: string }).id)
    expect(said.sort()).toEqual([pieces[0]!.id, pieces[1]!.id].sort())
    expect(events.filter((event) => event.type === 'complete')).toHaveLength(1)
  })

  test("an edit that moves nothing, and the person's own move, say nothing", async () => {
    const { piece } = await placed([1, 0, 1])
    const { events, stop } = hear()
    await agentWrites(move(piece.id, { name: 'A crate', position: [1, 0.00001, 1] }))
    await act(async () => {
      useScene.getState().updateNode(piece.id as AnyNodeId, { position: [3, 0, 3] } as never)
    })
    await frames(200)
    stop()
    expect(events).toEqual([])
  })

  test('a piece still waiting for its turn is not said to have moved', async () => {
    const [levelId] = loadLevels()
    await mount([levelId!])
    start()
    const piece = make(Movable)
    await agentWrites(() => useScene.getState().createNode(piece, levelId))
    const { events, stop } = hear()
    await agentWrites(move(piece.id, { position: [4, 0, 4] }))
    await until(() => !isNodeRevealing(piece.id) && root(piece.id) !== undefined, 9000)
    stop()
    expect(events.some((event) => (event as { changed?: boolean }).changed === true)).toBe(false)
  })

  test('a move made while a build plays is said once that build is over, not in the middle of it', async () => {
    const { levelId, piece } = await placed()
    const wall = make(Wall)
    const { events, stop } = hear()
    await agentWrites(() => useScene.getState().createNode(wall, levelId))
    await agentWrites(move(piece.id, { position: [2, 0, 2] }))
    await frames(60)
    expect(events.some((event) => (event as { changed?: boolean }).changed === true)).toBe(false)
    await until(() => !isNodeRevealing(wall.id) && root(wall.id) !== undefined, 9000)
    await frames(3000)
    stop()
    const built = events.findIndex((event) => event.type === 'complete')
    const said = events.findIndex((event) => event.type === 'node-start' && event.changed === true)
    expect(built).toBeGreaterThanOrEqual(0)
    expect(said).toBeGreaterThan(built)
    expect(events.at(-1)).toMatchObject({ type: 'complete', changed: true, nodeCount: 1 })
  })

  test('the roof lifts out of the way of a move, as it does of furniture, and comes back down after', async () => {
    const [levelId] = loadLevels()
    await mount([levelId!])
    start()
    const lid = make(Lid)
    const piece = make(Movable)
    await agentWrites(() =>
      useScene.getState().createNodes([
        { node: lid, parentId: levelId },
        { node: piece, parentId: levelId },
      ]),
    )
    await until(() => !isNodeRevealing(piece.id) && root(piece.id) !== undefined, 9000)
    // The turn that built them is over: the roof is seated.
    await act(async () => seatLiftedNow())
    await frames(3000)
    expect(lift(root(lid.id)!)).toBeLessThan(0.01)

    await agentWrites(move(piece.id, { position: [2, 0, 1] }))
    await frames(3000)
    expect(lift(root(lid.id)!)).toBeGreaterThan(2)
    // Held up a while for more to come, then it is put back.
    await frames(16_000)
    expect(lift(root(lid.id)!)).toBeLessThan(0.01)
  })

  test('the animation off says it too, as an instant change', async () => {
    const { piece } = await placed()
    level = 'off'
    const { events, stop } = hear()
    await agentWrites(move(piece.id, { position: [2, 0, 1] }))
    await frames(100)
    stop()
    expect(events.map((event) => event.type)).toEqual([
      'start',
      'node-start',
      'land',
      'settle',
      'complete',
    ])
    expect((events[3] as { instant: boolean }).instant).toBe(true)
  })
})

describe('a piece the agent moved glides from where it was', () => {
  /** What the item renderer does: the root takes the node's place. */
  const sync = (id: string) => {
    const piece = root(id)!
    const node = useScene.getState().nodes[id as AnyNodeId] as unknown as {
      position: [number, number, number]
      rotation: [number, number, number]
    }
    piece.position.set(...node.position)
    piece.rotation.y = node.rotation[1]
  }
  const at = (id: string) => {
    const matrix = composed(root(id)!)
    return { x: matrix.elements[12]!, y: matrix.elements[13]!, z: matrix.elements[14]! }
  }
  async function placedAt(position: [number, number, number], count = 1) {
    const [levelId] = loadLevels()
    await mount([levelId!])
    start()
    const pieces = Array.from({ length: count }, () => make(Movable, { position }))
    await agentWrites(() =>
      useScene.getState().createNodes(pieces.map((node) => ({ node, parentId: levelId }))),
    )
    await until(
      () => pieces.every((node) => !isNodeRevealing(node.id) && root(node.id) !== undefined),
      9000,
    )
    for (const piece of pieces) sync(piece.id)
    return { levelId: levelId!, pieces }
  }
  const hear = () => {
    const events: RevealEvent[] = []
    const stop = subscribeRevealEvents((event) => events.push(event))
    return { events, stop }
  }
  const moveAll = (moves: { id: string; position: [number, number, number] }[]) => () =>
    useScene
      .getState()
      .updateNodes(
        moves.map(({ id, position }) => ({ id: id as AnyNodeId, data: { position } as never })),
      )

  test('it is where it was the moment the move lands, travels with a hop, and rests in its new place', async () => {
    const { pieces } = await placedAt([0, 0, 0])
    const id = pieces[0]!.id
    const { events, stop } = hear()
    await agentWrites(moveAll([{ id, position: [3, 0, 2] }]))
    // The renderer has put it at its new place; the reveal still shows the old.
    sync(id)
    expect(at(id).x).toBeCloseTo(0, 5)
    expect(at(id).z).toBeCloseTo(0, 5)
    expect(events).toEqual([])

    const xs: number[] = []
    let hop = 0
    for (let step = 0; step < 90; step += 1) {
      await frame()
      xs.push(at(id).x)
      hop = Math.max(hop, at(id).y)
    }
    stop()
    expect(isNodeRevealing(id)).toBe(false)
    for (let index = 1; index < xs.length; index += 1) {
      expect(xs[index]!).toBeGreaterThanOrEqual(xs[index - 1]! - 1e-6)
    }
    // It was on its way a few frames in, and is there at the end, with nothing posed on it.
    expect(xs[8]!).toBeGreaterThan(0.2)
    expect(xs[8]!).toBeLessThan(2.9)
    expect(hop).toBeGreaterThan(0.01)
    expect(composed(root(id)!).equals(own(root(id)!))).toBe(true)
    expect(hasRevealPose(root(id)!)).toBe(false)

    expect(events.map((event) => event.type)).toEqual([
      'start',
      'node-start',
      'land',
      'settle',
      'complete',
    ])
    const nodeStart = events[1] as { atMs: number; changed?: boolean }
    const settled = events[3] as { atMs: number; instant: boolean }
    expect(nodeStart.changed).toBe(true)
    expect(settled.instant).toBe(false)
    expect(settled.atMs - nodeStart.atMs).toBeGreaterThan(300)
    expect(settled.atMs - nodeStart.atMs).toBeLessThan(2500)
    expect(events[4]).toMatchObject({ type: 'complete', changed: true, instant: false })
  })

  test('it counts as revealing while it travels, so a batch lets it go', async () => {
    const { pieces } = await placedAt([0, 0, 0])
    const id = pieces[0]!.id
    await agentWrites(moveAll([{ id, position: [3, 0, 2] }]))
    sync(id)
    expect(isNodeRevealing(id)).toBe(true)
    await frames(100)
    expect(isNodeRevealing(id)).toBe(true)
    await frames(2000)
    expect(isNodeRevealing(id)).toBe(false)
  })

  test('a rearranged room starts its pieces a beat apart, and every piece is home soon after', async () => {
    const { pieces } = await placedAt([0, 0, 0], 12)
    const { events, stop } = hear()
    await agentWrites(
      moveAll(pieces.map((piece, index) => ({ id: piece.id, position: [index + 1, 0, 1] }))),
    )
    for (const piece of pieces) sync(piece.id)
    await frames(4000)
    stop()
    const starts = events.filter((event) => event.type === 'node-start').map((event) => event.atMs)
    expect(starts).toHaveLength(12)
    expect(starts[0]!).toBeLessThan(starts[11]!)
    // A cap on the spread, however many pieces move.
    expect(starts[11]! - starts[0]!).toBeLessThanOrEqual(1300)
    for (const piece of pieces)
      expect(composed(root(piece.id)!).equals(own(root(piece.id)!))).toBe(true)
    expect(events.filter((event) => event.type === 'complete')).toHaveLength(1)
  })

  test('reduced motion shows the move at once, said as an instant change', async () => {
    const { pieces } = await placedAt([0, 0, 0])
    await act(async () => driver?.stop())
    start({ prefersReducedMotion: () => true })
    const id = pieces[0]!.id
    const { events, stop } = hear()
    await agentWrites(moveAll([{ id, position: [3, 0, 2] }]))
    sync(id)
    await frames(100)
    stop()
    expect(hasRevealPose(root(id)!)).toBe(false)
    expect(at(id).x).toBeCloseTo(3, 5)
    expect(events.find((event) => event.type === 'settle')).toMatchObject({ instant: true })
  })

  test('selecting the piece in the middle of its glide puts it where it is going, and says it settled', async () => {
    const { pieces } = await placedAt([0, 0, 0])
    const id = pieces[0]!.id
    const { events, stop } = hear()
    await agentWrites(moveAll([{ id, position: [3, 0, 2] }]))
    sync(id)
    await frames(100)
    expect(at(id).x).toBeLessThan(2.9)
    await act(async () => useViewer.getState().setSelection({ selectedIds: [id] } as never))
    await frames(40)
    stop()
    expect(at(id).x).toBeCloseTo(3, 5)
    expect(hasRevealPose(root(id)!)).toBe(false)
    expect(events.at(-1)).toMatchObject({ type: 'complete', changed: true })
  })
})

describe('undo plays the build in reverse', () => {
  const meshesOf = (object: Object3D) => {
    const meshes: Mesh[] = []
    object.traverse((child) => {
      if ((child as Mesh).isMesh) meshes.push(child as Mesh)
    })
    return meshes
  }
  const opacityOf = (object: Object3D) =>
    Math.min(...meshesOf(object).map((mesh) => (mesh.material as { opacity: number }).opacity))

  /** A small house, built and at rest: a slab, two walls, a pane in one, and two crates. */
  async function builtHouse() {
    const [levelId] = loadLevels()
    await mount([levelId!])
    start()
    const slab = make(Slab)
    const walls = [make(Wall), make(Wall)]
    const pane = make(Pane)
    const crates = [make(Crate), make(Crate)]
    await agentWrites(() =>
      useScene
        .getState()
        .createNodes([
          { node: slab, parentId: levelId },
          ...walls.map((node) => ({ node, parentId: levelId })),
          ...crates.map((node) => ({ node, parentId: levelId })),
        ]),
    )
    await agentWrites(() => useScene.getState().createNode(pane, walls[0]!.id as AnyNodeId))
    const all = [slab, ...walls, pane, ...crates]
    await until(() => all.every((node) => !isNodeRevealing(node.id) && root(node.id)), 9000)
    return { levelId: levelId!, slab, walls, pane, crates, all }
  }

  /** Takes `ids` back, a frame at a time, until it is over. */
  async function retract(ids: string[], onFrame: () => void = () => {}) {
    let result: RetractResult | null = null
    await act(async () => {
      retractNodes(ids).then((value) => {
        result = value
      })
    })
    const begun = now
    while (!result && now < begun + 6000) {
      await frame(20)
      onFrame()
    }
    return { result: result as RetractResult | null, took: now - begun }
  }

  test('a kind that declares no reveal, which came in with a default one, goes out the same way', async () => {
    const [levelId] = loadLevels()
    await mount([levelId!])
    start()
    const loose = make(Part)
    await agentWrites(() => useScene.getState().createNode(loose, levelId))
    await until(() => !isNodeRevealing(loose.id) && root(loose.id) !== undefined, 9000)

    const { result } = await retract([loose.id])
    expect(result?.instant).toBe(false)
    expect(result?.retracted).toEqual([loose.id])
    expect(result?.skipped).toEqual([])
  })

  test('the last phase goes first, back to the slab, each saying so, and all are hidden after', async () => {
    const { slab, walls, pane, crates, all } = await builtHouse()
    const events: RevealEvent[] = []
    const stop = subscribeRevealEvents((event) => events.push(event))
    const { result, took } = await retract(all.map((node) => node.id))
    stop()
    expect(result?.instant).toBe(false)
    expect([...(result?.retracted ?? [])].sort()).toEqual(all.map((node) => node.id).sort())
    expect(result?.skipped).toEqual([])

    const starts = events.filter((event) => event.type === 'retract-start')
    expect(starts.map((event) => (event as { phase: string }).phase)).toEqual([
      'furnishing',
      'openings',
      'structure',
      'foundation',
    ])
    const ends = events.filter((event) => event.type === 'retract-end')
    expect(ends).toHaveLength(4)
    const furnishing = starts[0] as { nodeIds: string[]; source: string | null }
    expect([...furnishing.nodeIds].sort()).toEqual(crates.map((node) => node.id).sort())
    // Each phase has started before it ends, and the next phase starts after the last has begun.
    for (const phase of ['furnishing', 'openings', 'structure', 'foundation']) {
      const start = events.findIndex(
        (event) => event.type === 'retract-start' && event.phase === phase,
      )
      const end = events.findIndex((event) => event.type === 'retract-end' && event.phase === phase)
      expect(start).toBeGreaterThanOrEqual(0)
      expect(end).toBeGreaterThan(start)
    }
    // A rewind is quick: well inside the cap, and quicker than the build took.
    expect(took).toBeLessThanOrEqual(RETRACT_TIMING.capMs + 100)

    // Gone, and held gone while the host takes the nodes out of the scene.
    await frames(300)
    for (const wall of walls) expect(yScale(root(wall.id)!)).toBeLessThan(0.01)
    expect(yScale(root(slab.id)!)).toBeLessThan(0.01)
    expect(composed(root(pane.id)!).elements[10]!).toBeLessThan(0.01)
    // They are still in the store: undoing is the host's to do.
    expect(useScene.getState().nodes[walls[0]!.id as AnyNodeId]).toBeDefined()
  })

  test('walls sink into the ground a frame at a time, never moving their own position', async () => {
    const { walls, all } = await builtHouse()
    const wall = root(walls[0]!.id)!
    const restY = wall.position.y
    const seen: number[] = []
    await retract(
      all.map((node) => node.id),
      () => {
        seen.push(yScale(wall))
        expect(wall.position.y).toBe(restY)
      },
    )
    const descent = seen.filter((value, index) => index === 0 || value < seen[index - 1]! - 1e-9)
    expect(Math.max(...seen)).toBeGreaterThan(0.9)
    expect(seen.at(-1)!).toBeLessThan(0.01)
    // It only goes down: no flicker back up while it sinks.
    for (let index = 1; index < seen.length; index += 1) {
      if (seen[index - 1]! < 0.95) expect(seen[index]!).toBeLessThanOrEqual(seen[index - 1]! + 1e-9)
    }
    expect(descent.length).toBeGreaterThan(5)
  })

  test('the 2D plan reads the reverse play: whole until its turn, going, then gone while it is held', async () => {
    const { walls, all } = await builtHouse()
    const wall = walls[0]!.id
    expect(getRevealPlanState(wall)).toBeNull()
    let asked = 0
    const stop = subscribeRevealTicks(() => {
      asked += 1
    })
    await act(async () => {
      retractNodes(all.map((node) => node.id))
    })
    const seen: { progress: number; style: string }[] = []
    let gone = false
    for (let elapsed = 0; elapsed < 5000 && !gone; elapsed += 20) {
      await frame(20)
      const state = getRevealPlanState(wall)
      if (state) seen.push(state)
      gone = state?.progress === 0 && seen.some((entry) => entry.progress > 0.2)
    }
    stop()
    expect(asked).toBeGreaterThan(0)
    // It starts whole (1), goes down, and does not come back up while the retract plays.
    expect(seen[0]!.progress).toBeGreaterThan(0.7)
    for (let index = 1; index < seen.length; index += 1)
      expect(seen[index]!.progress).toBeLessThanOrEqual(seen[index - 1]!.progress + 1e-9)
    expect(seen.at(-1)!.progress).toBe(0)
    expect(seen.every((entry) => entry.style === 'rise')).toBe(true)
    // Held gone, then let go whole again when nobody takes it out.
    await frames(3000)
    expect(getRevealPlanState(wall)).toBeNull()
  })

  test('a plan entry is told when its node starts going and when it is let go', async () => {
    const { walls, all } = await builtHouse()
    const wall = walls[0]!.id
    const changes: boolean[] = []
    const Probe = () => {
      changes.push(useRevealPlanActive(wall))
      return null
    }
    const probe = await create(<Probe />)
    expect(changes.at(-1)).toBe(false)
    await act(async () => {
      retractNodes(all.map((node) => node.id))
    })
    expect(changes.at(-1)).toBe(true)
    await frames(6000)
    expect(changes.at(-1)).toBe(false)
    await probe.unmount()
  })

  test('furniture lifts away and fades, and its own materials come back if nobody removes it', async () => {
    const { crates, all } = await builtHouse()
    const crate = root(crates[0]!.id)!
    const original = meshesOf(crate).map((mesh) => ({ mesh, material: mesh.material }))
    const lifts: number[] = []
    const opacities: number[] = []
    await retract(
      all.map((node) => node.id),
      () => {
        lifts.push(lift(crate))
        opacities.push(opacityOf(crate))
      },
    )
    expect(Math.max(...lifts)).toBeGreaterThan(0.25)
    expect(Math.min(...opacities)).toBeLessThan(0.05)
    // Nobody took them out: after a while they are put back, whole.
    await frames(3000)
    expect(composed(crate).equals(own(crate))).toBe(true)
    for (const { mesh, material } of original) expect(mesh.material).toBe(material)
    expect(hasRevealPose(crate)).toBe(false)
  })

  test('taking the nodes out of the scene ends their hold with no flash and nothing left behind', async () => {
    const { walls, crates, all } = await builtHouse()
    const wall = root(walls[0]!.id)!
    await retract(all.map((node) => node.id))
    await act(async () => {
      useScene.getState().deleteNodes([...walls, ...crates].map((node) => node.id as AnyNodeId))
    })
    await frames(100)
    expect(hasRevealPose(wall)).toBe(false)
  })

  test('a node going away counts as revealing while it plays and while it is held gone, so a batch leaves it be', async () => {
    const { crates } = await builtHouse()
    const id = crates[0]!.id
    expect(isNodeRevealing(id)).toBe(false)
    const playing: boolean[] = []
    await retract([id], () => playing.push(isNodeRevealing(id)))
    expect(playing[0]).toBe(true)
    // Gone and held so until the host takes it out: a batch must not draw it back.
    expect(isNodeRevealing(id)).toBe(true)
    await act(async () => {
      useScene.getState().deleteNodes([id as AnyNodeId])
    })
    await frames(100)
    expect(isNodeRevealing(id)).toBe(false)
  })

  test('what is only a descendant is taken back with the node: a wall takes its opening', async () => {
    const { walls, pane } = await builtHouse()
    const events: RevealEvent[] = []
    const stop = subscribeRevealEvents((event) => events.push(event))
    const { result } = await retract([walls[0]!.id])
    stop()
    expect([...(result?.retracted ?? [])].sort()).toEqual([walls[0]!.id, pane.id].sort())
    const phases = events
      .filter((event) => event.type === 'retract-start')
      .map((event) => (event as { phase: string }).phase)
    expect(phases).toEqual(['openings', 'structure'])
  })

  test('ids the scene does not show are skipped, and nothing waits on them', async () => {
    const { crates } = await builtHouse()
    const { result } = await retract([crates[0]!.id, 'fxwall_nowhere'])
    expect(result?.retracted).toEqual([crates[0]!.id])
    expect(result?.skipped).toEqual(['fxwall_nowhere'])
    const again = await retract([crates[0]!.id])
    expect(again.result?.retracted).toEqual([])
    expect(again.result?.skipped).toEqual([crates[0]!.id])
  })

  test('with nothing to take back it resolves at once', async () => {
    await builtHouse()
    const { result, took } = await retract([])
    expect(result).toEqual({ retracted: [], skipped: [], instant: false })
    expect(took).toBeLessThanOrEqual(40)
  })

  test('a build still playing is shown, then taken back', async () => {
    const [levelId] = loadLevels()
    await mount([levelId!])
    start()
    const walls = [make(Wall), make(Wall), make(Wall)]
    await agentWrites(() =>
      useScene.getState().createNodes(walls.map((node) => ({ node, parentId: levelId }))),
    )
    await frames(400)
    const { result } = await retract(walls.map((node) => node.id))
    expect([...(result?.retracted ?? [])].sort()).toEqual(walls.map((node) => node.id).sort())
    for (const wall of walls) {
      // Gone, and held so until the host takes it out: still counted as going, no longer as waiting.
      expect(isNodeRevealing(wall.id)).toBe(true)
      expect(yScale(root(wall.id)!)).toBeLessThan(0.01)
    }
  })

  test('shown at once when nothing animates: the animation off, reduced motion', async () => {
    for (const mode of ['off', 'reduced'] as const) {
      const { all } = await builtHouse()
      const events: RevealEvent[] = []
      const stop = subscribeRevealEvents((event) => events.push(event))
      let result: RetractResult | null = null
      if (mode === 'off') level = 'off'
      else {
        await act(async () => driver?.stop())
        start({ prefersReducedMotion: () => true })
      }
      await act(async () => {
        result = await retractNodes(all.map((node) => node.id))
      })
      stop()
      expect({ mode, result }).toEqual({
        mode,
        result: { retracted: [], skipped: all.map((node) => node.id), instant: true },
      })
      expect(events).toEqual([])
      for (const node of all)
        expect(composed(root(node.id)!).equals(own(root(node.id)!))).toBe(true)
      await act(async () => driver?.stop())
      await renderer?.unmount()
      renderer = null
      sceneRegistry.clear()
      level = 'full'
    }
  })

  test('a capture, or the reveal stopping, ends it at once and resolves what waits', async () => {
    for (const how of ['capture', 'stop'] as const) {
      const { walls, all } = await builtHouse()
      let result: RetractResult | null = null
      await act(async () => {
        retractNodes(all.map((node) => node.id)).then((value) => {
          result = value
        })
      })
      await frames(200)
      expect(result).toBeNull()
      if (how === 'capture')
        await act(async () => emitter.emit('thumbnail:before-capture', undefined))
      else await act(async () => driver?.stop())
      await frame(20)
      expect({ how, resolved: result !== null }).toEqual({ how, resolved: true })
      expect(composed(root(walls[0]!.id)!).equals(own(root(walls[0]!.id)!))).toBe(true)
      await act(async () => driver?.stop())
      await renderer?.unmount()
      renderer = null
      sceneRegistry.clear()
    }
  })

  test('furniture goes from under a seated roof: the roof lifts out of the way first, and seats again after', async () => {
    const [levelId] = loadLevels()
    await mount([levelId!])
    start()
    const lid = make(Lid)
    const parts = [make(Part), make(Part)]
    await agentWrites(() => {
      useScene.getState().createNode(lid, levelId)
      useScene
        .getState()
        .createNodes(parts.map((node) => ({ node, parentId: lid.id as AnyNodeId })))
    })
    await until(() => !isRevealAssembling(lid.id) && !isNodeRevealing(lid.id))
    const crates = [make(Crate), make(Crate)]
    await agentWrites(() =>
      useScene.getState().createNodes(crates.map((node) => ({ node, parentId: levelId }))),
    )
    // The agent's turn ends: the roof comes down on the furnished house.
    await frames(1500)
    await act(async () => seatLiftedNow())
    await until(() => lift(root(lid.id)!) === 0 && !isNodeRevealing(crates[0]!.id), 16_000)
    const roof = root(lid.id)!
    const crate = root(crates[0]!.id)!
    expect(composed(roof).equals(own(roof))).toBe(true)

    const events: RevealEvent[] = []
    const stop = subscribeRevealEvents((event) => events.push(event))
    let roofUpWhenCratesMoved = -1
    let highest = 0
    const { result } = await retract(
      crates.map((node) => node.id),
      () => {
        highest = Math.max(highest, lift(roof))
        if (roofUpWhenCratesMoved < 0 && lift(crate) > 0.01) roofUpWhenCratesMoved = lift(roof)
      },
    )
    stop()
    expect(result?.retracted).toHaveLength(2)
    // The roof is up (most of the way) before the first crate moves; and never more than it lifts for.
    expect(roofUpWhenCratesMoved).toBeGreaterThan(1.2)
    expect(highest).toBeLessThanOrEqual(2.4 + 0.05)
    // The camera and the card hear the undo begin as the roof starts to lift, not a beat after.
    const began = events.find((event) => event.type === 'retract-start')!
    expect(began).toMatchObject({ phase: 'furnishing' })
    // And the roof comes back, with no finish said about it.
    await until(() => lift(roof) === 0, 12_000)
    expect(composed(roof).equals(own(roof))).toBe(true)
    expect(events.filter((event) => event.type === 'finale')).toEqual([])
  })

  test('a roof undone with the furniture under it goes first, so the furniture is seen going', async () => {
    const [levelId] = loadLevels()
    await mount([levelId!])
    start()
    const lid = make(Lid)
    const parts = [make(Part), make(Part)]
    await agentWrites(() => {
      useScene.getState().createNode(lid, levelId)
      useScene
        .getState()
        .createNodes(parts.map((node) => ({ node, parentId: lid.id as AnyNodeId })))
    })
    await until(() => !isRevealAssembling(lid.id) && !isNodeRevealing(lid.id))
    const crates = [make(Crate), make(Crate)]
    await agentWrites(() =>
      useScene.getState().createNodes(crates.map((node) => ({ node, parentId: levelId }))),
    )
    await frames(1500)
    await act(async () => seatLiftedNow())
    await until(() => lift(root(lid.id)!) === 0 && !isNodeRevealing(crates[0]!.id), 16_000)
    const roof = root(lid.id)!
    const crate = root(crates[0]!.id)!

    const events: RevealEvent[] = []
    const stop = subscribeRevealEvents((event) => events.push(event))
    let roofWhenCratesMoved: { lift: number; opacity: number } | null = null
    await retract([lid.id, ...crates.map((node) => node.id)], () => {
      if (!roofWhenCratesMoved && lift(crate) > 0.01)
        roofWhenCratesMoved = { lift: lift(roof), opacity: opacityOf(roof) }
    })
    stop()
    // The roof is already going (lifted, and fading) when the first crate begins to leave.
    expect(roofWhenCratesMoved).not.toBeNull()
    expect(roofWhenCratesMoved!.lift).toBeGreaterThan(0.6)
    expect(roofWhenCratesMoved!.opacity).toBeLessThan(0.5)
    const phases = events
      .filter((event) => event.type === 'retract-start')
      .map((event) => (event as { phase: string }).phase)
    expect(phases).toEqual(['roof', 'furnishing'])
    expect(events.filter((event) => event.type === 'finale')).toEqual([])
  })

  test('a roof that is up for the furniture carries on up from where it is, with no second finish', async () => {
    const [levelId] = loadLevels()
    await mount([levelId!])
    start()
    const lid = make(Lid)
    const parts = [make(Part), make(Part)]
    await agentWrites(() => {
      useScene.getState().createNode(lid, levelId)
      useScene
        .getState()
        .createNodes(parts.map((node) => ({ node, parentId: lid.id as AnyNodeId })))
    })
    await until(() => !isRevealAssembling(lid.id) && !isNodeRevealing(lid.id))
    const crates = [make(Crate), make(Crate)]
    await agentWrites(() =>
      useScene.getState().createNodes(crates.map((node) => ({ node, parentId: levelId }))),
    )
    const roof = root(lid.id)!
    while (lift(roof) < 2.2 && now < REVEAL_TIMING.capMs * 3) await frame(20)
    const events: RevealEvent[] = []
    const stop = subscribeRevealEvents((event) => events.push(event))
    const before = lift(roof)
    const heights: number[] = []
    await retract([lid.id, ...crates.map((node) => node.id)], () => heights.push(lift(roof)))
    stop()
    // It does not drop to the roof's seat and rise again: it goes on up from where it was.
    expect(heights[0]!).toBeGreaterThanOrEqual(before - 0.05)
    expect(Math.max(...heights)).toBeGreaterThan(before)
    expect(opacityOf(roof)).toBeLessThan(0.05)
    expect(events.filter((event) => event.type === 'finale')).toEqual([])
    await frames(300)
    expect(composed(roof).elements[5]!).toBeLessThan(0.01)
  })
})

describe('a warm start', () => {
  const meshesOf = (object: Object3D) => {
    const meshes: Mesh[] = []
    object.traverse((child) => {
      if ((child as Mesh).isMesh) meshes.push(child as Mesh)
    })
    return meshes
  }
  const starts = (events: RevealEvent[]) => events.filter((event) => event.type === 'start')

  /** One frame the clock steps 20 ms on, that really took `ms`. */
  async function frameTaking(ms: number) {
    now += 20
    await act(async () => {
      driver?.tick(now, ms)
      await renderer?.advanceFrames(1, 0.02)
    })
  }

  async function house() {
    const [levelId] = loadLevels()
    await mount([levelId!])
    start()
    const slab = make(Slab)
    const walls = [make(Wall), make(Wall), make(Wall)]
    const item = make(Item)
    await agentWrites(() =>
      useScene
        .getState()
        .createNodes([
          { node: slab, parentId: levelId },
          ...walls.map((node) => ({ node, parentId: levelId })),
          { node: item, parentId: levelId },
        ]),
    )
    return { levelId: levelId!, slab, walls, item }
  }

  test('the first of each kind mounts up front, hidden, and nothing moves until it has drawn', async () => {
    const { slab, walls, item } = await house()
    const events: RevealEvent[] = []
    const stop = subscribeRevealEvents((event) => events.push(event))
    await frame(20)
    await frame(20)
    // One slab, one wall and one item are mounted, and hidden; the other walls wait for their turn.
    for (const node of [slab, walls[0]!, item]) {
      const object = root(node.id)
      expect(object).toBeDefined()
      expect(Math.max(...composed(object!).elements.slice(0, 3))).toBeLessThan(0.01)
      expect(isNodeRevealing(node.id)).toBe(true)
    }
    expect(root(walls[1]!.id)).toBeUndefined()
    expect(root(walls[2]!.id)).toBeUndefined()
    // Never culled while it warms: it must draw to build its pipelines wherever the camera looks.
    const seen = meshesOf(root(walls[0]!.id)!)
    expect(seen.length).toBeGreaterThan(0)
    await frame(20)
    expect(events).toEqual([])
    for (const mesh of seen) expect(mesh.frustumCulled).toBe(false)

    await frames(REVEAL_TIMING.capMs + 1000)
    stop()
    expect(starts(events).length).toBeGreaterThan(0)
    // Then it plays as ever, and ends whole, with its meshes culled again.
    for (const node of [slab, ...walls, item]) {
      expect(composed(root(node.id)!).equals(own(root(node.id)!))).toBe(true)
    }
    for (const mesh of meshesOf(root(walls[0]!.id)!)) expect(mesh.frustumCulled).toBe(true)
  })

  test('the plan waits for the frames to be steady after the first draw, and no longer than a couple of seconds', async () => {
    const { walls } = await house()
    const events: RevealEvent[] = []
    const stop = subscribeRevealEvents((event) => events.push(event))
    // A first draw that freezes the picture: every frame takes 300 ms for a second of clock.
    for (let elapsed = 0; elapsed < 1000; elapsed += 20) await frameTaking(300)
    expect(root(walls[0]!.id)).toBeDefined()
    expect(starts(events)).toEqual([])
    // The frames settle: the build begins within a few of them.
    for (let index = 0; index < 8; index += 1) await frameTaking(16)
    expect(starts(events).length).toBeGreaterThan(0)
    stop()
  })

  test('frames that never settle do not hold the build back for ever', async () => {
    await house()
    const events: RevealEvent[] = []
    const stop = subscribeRevealEvents((event) => events.push(event))
    for (let elapsed = 0; elapsed < 3200; elapsed += 20) await frameTaking(300)
    stop()
    expect(starts(events).length).toBeGreaterThan(0)
  })

  test('a kind already on screen is not warmed again: only what is new to the screen mounts up front', async () => {
    const { levelId, walls } = await house()
    await until(() => walls.every((node) => !isNodeRevealing(node.id)), 9000)
    const more = [make(Wall), make(Wall)]
    const crate = make(Crate)
    await agentWrites(() =>
      useScene
        .getState()
        .createNodes([...more, crate].map((node) => ({ node, parentId: levelId }))),
    )
    await frame(20)
    await frame(20)
    // The crate is new to the screen: mounted, and the plan held for it. The walls keep their turn.
    expect(root(crate.id)).toBeDefined()
    for (const node of more) expect(root(node.id)).toBeUndefined()
  })

  test('an opening is left for its turn: mounting it up front would cut its wall before it opens', async () => {
    const { levelId, walls } = await house()
    await until(() => walls.every((node) => !isNodeRevealing(node.id)), 9000)
    const pane = make(Pane)
    const crate = make(Crate)
    await agentWrites(() => {
      useScene.getState().createNode(crate, levelId)
      useScene.getState().createNode(pane, walls[0]!.id as AnyNodeId)
    })
    await frame(20)
    await frame(20)
    expect(root(crate.id)).toBeDefined()
    expect(root(pane.id)).toBeUndefined()
    await until(() => !isNodeRevealing(pane.id), 9000)
    expect(root(pane.id)).toBeDefined()
  })

  test('each catalog model is warmed on its own, one of each, since each has its own materials', async () => {
    const [levelId] = loadLevels()
    await mount([levelId!])
    start()
    const asset = (id: string) => ({
      id,
      category: 'furniture',
      name: id,
      thumbnail: '',
      src: `/items/${id}/model.glb`,
      dimensions: [1, 1, 1] as [number, number, number],
    })
    const chair = [make(Model, { asset: asset('chair') }), make(Model, { asset: asset('chair') })]
    const sofa = make(Model, { asset: asset('sofa') })
    await agentWrites(() =>
      useScene
        .getState()
        .createNodes([...chair, sofa].map((node) => ({ node, parentId: levelId }))),
    )
    await frame(20)
    await frame(20)
    expect(root(chair[0]!.id)).toBeDefined()
    expect(root(sofa.id)).toBeDefined()
    expect(root(chair[1]!.id)).toBeUndefined()
  })

  test('the roof that will lift draws once as the ghost it becomes, ahead of the furniture, and the lift waits for it', async () => {
    const [levelId] = loadLevels()
    await mount([levelId!])
    start()
    const lid = make(Lid)
    const parts = [make(Part), make(Part)]
    await agentWrites(() => {
      useScene.getState().createNode(lid, levelId)
      useScene
        .getState()
        .createNodes(parts.map((node) => ({ node, parentId: lid.id as AnyNodeId })))
    })
    await until(() => !isRevealAssembling(lid.id) && !isNodeRevealing(lid.id))
    const roof = root(lid.id)!
    const material = meshesOf(roof)[0]!.material as { transparent: boolean; opacity: number }
    expect(material.transparent).toBe(false)
    const crates = [make(Crate), make(Crate)]
    await agentWrites(() =>
      useScene.getState().createNodes(crates.map((node) => ({ node, parentId: levelId }))),
    )
    await frame(20)
    // Faintly a ghost already, and not yet moved.
    const ghost = meshesOf(roof)[0]!.material as { transparent: boolean; opacity: number }
    expect(ghost.transparent).toBe(true)
    expect(ghost.opacity).toBeGreaterThan(0.98)
    expect(lift(roof)).toBe(0)
    // The furniture drops as the roof rises, and the roof comes whole again after.
    let highest = 0
    while (now < REVEAL_TIMING.capMs * 3 && highest < 2) {
      await frame(20)
      highest = Math.max(highest, lift(roof))
    }
    expect(highest).toBeGreaterThan(2)
  })
})

describe('nothing a build adds pops in at once', () => {
  for (const at of ['full', 'framing'] as const) {
    test(`${at}: a kind that declares no reveal, added on a level already there, waits for its turn`, async () => {
      level = at
      const [levelId] = loadLevels()
      await mount([levelId!])
      start()
      const wall = make(Wall)
      const loose = make(Part)
      await agentWrites(() =>
        useScene.getState().createNodes([
          { node: wall, parentId: levelId! },
          { node: loose, parentId: levelId! },
        ]),
      )
      expect(root(loose.id)).toBeUndefined()
      expect(isRevealWaiting(loose.id)).toBe(true)
      await until(
        () => !isNodeRevealing(loose.id) && !isNodeRevealing(wall.id),
        LAZY_REVEAL_TIMING.capMs,
      )
      expect(root(loose.id)).toBeDefined()
      expect(hasRevealPose(root(loose.id)!)).toBe(false)
    })
  }
})

describe('the framing level: the lazy schedule and its prerolls', () => {
  test('a wall waits out its preroll, unmounted, on the reveal clock a plugin reads; then it rises past its top and settles', async () => {
    level = 'framing'
    const [levelId] = loadLevels()
    await mount([levelId!])
    start()
    setRevealPreroll((candidate) => (candidate.style === 'rise' ? 1500 : 0))
    const slab = make(Slab)
    const walls = [make(Wall), make(Wall)]
    await agentWrites(() =>
      useScene
        .getState()
        .createNodes([
          { node: slab, parentId: levelId! },
          ...walls.map((node) => ({ node, parentId: levelId! })),
        ]),
    )
    await until(() => getRevealTurn(walls[0]!.id) !== null)
    expect(revealClockMs()).toBe(now)
    const turns = walls.map((wall) => getRevealTurn(wall.id)!)
    for (const turn of turns) expect(turn.prerollMs).toBe(1500)
    // Its preroll: the plugin plays, the wall waits, unmounted or (the first of its kind, drawn up
    // front for its shaders) hidden.
    const unseen = (id: string) => {
      const wallRoot = root(id)
      return !wallRoot || yScale(wallRoot) < 0.01
    }
    while (revealClockMs() + 20 < turns[0]!.startMs) {
      await frame()
      expect(unseen(walls[0]!.id)).toBe(true)
      expect(isRevealWaiting(walls[0]!.id)).toBe(true)
    }
    let tallest = 0
    while (isNodeRevealing(walls[0]!.id)) {
      await frame()
      expect(now).toBeLessThan(turns[0]!.startMs + 3000)
      const wallRoot = root(walls[0]!.id)
      if (wallRoot?.children.length) tallest = Math.max(tallest, yScale(wallRoot))
    }
    expect(getRevealTurn(walls[0]!.id)).toBeNull()
    // Overdone a little: past its full height, then back to exactly its own transform.
    expect(tallest).toBeGreaterThan(1.01)
    expect(composed(root(walls[0]!.id)!).elements).toEqual(own(root(walls[0]!.id)!).elements)
  })

  test('a capture ends a preroll at once: the wall stands whole', async () => {
    level = 'framing'
    const [levelId] = loadLevels()
    await mount([levelId!])
    start()
    setRevealPreroll((candidate) => (candidate.style === 'rise' ? 4000 : 0))
    const wall = make(Wall)
    await agentWrites(() => useScene.getState().createNode(wall, levelId!))
    await until(() => getRevealTurn(wall.id) !== null)
    await frames(200)
    const waiting = root(wall.id)
    expect(!waiting || yScale(waiting) < 0.01).toBe(true)
    await act(async () => {
      emitter.emit('thumbnail:before-capture', undefined)
    })
    await frame()
    expect(isNodeRevealing(wall.id)).toBe(false)
    expect(getRevealTurn(wall.id)).toBeNull()
    expect(root(wall.id)).toBeDefined()
  })
})

describe('the animation speed', () => {
  /** One wall written by the agent, and the progress it makes per frame once it moves. */
  async function wallProgress(frameMs: number) {
    const [levelId] = loadLevels()
    await mount([levelId!])
    return { levelId: levelId! }
  }

  test('is read when the plan is made: the build plays at the speed the person had then', async () => {
    let speed = 2
    const { levelId } = await wallProgress(20)
    start({ speed: () => speed })
    const wall = make(Wall)
    await agentWrites(() => useScene.getState().createNodes([{ node: wall, parentId: levelId }]))
    // The build waits a few frames for its shaders, then is planned: at the speed asked for then.
    for (let elapsed = 0; elapsed < 2000 && getRevealPlanSpeed() !== 2; elapsed += 20)
      await frame(20)
    expect(getRevealPlanSpeed()).toBe(2)
    // Played at ×2, the wall rises in half the shipped time: its progress per frame is doubled.
    let before = -1
    let after = -1
    for (let elapsed = 0; elapsed < 4000 && after < 0; elapsed += 20) {
      await frame(20)
      const state = getRevealPlanState(wall.id)
      if (state && state.progress > 0.05 && state.progress < 0.8) {
        before = state.progress
        await frame(20)
        after = getRevealPlanState(wall.id)!.progress
      }
    }
    expect(before).toBeGreaterThan(0)
    expect(after - before).toBeCloseTo(20 / revealTimingAt(2).durationMs.rise, 3)
    speed = 1
  })

  test('a change applies to the next build and never moves one playing', async () => {
    let speed = 1
    const { levelId } = await wallProgress(20)
    start({ speed: () => speed })
    const first = make(Wall)
    await agentWrites(() => useScene.getState().createNodes([{ node: first, parentId: levelId }]))
    let mid = -1
    for (let elapsed = 0; elapsed < 4000 && mid < 0; elapsed += 20) {
      await frame(20)
      const state = getRevealPlanState(first.id)
      if (state && state.progress > 0.1) mid = state.progress
    }
    expect(mid).toBeGreaterThan(0.1)
    // The person turns it up while this wall is rising: it keeps its own pace.
    speed = 2
    await frame(20)
    const next = getRevealPlanState(first.id)!.progress
    expect(next - mid).toBeCloseTo(20 / REVEAL_TIMING.durationMs.rise, 3)
    // The next build is planned at the new speed.
    const second = make(Wall)
    await agentWrites(() => useScene.getState().createNodes([{ node: second, parentId: levelId }]))
    for (let elapsed = 0; elapsed < 2000 && getRevealPlanSpeed() !== 2; elapsed += 20)
      await frame(20)
    expect(getRevealPlanSpeed()).toBe(2)
  })

  test('at ×1 a build plays on the shipped tables, at both levels', () => {
    expect(revealTimingAt(1)).toBe(REVEAL_TIMING)
    expect(lazyTimingAt(1)).toBe(LAZY_REVEAL_TIMING)
  })
})
