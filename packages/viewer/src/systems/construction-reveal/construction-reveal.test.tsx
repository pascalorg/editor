import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeDefinition,
  type AnyNodeId,
  applySceneSnapshot,
  BaseNode,
  clearSceneHistory,
  emitter,
  ItemNode,
  LevelNode,
  loadPlugin,
  type NodeDefinition,
  nodeRegistry,
  nodeType,
  objectId,
  type RevealConfig,
  runAsSceneCommitAuthor,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { act, create } from '@react-three/test-renderer'
import { BoxGeometry, Group, Matrix4, Mesh, type Object3D } from 'three'
import { NodeRenderer } from '../../components/renderers/node-renderer'
import { DustPool } from '../../lib/construction-dust'
import { OVERLAY_LAYER, scenePassLayers } from '../../lib/layers'
import { hasRevealPose } from '../../lib/reveal-pose'
import { RETRACT_TIMING, REVEAL_TIMING } from '../../lib/reveal-schedule'
import useViewer from '../../store/use-viewer'
import { GeometrySystem } from '../geometry/geometry-system'
import { ConstructionDust } from './construction-dust'

// Construction reveal, failure modes written before the code: a person's edit,
// a load, an undo, a capture, a selection, reduced motion and the read-only
// viewer are instant; an agent build mounts phase by phase and settles with
// every root back on its own transform.
import {
  ConstructionReveal,
  type ConstructionRevealDriver,
  type ConstructionRevealLevel,
  getRevealPlanState,
  isNodeRevealing,
  isRevealAssembling,
  isRevealWaiting,
  type RetractResult,
  type RevealEvent,
  type RevealPhaseEvent,
  retractNodes,
  seatLiftedNow,
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
    capabilities: reveal ? { reveal } : {},
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

const make = (kind: { schema: typeof BaseNode }, data: Record<string, unknown> = {}) =>
  kind.schema.parse(data) as AnyNode

function LevelChildren({ levelId }: { levelId: AnyNodeId }) {
  const children = useScene(
    (state) => (state.nodes[levelId] as { children?: AnyNodeId[] } | undefined)?.children ?? [],
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

function start(options: { prefersReducedMotion?: () => boolean } = {}) {
  dust = new DustPool()
  driver = startConstructionReveal({
    reveals: (commit) => commit.author === 'agent',
    prefersReducedMotion: options.prefersReducedMotion ?? (() => false),
    level: () => level,
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
      QueuedWall.definition,
      Door.definition,
      Item.definition,
      Post.definition,
      Plate.definition,
      Pane.definition,
      Roof.definition,
      Lid.definition,
      Crate.definition,
      Movable.definition,
      Model.definition,
      Part.definition,
    ],
  })
  now = 0
  level = 'full'
  reached.clear()
})

afterEach(async () => {
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

  test('a level nobody sees shows at once and holds no slot', async () => {
    const levelIds = loadLevels(2)
    await mount(levelIds)
    useViewer.setState({
      hideLevelsAboveSelection: true,
      selection: { ...useViewer.getState().selection, levelId: levelIds[0]! },
    } as never)
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

    expect(root(above.id)).toBeDefined()
    expect(isNodeRevealing(above.id)).toBe(false)
    expect(root(below.id)).toBeDefined()
    expect(isNodeRevealing(below.id)).toBe(true)
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
  test('a post drops from its declared height, lands with a puff at its foot and keeps its own position.y', async () => {
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
    let puffedAt: number | null = null
    while (isNodeRevealing(post.id)) {
      lifts.push(lift(object))
      if (puffedAt === null && dust.live > 0) puffedAt = lifts.length - 1
      await frame()
    }

    expect(Math.max(...lifts)).toBeGreaterThan(3)
    expect(Math.max(...lifts)).toBeLessThanOrEqual(4)
    expect(Math.min(...lifts)).toBeGreaterThanOrEqual(0)
    // The puff comes as it lands, not as it starts falling.
    expect(puffedAt).not.toBeNull()
    expect(lifts[puffedAt! - 1]! < 0.2 || lifts[puffedAt!]! < 0.2).toBe(true)
    const sprites: number[][] = []
    dust.step(now, (_, x, y, z) => sprites.push([x, y, z]))
    for (const [x, y, z] of sprites) {
      expect(Math.hypot(x!, z!)).toBeLessThan(1.2)
      expect(y).toBeLessThan(1.5 + 0.8)
    }

    expect(object.position.y).toBe(1.5)
    expect(composed(object).equals(own(object))).toBe(true)
  })

  test('a rising wall puffs along its base', async () => {
    const [levelId] = loadLevels()
    await mount([levelId!])
    start()
    const wall = make(Wall)
    await agentWrites(() => useScene.getState().createNode(wall, levelId))
    await until(() => dust.live > 0)

    expect(root(wall.id)).toBeDefined()
    expect(yScale(root(wall.id)!)).toBeLessThan(0.5)
    const xs: number[] = []
    dust.step(now, (_, x, y) => {
      xs.push(x)
      expect(y).toBeLessThan(0.6)
    })
    expect(Math.min(...xs)).toBeLessThan(1)
    expect(Math.max(...xs)).toBeGreaterThan(3)
  })

  test('a plate settles from a few centimetres; a pane grows through its wall; nothing is left mid-pose', async () => {
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

    let plateLift = 0
    let paneDepth = 1
    while (isNodeRevealing(plate.id) || isNodeRevealing(wall.id) || isNodeRevealing(pane.id)) {
      await frame()
      const plateRoot = root(plate.id)
      if (plateRoot?.children.length) plateLift = Math.max(plateLift, lift(plateRoot))
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

    expect(plateLift).toBeGreaterThan(0.02)
    expect(plateLift).toBeLessThanOrEqual(0.08)
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

describe('failure mode 10: a level nobody sees', () => {
  test('hidden after planning, it stops holding the visible level back', async () => {
    const levelIds = loadLevels(2)
    await mount(levelIds)
    start()
    const below = [make(Wall), make(Wall)]
    const above = Array.from({ length: 24 }, () => make(Wall))
    const item = make(Item)
    await agentWrites(() =>
      useScene
        .getState()
        .createNodes([
          ...below.map((node) => ({ node, parentId: levelIds[0]! })),
          ...above.map((node) => ({ node, parentId: levelIds[1]! })),
          { node: item, parentId: levelIds[0]! },
        ]),
    )
    await frames(60)
    await act(async () =>
      useViewer.setState({
        hideLevelsAboveSelection: true,
        selection: { ...useViewer.getState().selection, levelId: levelIds[0]! },
      } as never),
    )
    await frame()
    for (const wall of above) expect(isNodeRevealing(wall.id)).toBe(false)

    // Planned with the upper floor, the item would wait for its 24 walls (about 1.9 s).
    const hiddenAt = now
    await until(() => Boolean(root(item.id)))
    expect(now - hiddenAt).toBeLessThan(900)
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
    // 68 % of the fall is spent falling (reveal-pose DROP_FALL), give or take a frame.
    expect(landed.atMs - begun!.atMs).toBeGreaterThanOrEqual(
      REVEAL_TIMING.durationMs.drop * 0.68 - 40,
    )
    expect(landed.atMs - begun!.atMs).toBeLessThanOrEqual(REVEAL_TIMING.durationMs.drop * 0.68 + 80)
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
  test('a roof piece lifts a hair above where it hangs before it falls', async () => {
    const [levelId] = loadLevels()
    await mount([levelId!])
    start()
    const roof = make(Roof)
    const parts = [make(Part), make(Part)]
    await agentWrites(() => {
      useScene.getState().createNode(roof, levelId)
      useScene
        .getState()
        .createNodes(parts.map((node) => ({ node, parentId: roof.id as AnyNodeId })))
    })
    const peak = new Map<string, number>()
    while (isRevealAssembling(roof.id)) {
      await frame(10)
      expect(now).toBeLessThan(REVEAL_TIMING.capMs + 1000)
      for (const part of parts) {
        const partRoot = root(part.id)
        if (partRoot?.children.length)
          peak.set(part.id, Math.max(peak.get(part.id) ?? 0, lift(partRoot)))
      }
    }
    for (const part of parts) {
      // Declared to fall from 4 m: a hair above it, 5 % of the height at most.
      expect(peak.get(part.id)!).toBeGreaterThan(4.05)
      expect(peak.get(part.id)!).toBeLessThanOrEqual(4.2 + 0.005)
    }
  })

  test('the last piece to land is the heavier, and the build says it landed', async () => {
    const [levelId] = loadLevels()
    await mount([levelId!])
    start()
    const events: RevealEvent[] = []
    const stop = subscribeRevealEvents((event) => events.push(event))
    const posts = Array.from({ length: 4 }, () => make(Post))
    const deepest = new Map<string, number>()
    try {
      await agentWrites(() =>
        useScene.getState().createNodes(posts.map((node) => ({ node, parentId: levelId }))),
      )
      while (now < REVEAL_TIMING.capMs + 1500) {
        await frame(10)
        for (const post of posts) {
          const object = root(post.id)
          // Not the hidden pose before its first build: only the squash.
          if (object?.children.length && yScale(object) > 0.5)
            deepest.set(post.id, Math.min(deepest.get(post.id) ?? 1, yScale(object)))
        }
      }
    } finally {
      stop()
    }
    const starts = events.filter((event) => event.type === 'node-start')
    const last = starts.at(-1)!
    const finale = events.filter((event) => event.type === 'finale')
    expect(finale).toHaveLength(1)
    expect(finale[0]).toMatchObject({ id: (last as { id: string }).id, phase: 'structure' })
    // On its landing frame: 68 % of its fall after it began.
    const fell = finale[0]!.atMs - last.atMs
    expect(fell).toBeGreaterThanOrEqual(REVEAL_TIMING.durationMs.drop * 0.68 - 30)
    expect(fell).toBeLessThanOrEqual(REVEAL_TIMING.durationMs.drop * 0.68 + 40)
    const others = posts.filter((post) => post.id !== (last as { id: string }).id)
    const heaviest = 1 - deepest.get((last as { id: string }).id)!
    for (const post of others) expect(heaviest).toBeGreaterThan((1 - deepest.get(post.id)!) * 1.4)
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

  test('a build shown at once warms nothing', async () => {
    level = 'off'
    const { slab } = await house()
    await frame(20)
    // `off` shows the build as it lands: mounted whole, not held back.
    expect(root(slab.id)).toBeDefined()
    expect(composed(root(slab.id)!).equals(own(root(slab.id)!))).toBe(true)
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

  test('the first puff of dust is drawn once, invisibly, before the walls rise', async () => {
    await house()
    await frame(20)
    expect(dust.takeWarm()).toBe(true)
  })
})
