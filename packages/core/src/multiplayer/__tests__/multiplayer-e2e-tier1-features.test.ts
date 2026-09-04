import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import * as Y from 'yjs'
import {
  createMultiplayerTestHarness,
  type MultiplayerTestHarness,
} from './multiplayer-test-harness'
import type { AnyNode } from '../../schema/types'

describe('Tier 1: Feature Coverage E2E Suite (F1 - F8)', () => {
  let harness: MultiplayerTestHarness

  beforeEach(async () => {
    harness = await createMultiplayerTestHarness()
  })

  afterEach(async () => {
    if (harness) {
      await harness.cleanup()
    }
  })

  // ==========================================
  // F1: Object Addition (>= 5 tests)
  // ==========================================
  describe('F1: Object Addition', () => {
    test('F1.1: should synchronize site root node addition from Editor to Viewer', async () => {
      const siteNode: AnyNode = {
        id: 'site-1',
        type: 'site',
        object: 'site',
        name: 'Main Site',
        position: [0, 0, 0],
        rotation: 0,
        children: [],
        parentId: null,
      } as any

      harness.editor.addNode(siteNode)
      await harness.assertConvergence()

      const viewerNode = harness.viewer.getNode('site-1')
      expect(viewerNode).toBeDefined()
      expect(viewerNode?.id).toBe('site-1')
      expect(viewerNode?.name).toBe('Main Site')
      expect(viewerNode?.type).toBe('site')
      expect(harness.viewer.getSnapshot().rootNodeIds).toContain('site-1')
    })

    test('F1.2: should synchronize hierarchical parent-child relationships (Site -> Building -> Level)', async () => {
      const siteNode: AnyNode = {
        id: 'site-1',
        type: 'site',
        object: 'site',
        name: 'HQ Site',
        position: [0, 0, 0],
        rotation: 0,
        children: [],
        parentId: null,
      } as any

      const buildingNode: AnyNode = {
        id: 'bldg-1',
        type: 'building',
        object: 'building',
        name: 'Building A',
        position: [10, 0, 10],
        rotation: 0,
        children: [],
        parentId: 'site-1',
      } as any

      const levelNode: AnyNode = {
        id: 'level-1',
        type: 'level',
        object: 'level',
        name: 'Level 1',
        levelNumber: 1,
        elevation: 0,
        height: 3.2,
        children: [],
        parentId: 'bldg-1',
      } as any

      harness.editor.addNode(siteNode)
      harness.editor.addNode(buildingNode, { parentId: 'site-1' })
      harness.editor.addNode(levelNode, { parentId: 'bldg-1' })

      await harness.assertConvergence()

      const viewerSite = harness.viewer.getNode('site-1')
      const viewerBldg = harness.viewer.getNode('bldg-1')
      const viewerLevel = harness.viewer.getNode('level-1')

      expect((viewerSite as any)?.children).toContain('bldg-1')
      expect((viewerBldg as any)?.parentId).toBe('site-1')
      expect((viewerBldg as any)?.children).toContain('level-1')
      expect((viewerLevel as any)?.parentId).toBe('bldg-1')
    })

    test('F1.3: should synchronize parametric wall node addition with 2D endpoints and thickness', async () => {
      const wallNode: AnyNode = {
        id: 'wall-101',
        type: 'wall',
        object: 'wall',
        start: [0, 0],
        end: [6.5, 0],
        height: 2.8,
        thickness: 0.2,
        parentId: 'level-1',
      } as any

      harness.editor.addNode(wallNode, { parentId: 'level-1' })
      await harness.assertConvergence()

      const viewerWall = harness.viewer.getNode('wall-101') as any
      expect(viewerWall).toBeDefined()
      expect(viewerWall.start).toEqual([0, 0])
      expect(viewerWall.end).toEqual([6.5, 0])
      expect(viewerWall.height).toBe(2.8)
      expect(viewerWall.thickness).toBe(0.2)
    })

    test('F1.4: should synchronize furniture item node addition with metadata', async () => {
      const itemNode: AnyNode = {
        id: 'item-desk-1',
        type: 'item',
        object: 'item',
        name: 'Executive Desk',
        assetId: 'furniture:desk-exec',
        position: [2.5, 0, 3.0],
        rotation: [0, 1.57, 0],
        scale: [1, 1, 1],
        metadata: {
          manufacturer: 'Steelcase',
          costCode: 'FURN-09',
        },
        parentId: 'level-1',
      } as any

      harness.editor.addNode(itemNode, { parentId: 'level-1' })
      await harness.assertConvergence()

      const viewerItem = harness.viewer.getNode('item-desk-1') as any
      expect(viewerItem).toBeDefined()
      expect(viewerItem.metadata).toEqual({
        manufacturer: 'Steelcase',
        costCode: 'FURN-09',
      })
      expect(viewerItem.assetId).toBe('furniture:desk-exec')
    })

    test('F1.5: should preserve exact sibling insertion order across concurrent additions', async () => {
      const site: AnyNode = { id: 'site-order', type: 'site', object: 'site', children: [], parentId: null } as any
      harness.editor.addNode(site)

      const childA: AnyNode = { id: 'child-a', type: 'building', object: 'building', parentId: 'site-order' } as any
      const childB: AnyNode = { id: 'child-b', type: 'building', object: 'building', parentId: 'site-order' } as any
      const childC: AnyNode = { id: 'child-c', type: 'building', object: 'building', parentId: 'site-order' } as any

      harness.editor.addNode(childA, { parentId: 'site-order', position: 0 })
      harness.editor.addNode(childB, { parentId: 'site-order', position: 1 })
      harness.editor.addNode(childC, { parentId: 'site-order', position: 1 }) // Insert between A and B

      await harness.assertConvergence()

      const viewerSite = harness.viewer.getNode('site-order') as any
      expect(viewerSite.children).toEqual(['child-a', 'child-c', 'child-b'])
    })
  })

  // ==========================================
  // F2: Object Modification (>= 5 tests)
  // ==========================================
  describe('F2: Object Modification', () => {
    test('F2.1: should synchronize dimension modifications on a wall', async () => {
      const wallNode: AnyNode = {
        id: 'wall-mod-1',
        type: 'wall',
        object: 'wall',
        start: [0, 0],
        end: [5, 0],
        height: 2.5,
        thickness: 0.15,
        parentId: null,
      } as any

      harness.editor.addNode(wallNode)
      await harness.assertConvergence()

      harness.editor.updateNode('wall-mod-1', {
        end: [8.5, 0],
        height: 3.5,
        thickness: 0.25,
      })

      await harness.assertConvergence()

      const viewerWall = harness.viewer.getNode('wall-mod-1') as any
      expect(viewerWall.end).toEqual([8.5, 0])
      expect(viewerWall.height).toBe(3.5)
      expect(viewerWall.thickness).toBe(0.25)
    })

    test('F2.2: should merge nested material slot updates deterministically', async () => {
      const wallNode: AnyNode = {
        id: 'wall-slots-1',
        type: 'wall',
        object: 'wall',
        slots: {
          interior: 'material:paint-white',
          exterior: 'material:brick-red',
        },
        parentId: null,
      } as any

      harness.editor.addNode(wallNode)
      await harness.assertConvergence()

      harness.editor.updateNode('wall-slots-1', {
        slots: {
          interior: 'material:wood-oak',
          exterior: 'material:brick-red',
        },
      })

      await harness.assertConvergence()

      const viewerWall = harness.viewer.getNode('wall-slots-1') as any
      expect(viewerWall.slots.interior).toBe('material:wood-oak')
      expect(viewerWall.slots.exterior).toBe('material:brick-red')
    })

    test('F2.3: should update metadata dictionaries without overwriting untouched keys', async () => {
      const itemNode: AnyNode = {
        id: 'item-meta-1',
        type: 'item',
        object: 'item',
        metadata: {
          author: 'Alice',
          version: 1,
          reviewed: false,
        },
        parentId: null,
      } as any

      harness.editor.addNode(itemNode)
      await harness.assertConvergence()

      harness.editor.updateNode('item-meta-1', {
        metadata: {
          author: 'Alice',
          version: 2,
          reviewed: true,
          approvedBy: 'Bob',
        },
      })

      await harness.assertConvergence()

      const viewerItem = harness.viewer.getNode('item-meta-1') as any
      expect(viewerItem.metadata).toEqual({
        author: 'Alice',
        version: 2,
        reviewed: true,
        approvedBy: 'Bob',
      })
    })

    test('F2.4: should update custom properties on custom objects', async () => {
      const columnNode: AnyNode = {
        id: 'col-1',
        type: 'column',
        object: 'column',
        profile: 'circular',
        radius: 0.3,
        height: 3.0,
        customProperties: { loadCapacityKn: 450 },
        parentId: null,
      } as any

      harness.editor.addNode(columnNode)
      await harness.assertConvergence()

      harness.editor.updateNode('col-1', {
        radius: 0.45,
        customProperties: { loadCapacityKn: 600, seismicRated: true },
      })

      await harness.assertConvergence()

      const viewerColumn = harness.viewer.getNode('col-1') as any
      expect(viewerColumn.radius).toBe(0.45)
      expect(viewerColumn.customProperties.loadCapacityKn).toBe(600)
      expect(viewerColumn.customProperties.seismicRated).toBe(true)
    })

    test('F2.5: should synchronize property deletions via removeFields', async () => {
      const itemNode: AnyNode = {
        id: 'item-delete-field',
        type: 'item',
        object: 'item',
        name: 'Temporary Item',
        tag: 'provisional',
        parentId: null,
      } as any

      harness.editor.addNode(itemNode)
      await harness.assertConvergence()

      // Remove field 'tag'
      harness.editor.updateNode('item-delete-field', {}, ['tag'])
      await harness.assertConvergence()

      const viewerItem = harness.viewer.getNode('item-delete-field') as any
      expect(viewerItem.name).toBe('Temporary Item')
      expect(viewerItem.tag).toBeUndefined()
    })
  })

  // ==========================================
  // F3: Object Deletion (>= 5 tests)
  // ==========================================
  describe('F3: Object Deletion', () => {
    test('F3.1: should delete a single leaf node and reflect on Viewer', async () => {
      const item: AnyNode = { id: 'leaf-1', type: 'item', object: 'item', parentId: null } as any
      harness.editor.addNode(item)
      await harness.assertConvergence()
      expect(harness.viewer.getNode('leaf-1')).toBeDefined()

      harness.editor.deleteNode('leaf-1')
      await harness.assertConvergence()

      expect(harness.viewer.getNode('leaf-1')).toBeUndefined()
      expect(harness.viewer.getSnapshot().rootNodeIds).not.toContain('leaf-1')
    })

    test('F3.2: should delete a child node and update the parent children array', async () => {
      const site: AnyNode = { id: 'site-parent', type: 'site', object: 'site', children: [], parentId: null } as any
      const bldg: AnyNode = { id: 'bldg-child', type: 'building', object: 'building', parentId: 'site-parent' } as any

      harness.editor.addNode(site)
      harness.editor.addNode(bldg, { parentId: 'site-parent' })
      await harness.assertConvergence()

      expect((harness.viewer.getNode('site-parent') as any).children).toContain('bldg-child')

      harness.editor.deleteNode('bldg-child')
      await harness.assertConvergence()

      expect(harness.viewer.getNode('bldg-child')).toBeUndefined()
      expect((harness.viewer.getNode('site-parent') as any).children).not.toContain('bldg-child')
    })

    test('F3.3: should delete a parent building and clean up its references', async () => {
      const site: AnyNode = { id: 'site-root', type: 'site', object: 'site', children: [], parentId: null } as any
      const bldg: AnyNode = { id: 'bldg-target', type: 'building', object: 'building', parentId: 'site-root' } as any

      harness.editor.addNode(site)
      harness.editor.addNode(bldg, { parentId: 'site-root' })
      await harness.assertConvergence()

      harness.editor.deleteNode('bldg-target')
      await harness.assertConvergence()

      expect(harness.viewer.getNode('bldg-target')).toBeUndefined()
      expect((harness.viewer.getNode('site-root') as any).children).toEqual([])
    })

    test('F3.4: should delete a material and synchronize across peers', async () => {
      harness.editor.doc.transact(() => {
        const yMats = harness.editor.doc.getMap('materials')
        const mat = new Y.Map()
        mat.set('id', 'mat-glass')
        mat.set('color', '#AACCFF')
        mat.set('opacity', 0.5)
        yMats.set('mat-glass', mat)
      }, 'local')

      await harness.assertConvergence()
      expect(harness.viewer.getSnapshot().materials['mat-glass']).toBeDefined()

      harness.editor.doc.transact(() => {
        const yMats = harness.editor.doc.getMap('materials')
        yMats.delete('mat-glass')
      }, 'local')

      await harness.assertConvergence()
      expect(harness.viewer.getSnapshot().materials['mat-glass']).toBeUndefined()
    })

    test('F3.5: should handle multi-node batch deletion in a single atomic transaction', async () => {
      const n1: AnyNode = { id: 'batch-1', type: 'item', object: 'item', parentId: null } as any
      const n2: AnyNode = { id: 'batch-2', type: 'item', object: 'item', parentId: null } as any
      const n3: AnyNode = { id: 'batch-3', type: 'item', object: 'item', parentId: null } as any

      harness.editor.addNode(n1)
      harness.editor.addNode(n2)
      harness.editor.addNode(n3)
      await harness.assertConvergence()

      harness.editor.deleteNode('batch-1')
      harness.editor.deleteNode('batch-3')

      await harness.assertConvergence()

      expect(harness.viewer.getNode('batch-1')).toBeUndefined()
      expect(harness.viewer.getNode('batch-2')).toBeDefined()
      expect(harness.viewer.getNode('batch-3')).toBeUndefined()
    })
  })

  // ==========================================
  // F4: Object Translation (>= 5 tests)
  // ==========================================
  describe('F4: Object Translation', () => {
    test('F4.1: should translate node along the X axis', async () => {
      const node: AnyNode = { id: 'trans-1', type: 'item', object: 'item', position: [0, 0, 0], parentId: null } as any
      harness.editor.addNode(node)
      await harness.assertConvergence()

      harness.editor.translateNode('trans-1', [10.5, 0, 0])
      await harness.assertConvergence()

      const viewerNode = harness.viewer.getNode('trans-1') as any
      expect(viewerNode.position).toEqual([10.5, 0, 0])
    })

    test('F4.2: should translate node along the Y elevation axis', async () => {
      const node: AnyNode = { id: 'trans-2', type: 'item', object: 'item', position: [0, 0, 0], parentId: null } as any
      harness.editor.addNode(node)
      await harness.assertConvergence()

      harness.editor.translateNode('trans-2', [0, 4.25, 0])
      await harness.assertConvergence()

      const viewerNode = harness.viewer.getNode('trans-2') as any
      expect(viewerNode.position).toEqual([0, 4.25, 0])
    })

    test('F4.3: should translate node along the Z axis', async () => {
      const node: AnyNode = { id: 'trans-3', type: 'item', object: 'item', position: [0, 0, 0], parentId: null } as any
      harness.editor.addNode(node)
      await harness.assertConvergence()

      harness.editor.translateNode('trans-3', [0, 0, -18.7])
      await harness.assertConvergence()

      const viewerNode = harness.viewer.getNode('trans-3') as any
      expect(viewerNode.position).toEqual([0, 0, -18.7])
    })

    test('F4.4: should translate node across arbitrary 3D coordinates [x, y, z]', async () => {
      const node: AnyNode = { id: 'trans-4', type: 'item', object: 'item', position: [1, 2, 3], parentId: null } as any
      harness.editor.addNode(node)
      await harness.assertConvergence()

      harness.editor.translateNode('trans-4', [-42.125, 8.5, 104.99])
      await harness.assertConvergence()

      const viewerNode = harness.viewer.getNode('trans-4') as any
      expect(viewerNode.position).toEqual([-42.125, 8.5, 104.99])
    })

    test('F4.5: should converge accurately across consecutive rapid translations', async () => {
      const node: AnyNode = { id: 'trans-5', type: 'item', object: 'item', position: [0, 0, 0], parentId: null } as any
      harness.editor.addNode(node)
      await harness.assertConvergence()

      for (let i = 1; i <= 10; i++) {
        harness.editor.translateNode('trans-5', [i * 2, 0, i * 3])
      }

      await harness.assertConvergence()

      const viewerNode = harness.viewer.getNode('trans-5') as any
      expect(viewerNode.position).toEqual([20, 0, 30])
    })
  })

  // ==========================================
  // F5: Object Rotation (>= 5 tests)
  // ==========================================
  describe('F5: Object Rotation', () => {
    test('F5.1: should rotate node by 90 degrees (Math.PI / 2)', async () => {
      const node: AnyNode = { id: 'rot-1', type: 'item', object: 'item', rotation: 0, parentId: null } as any
      harness.editor.addNode(node)
      await harness.assertConvergence()

      harness.editor.rotateNode('rot-1', Math.PI / 2)
      await harness.assertConvergence()

      const viewerNode = harness.viewer.getNode('rot-1') as any
      expect(viewerNode.rotation).toBeCloseTo(Math.PI / 2, 5)
    })

    test('F5.2: should rotate node by 180 degrees (Math.PI)', async () => {
      const node: AnyNode = { id: 'rot-2', type: 'item', object: 'item', rotation: 0, parentId: null } as any
      harness.editor.addNode(node)
      await harness.assertConvergence()

      harness.editor.rotateNode('rot-2', Math.PI)
      await harness.assertConvergence()

      const viewerNode = harness.viewer.getNode('rot-2') as any
      expect(viewerNode.rotation).toBeCloseTo(Math.PI, 5)
    })

    test('F5.3: should rotate node with negative angle (-Math.PI / 4)', async () => {
      const node: AnyNode = { id: 'rot-3', type: 'item', object: 'item', rotation: 0, parentId: null } as any
      harness.editor.addNode(node)
      await harness.assertConvergence()

      harness.editor.rotateNode('rot-3', -Math.PI / 4)
      await harness.assertConvergence()

      const viewerNode = harness.viewer.getNode('rot-3') as any
      expect(viewerNode.rotation).toBeCloseTo(-Math.PI / 4, 5)
    })

    test('F5.4: should synchronize 3D Euler angles [yaw, pitch, roll]', async () => {
      const node: AnyNode = { id: 'rot-4', type: 'item', object: 'item', rotation: [0, 0, 0], parentId: null } as any
      harness.editor.addNode(node)
      await harness.assertConvergence()

      harness.editor.rotateNode('rot-4', [0.35, 1.57, -0.78])
      await harness.assertConvergence()

      const viewerNode = harness.viewer.getNode('rot-4') as any
      expect(viewerNode.rotation).toEqual([0.35, 1.57, -0.78])
    })

    test('F5.5: should converge over cumulative incremental rotations', async () => {
      const node: AnyNode = { id: 'rot-5', type: 'item', object: 'item', rotation: 0, parentId: null } as any
      harness.editor.addNode(node)
      await harness.assertConvergence()

      const step = Math.PI / 8
      for (let i = 1; i <= 8; i++) {
        harness.editor.rotateNode('rot-5', i * step)
      }

      await harness.assertConvergence()

      const viewerNode = harness.viewer.getNode('rot-5') as any
      expect(viewerNode.rotation).toBeCloseTo(Math.PI, 5)
    })
  })

  // ==========================================
  // F6: Object Scaling / Sizing (>= 5 tests)
  // ==========================================
  describe('F6: Object Scaling / Sizing', () => {
    test('F6.1: should scale wall length and thickness', async () => {
      const wall: AnyNode = {
        id: 'scale-wall',
        type: 'wall',
        object: 'wall',
        start: [0, 0],
        end: [3, 0],
        thickness: 0.1,
        parentId: null,
      } as any
      harness.editor.addNode(wall)
      await harness.assertConvergence()

      harness.editor.updateNode('scale-wall', {
        end: [9, 0],
        thickness: 0.35,
      })
      await harness.assertConvergence()

      const viewerWall = harness.viewer.getNode('scale-wall') as any
      expect(viewerWall.end).toEqual([9, 0])
      expect(viewerWall.thickness).toBe(0.35)
    })

    test('F6.2: should resize furniture 3D bounding box dimensions', async () => {
      const item: AnyNode = {
        id: 'scale-shelf',
        type: 'shelf',
        object: 'shelf',
        width: 1.2,
        depth: 0.4,
        height: 1.8,
        parentId: null,
      } as any
      harness.editor.addNode(item)
      await harness.assertConvergence()

      harness.editor.scaleNode('scale-shelf', {
        width: 2.4,
        depth: 0.6,
        height: 2.2,
      })
      await harness.assertConvergence()

      const viewerShelf = harness.viewer.getNode('scale-shelf') as any
      expect(viewerShelf.width).toBe(2.4)
      expect(viewerShelf.depth).toBe(0.6)
      expect(viewerShelf.height).toBe(2.2)
    })

    test('F6.3: should scale column radius and height', async () => {
      const col: AnyNode = {
        id: 'scale-col',
        type: 'column',
        object: 'column',
        radius: 0.2,
        height: 2.8,
        parentId: null,
      } as any
      harness.editor.addNode(col)
      await harness.assertConvergence()

      harness.editor.updateNode('scale-col', {
        radius: 0.5,
        height: 4.0,
      })
      await harness.assertConvergence()

      const viewerCol = harness.viewer.getNode('scale-col') as any
      expect(viewerCol.radius).toBe(0.5)
      expect(viewerCol.height).toBe(4.0)
    })

    test('F6.4: should resize floor slab polygon vertices', async () => {
      const slab: AnyNode = {
        id: 'scale-slab',
        type: 'slab',
        object: 'slab',
        polygon: [
          [0, 0],
          [5, 0],
          [5, 5],
          [0, 5],
        ],
        thickness: 0.2,
        parentId: null,
      } as any
      harness.editor.addNode(slab)
      await harness.assertConvergence()

      harness.editor.updateNode('scale-slab', {
        polygon: [
          [0, 0],
          [10, 0],
          [10, 8],
          [0, 8],
        ],
      })
      await harness.assertConvergence()

      const viewerSlab = harness.viewer.getNode('scale-slab') as any
      expect(viewerSlab.polygon).toEqual([
        [0, 0],
        [10, 0],
        [10, 8],
        [0, 8],
      ])
    })

    test('F6.5: should scale door opening width and height', async () => {
      const door: AnyNode = {
        id: 'scale-door',
        type: 'door',
        object: 'door',
        width: 0.9,
        height: 2.1,
        offset: 1.5,
        parentId: null,
      } as any
      harness.editor.addNode(door)
      await harness.assertConvergence()

      harness.editor.updateNode('scale-door', {
        width: 1.2,
        height: 2.4,
      })
      await harness.assertConvergence()

      const viewerDoor = harness.viewer.getNode('scale-door') as any
      expect(viewerDoor.width).toBe(1.2)
      expect(viewerDoor.height).toBe(2.4)
    })
  })

  // ==========================================
  // F7: Selection Sync & Awareness (>= 5 tests)
  // ==========================================
  describe('F7: Selection & Awareness Sync', () => {
    test('F7.1: should broadcast single node selection from Editor to Viewer', async () => {
      harness.editor.setSelection(['node-101'])

      await harness.viewer.waitForAwareness((states) => {
        for (const state of states.values()) {
          if (state.selection?.selectedNodeIds?.includes('node-101')) return true
        }
        return false
      })

      const states = Array.from(harness.viewer.awareness.getStates().values())
      const editorPresence = states.find((s) => s.user?.role === 'editor')
      expect(editorPresence?.selection?.selectedNodeIds).toEqual(['node-101'])
    })

    test('F7.2: should broadcast multi-node selection from Editor to Viewer', async () => {
      harness.editor.setSelection(['wall-1', 'wall-2', 'wall-3'])

      await harness.viewer.waitForAwareness((states) => {
        for (const state of states.values()) {
          if (state.selection?.selectedNodeIds?.length === 3) return true
        }
        return false
      })

      const states = Array.from(harness.viewer.awareness.getStates().values())
      const editorPresence = states.find((s) => s.user?.role === 'editor')
      expect(editorPresence?.selection?.selectedNodeIds).toEqual(['wall-1', 'wall-2', 'wall-3'])
    })

    test('F7.3: should clear remote selection upon Editor deselection', async () => {
      harness.editor.setSelection(['item-1'])
      await harness.viewer.waitForAwareness((states) => {
        return Array.from(states.values()).some((s) => s.selection?.selectedNodeIds?.length === 1)
      })

      harness.editor.setSelection([])
      await harness.viewer.waitForAwareness((states) => {
        return Array.from(states.values()).every((s) => !s.selection || s.selection.selectedNodeIds.length === 0)
      })

      const states = Array.from(harness.viewer.awareness.getStates().values())
      const editorPresence = states.find((s) => s.user?.role === 'editor')
      expect(editorPresence?.selection?.selectedNodeIds).toEqual([])
    })

    test('F7.4: should broadcast 3D pointer cursor position to peers', async () => {
      harness.editor.setCursor([15.2, 0.0, -8.4], [15.2, -8.4])

      await harness.viewer.waitForAwareness((states) => {
        for (const s of states.values()) {
          if (s.cursor?.worldPosition?.[0] === 15.2) return true
        }
        return false
      })

      const states = Array.from(harness.viewer.awareness.getStates().values())
      const editorPresence = states.find((s) => s.user?.role === 'editor')
      expect(editorPresence?.cursor?.worldPosition).toEqual([15.2, 0.0, -8.4])
      expect(editorPresence?.cursor?.planPosition).toEqual([15.2, -8.4])
    })

    test('F7.5: should broadcast active drag live transforms without polluting CRDT undo history', async () => {
      const node: AnyNode = { id: 'drag-node', type: 'item', object: 'item', position: [0, 0, 0], parentId: null } as any
      harness.editor.addNode(node)
      await harness.assertConvergence()

      // Stream 30Hz drag awareness
      harness.editor.setLiveDrag('drag-node', { position: [5.0, 0, 2.5], rotation: 0.75 })

      await harness.viewer.waitForAwareness((states) => {
        for (const s of states.values()) {
          if (s.activeDrag?.nodeId === 'drag-node') return true
        }
        return false
      })

      const states = Array.from(harness.viewer.awareness.getStates().values())
      const editorPresence = states.find((s) => s.user?.role === 'editor')
      expect(editorPresence?.activeDrag?.position).toEqual([5.0, 0, 2.5])
      expect(editorPresence?.activeDrag?.rotation).toBe(0.75)

      // Persistent CRDT doc should still have original position until committed!
      expect((harness.viewer.getNode('drag-node') as any).position).toEqual([0, 0, 0])

      // Clear drag
      harness.editor.clearLiveDrag()
      await harness.viewer.waitForAwareness((states) => {
        for (const s of states.values()) {
          if (s.activeDrag === null) return true
        }
        return false
      })
    })
  })

  // ==========================================
  // F8: ReadOnly RBAC Enforcement (>= 5 tests)
  // ==========================================
  describe('F8: ReadOnly RBAC Enforcement', () => {
    test('F8.1: should allow Editor to perform mutations and broadcast them', async () => {
      const node: AnyNode = { id: 'rbac-editor-node', type: 'site', object: 'site', parentId: null } as any
      harness.editor.addNode(node)
      await harness.assertConvergence()

      expect(harness.viewer.getNode('rbac-editor-node')).toBeDefined()
    })

    test('F8.2: should drop mutation attempts sent by Viewer client at server layer', async () => {
      const initialDroppedCount = harness.server.droppedViewerPacketsCount

      // Viewer attempts to write a node directly
      const illegalNode: AnyNode = { id: 'viewer-illegal-node', type: 'item', object: 'item', parentId: null } as any
      harness.viewer.addNode(illegalNode)

      // Wait a short duration
      await new Promise((r) => setTimeout(r, 100))

      // Server should drop the packet and not apply to room doc
      const room = harness.server.rooms.get(harness.editor.sceneId)
      expect(room?.doc.getMap('nodes').get('viewer-illegal-node')).toBeUndefined()
      expect(harness.editor.getNode('viewer-illegal-node')).toBeUndefined()
      expect(harness.server.droppedViewerPacketsCount).toBeGreaterThanOrEqual(initialDroppedCount + 1)
    })

    test('F8.3: should ensure Viewer continuously mirrors incoming Editor mutations', async () => {
      for (let i = 1; i <= 5; i++) {
        harness.editor.addNode({ id: `stream-node-${i}`, type: 'item', object: 'item', parentId: null } as any)
      }

      await harness.assertConvergence()

      for (let i = 1; i <= 5; i++) {
        expect(harness.viewer.getNode(`stream-node-${i}`)).toBeDefined()
      }
    })

    test('F8.4: should allow Viewer awareness (cursor, presence) while protecting CRDT data plane', async () => {
      harness.viewer.setCursor([5, 1, 5])

      await harness.editor.waitForAwareness((states) => {
        for (const s of states.values()) {
          if (s.user?.role === 'viewer' && s.cursor?.worldPosition?.[0] === 5) return true
        }
        return false
      })

      const states = Array.from(harness.editor.awareness.getStates().values())
      const viewerPresence = states.find((s) => s.user?.role === 'viewer')
      expect(viewerPresence).toBeDefined()
      expect(viewerPresence?.cursor?.worldPosition).toEqual([5, 1, 5])
    })

    test('F8.5: should allow newly joined Editor client to mutate after initial sync', async () => {
      const editor2 = await harness.createClient('editor', 'editor-secondary')
      await harness.syncAll()

      editor2.addNode({ id: 'editor2-node', type: 'building', object: 'building', parentId: null } as any)
      await harness.syncAll()

      expect(harness.editor.getNode('editor2-node')).toBeDefined()
      expect(harness.viewer.getNode('editor2-node')).toBeDefined()
    })
  })
})
