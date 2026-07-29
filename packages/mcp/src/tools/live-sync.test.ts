import { beforeEach, describe, expect, test } from 'bun:test'
import { WallNode } from '@pascal-app/core/schema'
import useScene from '@pascal-app/core/store'
import { SceneBridge } from '../bridge/scene-bridge'
import { createSceneOperations } from '../operations'
import { InMemorySceneStore } from './scene-lifecycle/test-utils'
import { publishLiveSceneSnapshot } from './live-sync'

function resetScene(): void {
  useScene.getState().unloadScene()
  useScene.temporal.getState().clear()
}

describe('publishLiveSceneSnapshot', () => {
  beforeEach(() => resetScene())

  test('throws when a SceneStore is attached but no active scene is bound', async () => {
    const bridge = new SceneBridge()
    bridge.loadDefault()
    const store = new InMemorySceneStore()
    const operations = createSceneOperations({ bridge, store })

    await expect(
      publishLiveSceneSnapshot(operations, 'test_mutation'),
    ).rejects.toThrow('no_active_scene')
  })

  test('silently returns when no SceneStore is attached (headless mode)', async () => {
    const bridge = new SceneBridge()
    bridge.loadDefault()
    const operations = createSceneOperations({ bridge })

    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const wall = WallNode.parse({ start: [0, 0], end: [5, 0] })
    bridge.createNode(wall, level.id)

    await publishLiveSceneSnapshot(operations, 'create_wall')
  })

  test('persists and emits events when active scene is set', async () => {
    const bridge = new SceneBridge()
    bridge.loadDefault()
    const store = new InMemorySceneStore()
    const operations = createSceneOperations({ bridge, store })

    const graph = { nodes: bridge.getNodes(), rootNodeIds: bridge.getRootNodeIds() }
    const meta = await store.save({
      name: 'Test Scene',
      graph,
      saveMode: 'draft',
      publish: false,
      operation: 'init',
    })
    operations.setActiveScene(meta)

    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const wall = WallNode.parse({ start: [0, 0], end: [5, 0] })
    bridge.createNode(wall, level.id)

    await publishLiveSceneSnapshot(operations, 'create_wall')

    const events = await store.listSceneEvents(meta.id)
    expect(events.length).toBe(1)
    expect(events[0]!.kind).toBe('create_wall')
    expect(events[0]!.version).toBe(2)
  })

  test('increments version on each snapshot', async () => {
    const bridge = new SceneBridge()
    bridge.loadDefault()
    const store = new InMemorySceneStore()
    const operations = createSceneOperations({ bridge, store })

    const graph = { nodes: bridge.getNodes(), rootNodeIds: bridge.getRootNodeIds() }
    const meta = await store.save({
      name: 'Test Scene',
      graph,
      saveMode: 'draft',
      publish: false,
      operation: 'init',
    })
    operations.setActiveScene(meta)

    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!

    const wall1 = WallNode.parse({ start: [0, 0], end: [5, 0] })
    bridge.createNode(wall1, level.id)
    await publishLiveSceneSnapshot(operations, 'create_wall')

    const wall2 = WallNode.parse({ start: [5, 0], end: [5, 4] })
    bridge.createNode(wall2, level.id)
    await publishLiveSceneSnapshot(operations, 'create_wall')

    const events = await store.listSceneEvents(meta.id)
    expect(events.length).toBe(2)
    expect(events[0]!.version).toBe(2)
    expect(events[1]!.version).toBe(3)
  })
})
