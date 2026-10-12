import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeDefinition,
  type AnyNodeId,
  BaseNode,
  clearSceneHistory,
  LevelNode,
  loadPlugin,
  nodeRegistry,
  nodeType,
  objectId,
  sceneRegistry,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import { act, create } from '@react-three/test-renderer'
import { useLayoutEffect, useRef } from 'react'

import { BoxGeometry, Group, Mesh } from 'three'
import { NodeRenderer } from '../components/renderers/node-renderer'
import { RegisteredSystems } from '../components/viewer/registered-systems'
import { FloorElevationSystem } from '../systems/floor-elevation/floor-elevation-system'
import { GeometrySystem } from '../systems/geometry/geometry-system'
import { countPendingSceneBuild, pendingSceneBuildNodeIds } from './pending-scene-build'

// A capture waits for the scene to be built: the dirty nodes a system still has to settle. A
// plugin kind that declares its own `system` is expected to clear its own marks (plugin-trees
// does, in a priority-2 pass); the pool plugin's system only syncs other nodes and never does, so
// a scene with a pool never reads built and an interior capture is refused as "still building"
// for good. The viewer cannot depend on a plugin package, so the pool's contract stands in for
// it: a floorPlaced capability, a system, a custom renderer that marks its node dirty on mount,
// and no geometry. The viewer's own systems run for real.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const PLUGIN_ID = 'fixture:pool-plugin'
const base = { object: 'node', parentId: null, visible: true, metadata: {} } as const
const Children = { children: LevelNode.shape.children }

const WallSchema = BaseNode.extend({
  id: objectId('fxwall'),
  type: nodeType('fixture:wall'),
  ...Children,
})
const PoolSchema = BaseNode.extend({
  id: objectId('fxpool'),
  type: nodeType('fixture:pool'),
  position: LevelNode.shape.children
    .optional()
    .transform(() => [0, 0, 0] as [number, number, number]),
  ...Children,
})

function PoolRenderer({ node }: { node: AnyNode }) {
  const ref = useRef<Group>(null!)
  useRegistry(node.id, node.type, ref)
  // plugin-pool's renderer: marks its node dirty on mount
  useLayoutEffect(() => {
    useScene.getState().markDirty(node.id as AnyNodeId)
  }, [node.id])
  return <group ref={ref} />
}

/** The plugin's system: syncs other nodes; never clears a mark (plugin-pool's opening system). */
function SyncOnlyPoolSystem() {
  useFrame(() => {}, 3)
  return null
}

/** What plugin-trees does for its own kind: a priority-2 pass that clears its registered nodes' marks. */
function ClearingPoolSystem() {
  useFrame(() => {
    const { dirtyNodes, nodes, clearDirty } = useScene.getState()
    for (const id of dirtyNodes) {
      if ((nodes[id]?.type as string) !== 'fixture:pool') continue
      if (sceneRegistry.nodes.has(id)) clearDirty(id)
    }
  }, 2)
  return null
}

function registerKinds(poolSystem: () => null) {
  const wall = {
    kind: 'fixture:wall',
    schemaVersion: 1,
    schema: WallSchema,
    category: 'structure',
    defaults: () => base,
    capabilities: {},
    geometry: () => new Group().add(new Mesh(new BoxGeometry(4, 2.5, 0.2))),
  } as unknown as AnyNodeDefinition
  const pool = {
    kind: 'fixture:pool',
    schemaVersion: 1,
    schema: PoolSchema,
    category: 'furnish',
    defaults: () => ({ ...base, position: [0, 0, 0] }),
    capabilities: {
      floorPlaced: { footprint: () => ({ dimensions: [4, 1.5, 13], rotation: [0, 0, 0] }) },
    },
    renderer: { kind: 'parametric', module: async () => ({ default: PoolRenderer }) },
    system: { module: async () => ({ default: poolSystem }), priority: 3 },
  } as unknown as AnyNodeDefinition
  loadPlugin({ id: PLUGIN_ID, apiVersion: 1, nodes: [wall, pool] } as never)
}

function Systems() {
  return (
    <>
      <FloorElevationSystem />
      <GeometrySystem />
      <RegisteredSystems />
    </>
  )
}

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
let restoreRegistry: () => void = () => {}
const previousScene = useScene.getState()
const rootGroup = new Group()
let levelId: AnyNodeId
let wallIds: AnyNodeId[]
let poolId: AnyNodeId

async function mountOwnersKinds(poolSystem: () => null) {
  registerKinds(poolSystem)
  const level = LevelNode.parse({ level: 0, children: [] })
  const walls = [0, 1].map(() => WallSchema.parse({ ...base }) as AnyNode)
  const pool = PoolSchema.parse({ ...base }) as AnyNode
  const nodes: Record<string, AnyNode> = {
    [level.id]: { ...level, children: [...walls.map((w) => w.id), pool.id] } as AnyNode,
  }
  for (const node of [...walls, pool]) nodes[node.id] = { ...node, parentId: level.id } as AnyNode
  useScene.getState().setScene(nodes, [level.id] as AnyNodeId[], {
    installedPlugins: [PLUGIN_ID],
    hasExplicitPluginInstallState: true,
  })
  clearSceneHistory()
  levelId = level.id as AnyNodeId
  wallIds = walls.map((wall) => wall.id as AnyNodeId)
  poolId = pool.id as AnyNodeId
  // the scene's root is mounted (a site, in the project): the gate's first test
  sceneRegistry.nodes.set(levelId, rootGroup)
  await act(async () => {
    renderer = await create(
      <>
        <LevelChildren levelId={levelId} />
        <Systems />
      </>,
    )
  })
}

async function frames(count: number) {
  await act(async () => {
    await renderer?.advanceFrames(count, 1 / 60)
  })
}

beforeEach(() => {
  restoreRegistry = nodeRegistry._snapshot()
})

afterEach(async () => {
  await act(async () => {
    await renderer?.unmount()
  })
  renderer = null
  sceneRegistry.nodes.delete(levelId)
  restoreRegistry()
  useScene.setState(previousScene, true)
})

describe('what a capture waits for', () => {
  test('control: a plugin system that clears its own marks leaves nothing pending', async () => {
    await mountOwnersKinds(ClearingPoolSystem)
    await frames(10)

    expect(pendingSceneBuildNodeIds().size).toBe(0)
    expect(countPendingSceneBuild(0)).toBe(0)
  })

  test('a plugin kind that never clears its mark holds the count for good, whatever frames run', async () => {
    await mountOwnersKinds(SyncOnlyPoolSystem)
    await frames(10)

    // the host's own kinds settled: the walls are built and cleared
    for (const id of wallIds) expect(useScene.getState().dirtyNodes.has(id)).toBe(false)
    // the pool's mark stands, and it alone holds the count
    expect([...pendingSceneBuildNodeIds()]).toEqual([poolId])
    expect(countPendingSceneBuild(0)).toBe(1)

    await frames(600)
    expect(countPendingSceneBuild(0)).toBe(1)
  })

  test('nodes set aside as unsettled stop counting, and nothing else does', async () => {
    await mountOwnersKinds(SyncOnlyPoolSystem)
    await frames(10)
    const unsettled = new Set(pendingSceneBuildNodeIds())
    expect(countPendingSceneBuild(0, unsettled)).toBe(0)

    // a wall dirtied after the wait is genuinely building: it counts, with the pool set aside
    await act(async () => {
      useScene.getState().markDirty(wallIds[0]!)
    })
    expect(countPendingSceneBuild(0, unsettled)).toBe(1)
    // and so does a roof merge, which is no node
    expect(countPendingSceneBuild(1, unsettled)).toBe(2)
  })

  test('a scene whose root has not mounted is never built, set aside or not', async () => {
    await mountOwnersKinds(SyncOnlyPoolSystem)
    await frames(10)
    const unsettled = new Set(pendingSceneBuildNodeIds())
    sceneRegistry.nodes.delete(levelId)

    expect(countPendingSceneBuild(0, unsettled)).toBe(1)
  })
})
