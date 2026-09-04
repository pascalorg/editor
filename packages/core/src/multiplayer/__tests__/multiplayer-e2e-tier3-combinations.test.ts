import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import {
  createMultiplayerTestHarness,
  type MultiplayerTestHarness,
} from './multiplayer-test-harness'
import type { AnyNode } from '../../schema/types'

describe('Tier 3: Cross-Feature Combinations E2E Suite', () => {
  let harness: MultiplayerTestHarness

  beforeEach(async () => {
    harness = await createMultiplayerTestHarness()
  })

  afterEach(async () => {
    if (harness) {
      await harness.cleanup()
    }
  })

  test('C1: Editor moving object while Viewer selects that object', async () => {
    const node: AnyNode = {
      id: 'target-c1',
      type: 'item',
      object: 'item',
      name: 'Shared Table',
      position: [0, 0, 0],
      parentId: null,
    } as any

    harness.editor.addNode(node)
    await harness.assertConvergence()

    // 1. Viewer selects the object
    harness.viewer.setSelection(['target-c1'])

    // 2. Editor streams live drag transforms and commits new position
    harness.editor.setLiveDrag('target-c1', { position: [10, 0, 5] })
    harness.editor.translateNode('target-c1', [10, 0, 5])
    harness.editor.clearLiveDrag()

    await harness.assertConvergence()

    // Viewer selection must remain intact while position updates live
    const states = Array.from(harness.editor.awareness.getStates().values())
    const viewerPresence = states.find((s) => s.user?.role === 'viewer')
    expect(viewerPresence?.selection?.selectedNodeIds).toContain('target-c1')

    const viewerNode = harness.viewer.getNode('target-c1') as any
    expect(viewerNode.position).toEqual([10, 0, 5])
  })

  test('C2: Concurrent property rename by Editor 1 while Editor 2 transforms position', async () => {
    const editor2 = await harness.createClient('editor', 'editor-2')
    await harness.syncAll()

    const node: AnyNode = {
      id: 'shared-node-c2',
      type: 'item',
      object: 'item',
      name: 'Initial Name',
      position: [0, 0, 0],
      parentId: null,
    } as any

    harness.editor.addNode(node)
    await harness.syncAll()

    // Concurrent disjoint writes
    harness.editor.updateNode('shared-node-c2', { name: 'Renamed by E1' })
    editor2.translateNode('shared-node-c2', [50, 0, -25])

    await harness.syncAll()

    const viewerNode = harness.viewer.getNode('shared-node-c2') as any
    expect(viewerNode.name).toBe('Renamed by E1')
    expect(viewerNode.position).toEqual([50, 0, -25])
  })

  test('C3: Simultaneous deletion and property update: deletion cleanly wins without resurrection', async () => {
    const editor2 = await harness.createClient('editor', 'editor-2')
    await harness.syncAll()

    const node: AnyNode = {
      id: 'del-race-node',
      type: 'item',
      object: 'item',
      name: 'To Be Deleted',
      parentId: null,
    } as any

    harness.editor.addNode(node)
    await harness.syncAll()

    // Editor 1 deletes the node while Editor 2 updates it
    harness.editor.deleteNode('del-race-node')
    editor2.updateNode('del-race-node', { name: 'Late Update' })

    await harness.syncAll()

    // Deletion should converge cleanly without ghost nodes or errors
    const viewerNode = harness.viewer.getNode('del-race-node')
    expect(viewerNode).toBeUndefined()
  })

  test('C4: Collaborative Undo Isolation: Editor 1 undoes local action without reverting Editor 2 action', async () => {
    const editor2 = await harness.createClient('editor', 'editor-2')
    await harness.syncAll()

    // 1. Initial base node
    harness.editor.addNode({ id: 'base-item', type: 'item', object: 'item', position: [0, 0, 0], parentId: null } as any)
    harness.editor.stopCapturing()
    await harness.syncAll()

    // 2. Editor 1 moves the base item
    harness.editor.translateNode('base-item', [10, 0, 0])
    harness.editor.stopCapturing()
    await harness.syncAll()

    // 3. Editor 2 creates a new wall
    editor2.addNode({ id: 'e2-wall', type: 'wall', object: 'wall', start: [0, 0], end: [5, 0], parentId: null } as any)
    await harness.syncAll()

    expect((harness.viewer.getNode('base-item') as any).position).toEqual([10, 0, 0])
    expect(harness.viewer.getNode('e2-wall')).toBeDefined()

    // 4. Editor 1 triggers undo (Ctrl+Z)
    harness.editor.undo()
    await harness.syncAll()

    // Editor 1 move is reverted back to [0, 0, 0]
    expect((harness.viewer.getNode('base-item') as any).position).toEqual([0, 0, 0])
    // CRITICAL: Editor 2 wall is NOT reverted!
    expect(harness.viewer.getNode('e2-wall')).toBeDefined()
  })

  test('C5: Compound atomic room operation undoes in a single step', async () => {
    // Editor creates 4 walls and 1 slab in a single compound transaction
    harness.editor.doc.transact(() => {
      harness.editor.addNode({ id: 'wall-n', type: 'wall', object: 'wall', start: [0, 0], end: [10, 0], parentId: null } as any)
      harness.editor.addNode({ id: 'wall-e', type: 'wall', object: 'wall', start: [10, 0], end: [10, 8], parentId: null } as any)
      harness.editor.addNode({ id: 'wall-s', type: 'wall', object: 'wall', start: [10, 8], end: [0, 8], parentId: null } as any)
      harness.editor.addNode({ id: 'wall-w', type: 'wall', object: 'wall', start: [0, 8], end: [0, 0], parentId: null } as any)
      harness.editor.addNode({ id: 'slab-room', type: 'slab', object: 'slab', thickness: 0.2, parentId: null } as any)
    }, 'local')

    await harness.assertConvergence()

    expect(harness.viewer.getNode('wall-n')).toBeDefined()
    expect(harness.viewer.getNode('wall-e')).toBeDefined()
    expect(harness.viewer.getNode('wall-s')).toBeDefined()
    expect(harness.viewer.getNode('wall-w')).toBeDefined()
    expect(harness.viewer.getNode('slab-room')).toBeDefined()

    // Undo the single compound step
    harness.editor.undo()
    await harness.assertConvergence()

    expect(harness.viewer.getNode('wall-n')).toBeUndefined()
    expect(harness.viewer.getNode('wall-e')).toBeUndefined()
    expect(harness.viewer.getNode('wall-s')).toBeUndefined()
    expect(harness.viewer.getNode('wall-w')).toBeUndefined()
    expect(harness.viewer.getNode('slab-room')).toBeUndefined()
  })

  test('C6: Concurrent disjoint sub-property updates on the same wall merge cleanly', async () => {
    const editor2 = await harness.createClient('editor', 'editor-2')
    await harness.syncAll()

    harness.editor.addNode({
      id: 'shared-wall-c6',
      type: 'wall',
      object: 'wall',
      height: 2.5,
      thickness: 0.15,
      parentId: null,
    } as any)
    await harness.syncAll()

    // Editor 1 changes height, Editor 2 changes thickness
    harness.editor.updateNode('shared-wall-c6', { height: 3.8 })
    editor2.updateNode('shared-wall-c6', { thickness: 0.3 })

    await harness.syncAll()

    const viewerWall = harness.viewer.getNode('shared-wall-c6') as any
    expect(viewerWall.height).toBe(3.8)
    expect(viewerWall.thickness).toBe(0.3)
  })
})
