import { beforeEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  beginScenePreview,
  endScenePreview,
  ItemNode,
  LevelNode,
  runAsSceneCommitAuthor,
  SiteNode,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { ConstructionReveal, useViewer } from '@pascal-app/viewer'
import { act } from '@react-three/test-renderer'
import { BatchedMesh, type Object3D } from 'three'
import { NodeBatchSystem } from '../shared/node-batch/system'
import {
  boxAsset as asset,
  installMountedScene,
  LevelScene,
  mount,
  preloadItemModels,
  SceneSystems,
  settle,
} from './harness'

// Hold to see before (scene preview) for a turn that BUILT: the furniture an agent placed in an
// empty room is not in the "before", so it must not be on screen while the hold is down, whether
// each piece draws itself or the batch draws it for them (the owner, 13 October: the new furniture
// did not disappear).

installMountedScene()

// The batch system reads `?perf` and `?disable` from the page URL.
beforeEach(() => {
  Object.assign(globalThis.window, { location: { search: '' } })
})

const site = SiteNode.parse({})
const building = BuildingNode.parse({ parentId: site.id })
const level = LevelNode.parse({ parentId: building.id })
const PIECES = 6

function furniture(index: number) {
  return ItemNode.parse({
    id: `item_piece_${index}`,
    parentId: level.id,
    position: [1 + index * 0.6, 0, 2],
    asset: { ...asset, id: 'preview-chair', category: 'chair' },
  })
}

function seedEmptyRoom() {
  useScene.setState({
    nodes: {
      [site.id]: { ...site, children: [building.id] },
      [building.id]: { ...building, children: [level.id] },
      [level.id]: { ...level, children: [] },
    } as unknown as Record<AnyNodeId, AnyNode>,
    rootNodeIds: [site.id],
    dirtyNodes: new Set(),
    readOnly: false,
    materials: {},
    collections: {},
    installedPlugins: [],
  })
  useScene.temporal.getState().clear()
  useScene.temporal.getState().resume()
  useViewer.setState({
    textures: false,
    selection: { buildingId: building.id, levelId: level.id, zoneId: null, selectedIds: [] },
  })
}

function agentFurnishes() {
  useScene.getState().createNodes(
    Array.from({ length: PIECES }, (_, i) => ({
      node: furniture(i),
      parentId: level.id,
    })) as never,
  )
}

const ids = Array.from({ length: PIECES }, (_, i) => `item_piece_${i}`)
const registered = () => ids.filter((id) => sceneRegistry.nodes.has(id as AnyNodeId))

/** Instances a batch still draws, anywhere under the mounted scene. */
function visibleBatchedInstances() {
  let count = 0
  const root = sceneRegistry.nodes.get(level.id) as Object3D
  root.traverse((object) => {
    if (!(object instanceof BatchedMesh) || !object.visible) return
    for (let i = 0; i < object.instanceCount; i++) {
      try {
        if (object.getVisibleAt(i)) count++
      } catch {}
    }
  })
  return count
}

test('the pieces are not on screen while the before is held, and are back after', async () => {
  seedEmptyRoom()
  await preloadItemModels()
  const renderer = await mount(
    <>
      <LevelScene level={level} />
      <SceneSystems />
    </>,
  )
  await settle(renderer)
  expect(registered()).toHaveLength(0)

  await act(async () => agentFurnishes())
  await preloadItemModels()
  await settle(renderer, 6)
  expect(registered()).toHaveLength(PIECES)

  const before = useScene.temporal.getState().pastStates[0] as never
  expect(before).toBeDefined()
  const preview = beginScenePreview(before)
  expect(preview).not.toBeNull()
  await settle(renderer, 6)
  expect(registered()).toHaveLength(0)

  preview?.end()
  await preloadItemModels()
  await settle(renderer, 6)
  expect(registered()).toHaveLength(PIECES)
})

test('batched pieces leave the screen with the hold too', async () => {
  seedEmptyRoom()
  await preloadItemModels()
  const renderer = await mount(
    <>
      <LevelScene level={level} />
      <SceneSystems />
      <NodeBatchSystem />
    </>,
  )
  await settle(renderer)
  await act(async () => agentFurnishes())
  await preloadItemModels()
  // Past the quiet window the batch waits for, so the pieces are joined into it.
  await settle(renderer, 30)
  const drawn = visibleBatchedInstances()
  expect(drawn).toBeGreaterThan(0)

  const before = useScene.temporal.getState().pastStates[0] as never
  const preview = beginScenePreview(before)
  expect(preview).not.toBeNull()
  await settle(renderer, 30)
  expect(registered()).toHaveLength(0)
  expect(visibleBatchedInstances()).toBe(0)

  preview?.end()
  endScenePreview()
})

test('a build the construction reveal played is out of the before too', async () => {
  seedEmptyRoom()
  await preloadItemModels()
  const renderer = await mount(
    <>
      <LevelScene level={level} />
      <SceneSystems />
      <NodeBatchSystem />
      <ConstructionReveal level="full" reveals={(commit) => commit.author === 'agent'} />
    </>,
  )
  await settle(renderer)
  await act(async () => runAsSceneCommitAuthor('agent', agentFurnishes))
  await preloadItemModels()
  // The reveal's own turns, then the batch's quiet window.
  await settle(renderer, 400)
  expect(registered()).toHaveLength(PIECES)

  const before = useScene.temporal.getState().pastStates[0] as never
  const preview = beginScenePreview(before)
  expect(preview).not.toBeNull()
  await settle(renderer, 30)
  expect(registered()).toHaveLength(0)
  expect(visibleBatchedInstances()).toBe(0)
  preview?.end()
  endScenePreview()
})
