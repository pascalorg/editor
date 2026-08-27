import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import {
  createMultiplayerTestHarness,
  type MultiplayerTestHarness,
  healSceneCycles,
  snapshotToYDoc,
  yDocToSnapshot,
} from './multiplayer-test-harness'
import type { AnyNode, AnyNodeId } from '../../schema/types'
import type { SceneSnapshot } from '../../store/history-control'

describe('Tier 2: Boundary & Corner Cases E2E Suite', () => {
  let harness: MultiplayerTestHarness

  beforeEach(async () => {
    harness = await createMultiplayerTestHarness()
  })

  afterEach(async () => {
    if (harness) {
      await harness.cleanup()
    }
  })

  test('B1: should handle empty scene initialization and synchronization gracefully', async () => {
    const emptySnapshot: SceneSnapshot = {
      nodes: {},
      rootNodeIds: [],
      materials: {},
      collections: {},
      installedPlugins: [],
    }

    const emptyHarness = await createMultiplayerTestHarness({ initialSnapshot: emptySnapshot })
    await emptyHarness.assertConvergence()

    expect(emptyHarness.editor.getSnapshot().nodes).toEqual({})
    expect(emptyHarness.viewer.getSnapshot().nodes).toEqual({})
    expect(emptyHarness.viewer.getSnapshot().rootNodeIds).toEqual([])

    await emptyHarness.cleanup()
  })

  test('B2: should synchronize 100+ concurrent nodes created and mutated across multiple clients', async () => {
    const editor2 = await harness.createClient('editor', 'editor-worker-2')
    await harness.syncAll()

    const nodeCount = 120

    // Concurrently create 60 nodes from Editor 1 and 60 nodes from Editor 2
    harness.editor.doc.transact(() => {
      for (let i = 0; i < nodeCount / 2; i++) {
        harness.editor.addNode({
          id: `e1-node-${i}`,
          type: 'item',
          object: 'item',
          name: `Item E1-${i}`,
          position: [i, 0, i],
          parentId: null,
        } as any)
      }
    }, 'local')

    editor2.doc.transact(() => {
      for (let i = 0; i < nodeCount / 2; i++) {
        editor2.addNode({
          id: `e2-node-${i}`,
          type: 'item',
          object: 'item',
          name: `Item E2-${i}`,
          position: [-i, 0, -i],
          parentId: null,
        } as any)
      }
    }, 'local')

    await harness.syncAll(4000)
    await harness.assertConvergence(4000)

    const viewerSnapshot = harness.viewer.getSnapshot()
    expect(Object.keys(viewerSnapshot.nodes).length).toBe(nodeCount)
    expect(viewerSnapshot.rootNodeIds.length).toBe(nodeCount)

    // Verify all IDs exist in viewer
    for (let i = 0; i < nodeCount / 2; i++) {
      expect(viewerSnapshot.nodes[`e1-node-${i}` as AnyNodeId]).toBeDefined()
      expect(viewerSnapshot.nodes[`e2-node-${i}` as AnyNodeId]).toBeDefined()
    }
  })

  test('B3: should buffer and synchronize offline mutations after client reconnects', async () => {
    // 1. Initial node creation
    harness.editor.addNode({
      id: 'node-reconnect',
      type: 'item',
      object: 'item',
      name: 'Initial Name',
      position: [0, 0, 0],
      parentId: null,
    } as any)
    await harness.assertConvergence()

    // 2. Disconnect Viewer
    harness.viewer.disconnect()
    expect(harness.viewer.isConnected).toBe(false)

    // 3. Editor performs mutations while Viewer is offline
    harness.editor.updateNode('node-reconnect', {
      name: 'Offline Updated Name',
      position: [100, 20, 300],
    })
    harness.editor.addNode({
      id: 'node-offline-created',
      type: 'wall',
      object: 'wall',
      start: [0, 0],
      end: [10, 0],
      parentId: null,
    } as any)

    // 4. Reconnect Viewer
    await harness.viewer.connect()
    expect(harness.viewer.isConnected).toBe(true)

    // 5. Assert catch-up convergence
    await harness.assertConvergence()

    const viewerNode1 = harness.viewer.getNode('node-reconnect') as any
    const viewerNode2 = harness.viewer.getNode('node-offline-created') as any

    expect(viewerNode1.name).toBe('Offline Updated Name')
    expect(viewerNode1.position).toEqual([100, 20, 300])
    expect(viewerNode2).toBeDefined()
  })

  test('B4: should withstand rapid burst of 200 consecutive updates without frame drops or corruption', async () => {
    const targetId = 'burst-node-1'
    harness.editor.addNode({
      id: targetId,
      type: 'item',
      object: 'item',
      position: [0, 0, 0],
      rotation: 0,
      parentId: null,
    } as any)
    await harness.assertConvergence()

    const burstCount = 200
    for (let i = 1; i <= burstCount; i++) {
      harness.editor.updateNode(targetId, {
        position: [i * 0.1, i * 0.05, i * 0.2],
        rotation: (i * Math.PI) / 100,
      })
    }

    await harness.assertConvergence(3000)

    const viewerNode = harness.viewer.getNode(targetId) as any
    expect(viewerNode.position).toEqual([burstCount * 0.1, burstCount * 0.05, burstCount * 0.2])
    expect(viewerNode.rotation).toBeCloseTo((burstCount * Math.PI) / 100, 5)
  })

  test('B5: should detect and break circular hierarchy cycles (A -> B -> A) deterministically via Tarjan SCC', async () => {
    // Construct nodes with circular parentId references
    const rawNodes: Record<AnyNodeId, AnyNode> = {
      'site-root': {
        id: 'site-root',
        type: 'site',
        object: 'site',
        name: 'Root Site',
        parentId: null,
        children: ['node-a', 'node-b'],
      } as any,
      'node-a': {
        id: 'node-a',
        type: 'building',
        object: 'building',
        name: 'Node A',
        parentId: 'node-b', // Circular!
        children: ['node-b'],
      } as any,
      'node-b': {
        id: 'node-b',
        type: 'level',
        object: 'level',
        name: 'Node B',
        parentId: 'node-a', // Circular!
        children: [],
      } as any,
    }

    const healed = healSceneCycles(rawNodes, 'site-root' as AnyNodeId)

    // Expected: The node with lexicographically smaller ID ('node-a') has its parentId reset to 'site-root'
    expect(healed.brokenCycleNodes).toContain('node-a')
    expect(healed.nodes['node-a'].parentId).toBe('site-root')
    expect(healed.nodes['node-b'].parentId).toBe('node-a')

    // Symmetry check: children arrays must reflect the new acyclic hierarchy
    expect((healed.nodes['site-root'] as any).children).toContain('node-a')
    expect((healed.nodes['node-a'] as any).children).toContain('node-b')
  })

  test('B6: should auto-heal orphaned child nodes referencing non-existent parentId', async () => {
    const rawNodes: Record<AnyNodeId, AnyNode> = {
      'site-root': {
        id: 'site-root',
        type: 'site',
        object: 'site',
        parentId: null,
        children: [],
      } as any,
      'orphan-wall': {
        id: 'orphan-wall',
        type: 'wall',
        object: 'wall',
        parentId: 'deleted-level-999', // Missing parent!
      } as any,
    }

    const healed = healSceneCycles(rawNodes, 'site-root' as AnyNodeId)

    expect(healed.orphanedNodesRepaired).toContain('orphan-wall')
    expect(healed.nodes['orphan-wall'].parentId).toBe('site-root')
    expect((healed.nodes['site-root'] as any).children).toContain('orphan-wall')
  })

  test('B7: should handle extreme boundary coordinates (large floats, zero, negative)', async () => {
    const extremeNode: AnyNode = {
      id: 'node-extremes',
      type: 'item',
      object: 'item',
      position: [-999999.999, 0, 1e6],
      rotation: -Math.PI * 100,
      scale: [0.0001, 10000, 1],
      parentId: null,
    } as any

    harness.editor.addNode(extremeNode)
    await harness.assertConvergence()

    const viewerNode = harness.viewer.getNode('node-extremes') as any
    expect(viewerNode.position).toEqual([-999999.999, 0, 1e6])
    expect(viewerNode.scale).toEqual([0.0001, 10000, 1])
  })
})
