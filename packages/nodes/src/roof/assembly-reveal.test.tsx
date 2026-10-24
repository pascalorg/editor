import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  clearSceneHistory,
  emitter,
  LevelNode,
  nodeRegistry,
  RoofNode,
  RoofSegmentNode,
  registerNode,
  runAsSceneCommitAuthor,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import {
  type ConstructionRevealDriver,
  isNodeRevealing,
  isRevealAssembling,
  NodeRenderer,
  RoofSystem,
  startConstructionReveal,
  useViewer,
} from '@pascal-app/viewer'
import { act, create } from '@react-three/test-renderer'
import type { Mesh, Object3D } from 'three'
import { builtinPlugin } from '../index'

// A roof an agent builds arrives segment by segment, drawn apart while they
// drop, then whole as the merged shell — and a capture at any moment sees
// the merged shell, never a half-assembled roof.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
globalThis.requestAnimationFrame ??= (callback) => {
  callback(0)
  return 0
}
globalThis.cancelAnimationFrame ??= () => {}

type Renderer = Awaited<ReturnType<typeof create>>

let renderer: Renderer | null = null
let driver: ConstructionRevealDriver | null = null
let restoreRegistry: () => void = () => {}
let now = 0
const previousScene = useScene.getState()
const previousViewer = useViewer.getState()

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

/** One frame: the reveal advances, the roof system builds, lazy renderers resolve. */
async function frame(ms = 20) {
  now += ms
  await act(async () => {
    driver?.tick(now)
    await renderer?.advanceFrames(1, ms / 1000)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function frames(totalMs: number, ms = 20) {
  for (let elapsed = 0; elapsed < totalMs; elapsed += ms) await frame(ms)
}

async function until(done: () => boolean, limitMs = 8000) {
  const stopAt = now + limitMs
  while (!done() && now < stopAt) await frame()
  expect(done()).toBe(true)
}

const root = (id: string): Object3D | undefined => sceneRegistry.nodes.get(id)
const part = (roofId: string, name: string) => root(roofId)?.getObjectByName(name)
const vertices = (object: Object3D | undefined) =>
  (object as Mesh | undefined)?.geometry?.getAttribute('position')?.count ?? 0

async function buildRoof() {
  const level = LevelNode.parse({ level: 0, children: [] })
  useScene.getState().setScene({ [level.id]: level as AnyNode }, [level.id as AnyNodeId], {
    installedPlugins: [],
    hasExplicitPluginInstallState: false,
  })
  clearSceneHistory()
  renderer = await create(
    <>
      <LevelChildren levelId={level.id as AnyNodeId} />
      <RoofSystem />
    </>,
  )
  driver = startConstructionReveal({
    reveals: (commit) => commit.author === 'agent',
    prefersReducedMotion: () => false,
  })
  const roof = RoofNode.parse({ children: [] })
  const segments = [
    RoofSegmentNode.parse({ position: [-3, 0, 0], width: 6, depth: 5 }),
    RoofSegmentNode.parse({ position: [3, 0, 0], width: 6, depth: 5, roofType: 'hip' }),
  ]
  await act(async () => {
    runAsSceneCommitAuthor('agent', () => {
      useScene.getState().createNode(roof as AnyNode, level.id as AnyNodeId)
      useScene
        .getState()
        .createNodes(
          segments.map((node) => ({ node: node as AnyNode, parentId: roof.id as AnyNodeId })),
        )
    })
  })
  return { roof, segments }
}

beforeEach(() => {
  restoreRegistry = nodeRegistry._snapshot()
  for (const definition of builtinPlugin.nodes ?? []) registerNode(definition)
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

describe('a roof an agent builds', () => {
  test('drops in segment by segment, drawn apart, then shows its merged shell', async () => {
    const { roof, segments } = await buildRoof()
    await until(() => segments.some((segment) => vertices(root(segment.id)) > 3))

    expect(isRevealAssembling(roof.id)).toBe(true)
    expect(part(roof.id, 'merged-roof')?.visible).toBe(false)
    expect(part(roof.id, 'segments-wrapper')?.visible).toBe(true)

    await until(() => !isRevealAssembling(roof.id))
    await frame()
    expect(part(roof.id, 'merged-roof')?.visible).toBe(true)
    expect(part(roof.id, 'segments-wrapper')?.visible).toBe(false)
    expect(vertices(part(roof.id, 'merged-roof'))).toBeGreaterThan(3)
    // Hidden segments still meet rays: they go back to empty placeholders, as after a reload.
    for (const segment of segments) {
      expect(isNodeRevealing(segment.id)).toBe(false)
      expect(vertices(root(segment.id))).toBeLessThanOrEqual(3)
    }
  })

  test('its merged shell is built once, not again for each segment that drops in', async () => {
    const level = LevelNode.parse({ level: 0, children: [] })
    useScene.getState().setScene({ [level.id]: level as AnyNode }, [level.id as AnyNodeId], {
      installedPlugins: [],
      hasExplicitPluginInstallState: false,
    })
    clearSceneHistory()
    renderer = await create(
      <>
        <LevelChildren levelId={level.id as AnyNodeId} />
        <RoofSystem />
      </>,
    )
    driver = startConstructionReveal({
      reveals: (commit) => commit.author === 'agent',
      prefersReducedMotion: () => false,
    })
    const roof = RoofNode.parse({ children: [] })
    const segments = [-6, -3, 0, 3, 6].map((x) =>
      RoofSegmentNode.parse({ position: [x, 0, 0], width: 3, depth: 5 }),
    )
    await act(async () => {
      runAsSceneCommitAuthor('agent', () => {
        useScene.getState().createNode(roof as AnyNode, level.id as AnyNodeId)
        useScene
          .getState()
          .createNodes(
            segments.map((node) => ({ node: node as AnyNode, parentId: roof.id as AnyNodeId })),
          )
      })
    })
    // Every shell the roof has worn while it assembled: a new geometry is a new merge.
    const shells = new Set<string>()
    const watch = () => {
      const shell = (part(roof.id, 'merged-roof') as Mesh | undefined)?.geometry
      if (shell && vertices(part(roof.id, 'merged-roof')) > 3) shells.add(shell.uuid)
    }
    while (now < 12_000 && (isRevealAssembling(roof.id) || !root(roof.id))) {
      await frame(20)
      watch()
    }
    await frames(200)
    watch()
    expect(vertices(part(roof.id, 'merged-roof'))).toBeGreaterThan(3)
    expect(shells.size).toBe(1)
  })

  test('an edit to a segment while the roof assembles is still merged in', async () => {
    const { roof, segments } = await buildRoof()
    await until(() => segments.every((segment) => Boolean(root(segment.id))))
    expect(isRevealAssembling(roof.id)).toBe(true)
    const wider = { ...segments[0]!, width: 9 } as AnyNode
    await act(async () => {
      useScene.getState().updateNode(wider.id as AnyNodeId, { width: 9 } as never)
    })
    await until(() => !isRevealAssembling(roof.id))
    await frames(400)
    const shell = part(roof.id, 'merged-roof') as Mesh
    shell.geometry.computeBoundingBox()
    // The shell reaches the widened segment: x from -3 - 4.5 at least.
    expect(shell.geometry.boundingBox!.min.x).toBeLessThan(-7)
  })

  test('a capture mid-assembly sees the whole merged roof, in the same tick', async () => {
    const { roof, segments } = await buildRoof()
    // Mid-assembly with the shell merged: a capture waits for pending roof merges before it clones.
    await until(
      () =>
        segments.some((segment) => Boolean(root(segment.id))) &&
        vertices(part(roof.id, 'merged-roof')) > 3 &&
        isRevealAssembling(roof.id),
    )
    expect(isRevealAssembling(roof.id)).toBe(true)

    // Synchronous, like the capture: no frame runs before the clone.
    emitter.emit('thumbnail:before-capture', undefined)
    expect(part(roof.id, 'merged-roof')?.visible).toBe(true)
    expect(part(roof.id, 'segments-wrapper')?.visible).toBe(false)
    expect(vertices(part(roof.id, 'merged-roof'))).toBeGreaterThan(3)
  })
})
