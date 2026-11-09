import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeDefinition,
  type AnyNodeId,
  BaseNode,
  clearSceneHistory,
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
  subscribeSceneCommits,
  useScene,
} from '@pascal-app/core'
import { act, create } from '@react-three/test-renderer'
import { BoxGeometry, Group, Mesh } from 'three'
import { NodeRenderer } from '../components/renderers/node-renderer'
import useViewer from '../store/use-viewer'
import {
  type ConstructionRevealDriver,
  isNodeRevealing,
  startConstructionReveal,
} from '../systems/construction-reveal/construction-reveal'
import { GeometrySystem } from '../systems/geometry/geometry-system'
import { REVEAL_TIMING } from './reveal-schedule'
import { planRevealWindows } from './reveal-windows'

// A presentation that plays beside the reveal (a plugin's own layer) needs to
// know when each (phase, level) group plays, to land before it ends.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
globalThis.requestAnimationFrame ??= (callback) => {
  callback(0)
  return 0
}
globalThis.cancelAnimationFrame ??= () => {}

const PLUGIN_ID = 'fixture:reveal-windows'
const base = { object: 'node', parentId: null, visible: true, metadata: {} } as const
const Children = { children: LevelNode.shape.children }

function revealKind(
  kind: string,
  prefix: string,
  reveal: RevealConfig,
  geometry: () => BoxGeometry,
) {
  const schema = BaseNode.extend({ id: objectId(prefix), type: nodeType(kind), ...Children })
  const definition: NodeDefinition<typeof schema> = {
    kind,
    schemaVersion: 1,
    schema,
    category: 'structure',
    defaults: () => base,
    capabilities: { reveal },
    geometry: () => new Group().add(new Mesh(geometry())),
  }
  return { schema, definition: definition as unknown as AnyNodeDefinition }
}

const Slab = revealKind('fixture:slab', 'fxslab', { phase: 'foundation', style: 'scale' }, () =>
  new BoxGeometry(4, 0.2, 4).translate(2, -0.1, 2),
)
const Wall = revealKind('fixture:wall', 'fxwall', { phase: 'structure', style: 'rise' }, () =>
  new BoxGeometry(4, 2.5, 0.2).translate(2, 1.25, 0),
)
const Column = revealKind(
  'fixture:column',
  'fxcolumn',
  { phase: 'structure', style: 'drop', height: 4 },
  () => new BoxGeometry(0.3, 2.5, 0.3).translate(0, 1.25, 0),
)
const Item = revealKind('fixture:item', 'fxitem', { phase: 'furnishing', style: 'scale' }, () =>
  new BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
)

const make = (kind: { schema: typeof BaseNode }) => kind.schema.parse({}) as AnyNode

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

let renderer: Awaited<ReturnType<typeof create>> | null = null
let driver: ConstructionRevealDriver | null = null
let restoreRegistry: () => void = () => {}
let now = 0
const previousScene = useScene.getState()
const previousViewer = useViewer.getState()

function loadLevels(count: number): AnyNodeId[] {
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

async function frame(ms = 20) {
  now += ms
  await act(async () => {
    driver?.tick(now)
    await renderer?.advanceFrames(1, ms / 1000)
  })
}

/** One agent commit of a slab, `walls` walls and two items per level; returns the commit and the walls. */
async function agentBuild(levelIds: AnyNodeId[], walls: number) {
  const byLevel = new Map<AnyNodeId, AnyNode[]>()
  let commit: SceneCommit | null = null
  const stop = subscribeSceneCommits((next) => {
    commit = next
  })
  try {
    await act(async () => {
      runAsSceneCommitAuthor('agent', () =>
        useScene.getState().createNodes(
          levelIds.flatMap((levelId) => {
            const levelWalls = Array.from({ length: walls }, () => make(Wall))
            byLevel.set(levelId, levelWalls)
            return [
              { node: make(Slab), parentId: levelId },
              ...levelWalls.map((node) => ({ node, parentId: levelId })),
              { node: make(Item), parentId: levelId },
              { node: make(Item), parentId: levelId },
            ]
          }),
        ),
      )
    })
  } finally {
    stop()
  }
  if (!commit) throw new Error('no commit')
  return { commit: commit as SceneCommit, walls: byLevel }
}

beforeEach(async () => {
  restoreRegistry = nodeRegistry._snapshot()
  nodeRegistry._reset()
  await loadPlugin({
    id: PLUGIN_ID,
    apiVersion: 1,
    nodes: [Slab.definition, Wall.definition, Column.definition, Item.definition],
  })
  now = 0
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

describe('reveal windows', () => {
  test('one window per (phase, level): phases in turn, every floor at once, all within the cap', async () => {
    const levelIds = loadLevels(2)
    const { commit } = await agentBuild(levelIds, 12)
    const windows = planRevealWindows(commit)
    const at = (phase: string, levelId: string) =>
      windows.find((window) => window.phase === phase && window.levelId === levelId)!

    expect(windows).toHaveLength(6)
    for (const levelId of levelIds) {
      const foundation = at('foundation', levelId)
      const structure = at('structure', levelId)
      const furnishing = at('furnishing', levelId)
      expect(foundation.startMs).toBeLessThan(REVEAL_TIMING.nodeGapMs)
      expect(structure.startMs).toBeGreaterThan(foundation.startMs)
      // twelve walls, one rise each, evenly spaced
      expect(structure.endMs - structure.startMs).toBeGreaterThan(REVEAL_TIMING.durationMs.rise)
      expect(furnishing.startMs).toBeGreaterThan(structure.startMs)
      expect(furnishing.endMs).toBeLessThanOrEqual(REVEAL_TIMING.capMs)
    }
    // The upper floor rises with the lower one, not after it.
    const [lower, upper] = levelIds.map((levelId) => at('structure', levelId))
    expect(Math.abs(upper!.startMs - lower!.startMs)).toBeLessThan(REVEAL_TIMING.nodeGapMs)
    expect(upper!.startMs).toBeLessThan(lower!.endMs)
  })

  test('the windows follow the level: at `simple` a falling kind scales in, as the reveal plays it', async () => {
    const [levelId] = loadLevels(1)
    let commit: SceneCommit | null = null
    const stop = subscribeSceneCommits((next) => {
      commit = next
    })
    await act(async () => {
      runAsSceneCommitAuthor('agent', () => useScene.getState().createNode(make(Column), levelId!))
    })
    stop()
    const span = (level: 'full' | 'framing' | 'simple') => {
      const [window] = planRevealWindows(commit!, level)
      return window!.endMs - window!.startMs
    }
    expect(span('full')).toBe(REVEAL_TIMING.durationMs.drop)
    expect(span('framing')).toBe(REVEAL_TIMING.durationMs.drop)
    expect(span('simple')).toBe(REVEAL_TIMING.durationMs.scale)
  })

  test('a commit that creates nothing revealable has no windows', async () => {
    loadLevels(1)
    let commit: SceneCommit | null = null
    const stop = subscribeSceneCommits((next) => {
      commit = next
    })
    await act(async () => {
      useScene.getState().updateNode(
        Object.keys(useScene.getState().nodes)[0] as AnyNodeId,
        {
          name: 'Ground',
        } as never,
      )
    })
    stop()
    expect(planRevealWindows(commit!)).toEqual([])
  })

  test("a level's structure window ends when the driver's last wall on it stops rising", async () => {
    const levelIds = loadLevels(2)
    renderer = await create(
      <>
        {levelIds.map((levelId) => (
          <LevelChildren key={levelId} levelId={levelId} />
        ))}
        <GeometrySystem />
      </>,
    )
    await frame(0)
    driver = startConstructionReveal({
      reveals: (commit) => commit.author === 'agent',
      prefersReducedMotion: () => false,
    })
    const { commit, walls } = await agentBuild(levelIds, 8)
    const windows = planRevealWindows(commit)
    // The reveal plans from its first frame after the commit.
    const startedAt = now + 20
    const settledAt = new Map<string, number>()
    while (now < REVEAL_TIMING.capMs + 1000) {
      await frame()
      for (const levelId of levelIds) {
        if (settledAt.has(levelId)) continue
        if (walls.get(levelId)!.every((wall) => !isNodeRevealing(wall.id))) {
          settledAt.set(levelId, now)
        }
      }
    }
    for (const levelId of levelIds) {
      const window = windows.find((w) => w.phase === 'structure' && w.levelId === levelId)!
      // A wall's rise clock starts with its first build, a frame or two after it mounts, and the plan
      // waits a few steady frames for what mounts up front (the first wall) to have drawn.
      expect(settledAt.get(levelId)!).toBeGreaterThanOrEqual(startedAt + window.endMs)
      expect(settledAt.get(levelId)!).toBeLessThanOrEqual(startedAt + window.endMs + 250)
    }
  })
})
