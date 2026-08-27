import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import {
  createMultiplayerTestHarness,
  type MultiplayerTestHarness,
} from './multiplayer-test-harness'
import type { AnyNode } from '../../schema/types'

describe('Tier 4: Real-World Application Scenarios E2E Suite (<1.0s Live SLA)', () => {
  let harness: MultiplayerTestHarness

  beforeEach(async () => {
    harness = await createMultiplayerTestHarness()
  })

  afterEach(async () => {
    if (harness) {
      await harness.cleanup()
    }
  })

  test('S1: Full Architectural Room Layout Workflow with < 1.0s Sub-Second Synchronization SLA', async () => {
    const startTime = performance.now()

    // Step 1: Create Hierarchy (Site -> Building -> Level)
    const siteNode: AnyNode = {
      id: 'site-architectural',
      type: 'site',
      object: 'site',
      name: 'Innovation Campus',
      position: [0, 0, 0],
      rotation: 0,
      children: [],
      parentId: null,
    } as any

    const buildingNode: AnyNode = {
      id: 'bldg-office',
      type: 'building',
      object: 'building',
      name: 'Main Office Tower',
      position: [0, 0, 0],
      rotation: 0,
      children: [],
      parentId: 'site-architectural',
    } as any

    const levelNode: AnyNode = {
      id: 'level-ground',
      type: 'level',
      object: 'level',
      name: 'Ground Floor',
      levelNumber: 1,
      elevation: 0,
      height: 3.5,
      children: [],
      parentId: 'bldg-office',
    } as any

    harness.editor.addNode(siteNode)
    harness.editor.addNode(buildingNode, { parentId: 'site-architectural' })
    harness.editor.addNode(levelNode, { parentId: 'bldg-office' })

    // Step 2: Create 4 Perimeter Walls (10m x 8m room)
    const wallNorth: AnyNode = {
      id: 'wall-n-100',
      type: 'wall',
      object: 'wall',
      start: [0, 0],
      end: [10, 0],
      height: 3.5,
      thickness: 0.2,
      parentId: 'level-ground',
    } as any
    const wallEast: AnyNode = {
      id: 'wall-e-101',
      type: 'wall',
      object: 'wall',
      start: [10, 0],
      end: [10, 8],
      height: 3.5,
      thickness: 0.2,
      parentId: 'level-ground',
    } as any
    const wallSouth: AnyNode = {
      id: 'wall-s-102',
      type: 'wall',
      object: 'wall',
      start: [10, 8],
      end: [0, 8],
      height: 3.5,
      thickness: 0.2,
      parentId: 'level-ground',
    } as any
    const wallWest: AnyNode = {
      id: 'wall-w-103',
      type: 'wall',
      object: 'wall',
      start: [0, 8],
      end: [0, 0],
      height: 3.5,
      thickness: 0.2,
      parentId: 'level-ground',
    } as any

    harness.editor.addNode(wallNorth, { parentId: 'level-ground' })
    harness.editor.addNode(wallEast, { parentId: 'level-ground' })
    harness.editor.addNode(wallSouth, { parentId: 'level-ground' })
    harness.editor.addNode(wallWest, { parentId: 'level-ground' })

    // Step 3: Insert Openings (Door on South wall, Window on North wall)
    const doorNode: AnyNode = {
      id: 'door-entrance',
      type: 'door',
      object: 'door',
      name: 'Entry Door',
      width: 1.0,
      height: 2.2,
      offset: 4.5,
      parentId: 'wall-s-102',
    } as any

    const windowNode: AnyNode = {
      id: 'window-main',
      type: 'window',
      object: 'window',
      name: 'Panorama Window',
      width: 2.5,
      height: 1.8,
      offset: 3.0,
      parentId: 'wall-n-100',
    } as any

    harness.editor.addNode(doorNode, { parentId: 'wall-s-102' })
    harness.editor.addNode(windowNode, { parentId: 'wall-n-100' })

    // Step 4: Add Furniture (Desk, Chair, Shelf, Temporary Staging Box)
    const deskNode: AnyNode = {
      id: 'furniture-desk',
      type: 'item',
      object: 'item',
      name: 'Standing Desk',
      position: [3.0, 0, 4.0],
      rotation: [0, 0, 0],
      metadata: { department: 'Engineering' },
      parentId: 'level-ground',
    } as any

    const chairNode: AnyNode = {
      id: 'furniture-chair',
      type: 'item',
      object: 'item',
      name: 'Ergonomic Chair',
      position: [3.0, 0, 3.2],
      rotation: [0, 0, 0],
      parentId: 'level-ground',
    } as any

    const shelfNode: AnyNode = {
      id: 'furniture-shelf',
      type: 'shelf',
      object: 'shelf',
      name: 'Bookcase',
      width: 1.5,
      depth: 0.4,
      height: 2.0,
      position: [0.3, 0, 2.0],
      parentId: 'level-ground',
    } as any

    const stagingBox: AnyNode = {
      id: 'staging-box',
      type: 'item',
      object: 'item',
      name: 'Temporary Packing Crate',
      position: [8.0, 0, 2.0],
      parentId: 'level-ground',
    } as any

    harness.editor.addNode(deskNode, { parentId: 'level-ground' })
    harness.editor.addNode(chairNode, { parentId: 'level-ground' })
    harness.editor.addNode(shelfNode, { parentId: 'level-ground' })
    harness.editor.addNode(stagingBox, { parentId: 'level-ground' })

    // Step 5: Adjust Transforms (Rotate Desk by 90 deg, Move Chair)
    harness.editor.rotateNode('furniture-desk', [0, Math.PI / 2, 0])
    harness.editor.translateNode('furniture-chair', [3.5, 0, 4.0])

    // Step 6: Delete Obsolete Staging Crate
    harness.editor.deleteNode('staging-box')

    // Step 7: Final Convergence & Verification
    await harness.assertConvergence(1000)

    const syncDurationMs = performance.now() - startTime
    console.log(`[Tier 4] Full room layout sync completed in ${syncDurationMs.toFixed(2)}ms (SLA: < 1000ms)`)

    // Assert SLA: entire multi-step workflow mirrored within < 1.0s
    expect(syncDurationMs).toBeLessThan(1000)

    // Verify Viewer Model Integrity
    const viewerSnapshot = harness.viewer.getSnapshot()
    expect(viewerSnapshot.nodes['site-architectural' as AnyNodeId]).toBeDefined()
    expect(viewerSnapshot.nodes['bldg-office' as AnyNodeId]).toBeDefined()
    expect(viewerSnapshot.nodes['level-ground' as AnyNodeId]).toBeDefined()
    expect(viewerSnapshot.nodes['wall-n-100' as AnyNodeId]).toBeDefined()
    expect(viewerSnapshot.nodes['wall-e-101' as AnyNodeId]).toBeDefined()
    expect(viewerSnapshot.nodes['wall-s-102' as AnyNodeId]).toBeDefined()
    expect(viewerSnapshot.nodes['wall-w-103' as AnyNodeId]).toBeDefined()
    expect(viewerSnapshot.nodes['door-entrance' as AnyNodeId]).toBeDefined()
    expect(viewerSnapshot.nodes['window-main' as AnyNodeId]).toBeDefined()

    const viewerDesk = viewerSnapshot.nodes['furniture-desk' as AnyNodeId] as any
    const viewerChair = viewerSnapshot.nodes['furniture-chair' as AnyNodeId] as any
    expect(viewerDesk.rotation).toEqual([0, Math.PI / 2, 0])
    expect(viewerChair.position).toEqual([3.5, 0, 4.0])

    // Staging box must be deleted
    expect(viewerSnapshot.nodes['staging-box' as AnyNodeId]).toBeUndefined()
  })

  test('S2: Multi-Level BIM Structure with Columns and Slabs synchronized live', async () => {
    const startTime = performance.now()

    // Site & Building
    harness.editor.addNode({ id: 'site-bim', type: 'site', object: 'site', children: [], parentId: null } as any)
    harness.editor.addNode({ id: 'bldg-bim', type: 'building', object: 'building', children: [], parentId: 'site-bim' } as any)

    // 3 Levels with slabs & columns
    for (let lvl = 1; lvl <= 3; lvl++) {
      const levelId = `level-bim-${lvl}`
      harness.editor.addNode({
        id: levelId,
        type: 'level',
        object: 'level',
        levelNumber: lvl,
        elevation: (lvl - 1) * 3.5,
        height: 3.5,
        children: [],
        parentId: 'bldg-bim',
      } as any, { parentId: 'bldg-bim' })

      // Add Slab
      harness.editor.addNode({
        id: `slab-lvl-${lvl}`,
        type: 'slab',
        object: 'slab',
        polygon: [[0, 0], [20, 0], [20, 15], [0, 15]],
        thickness: 0.3,
        parentId: levelId,
      } as any, { parentId: levelId })

      // Add 4 structural columns
      for (let c = 1; c <= 4; c++) {
        harness.editor.addNode({
          id: `col-lvl-${lvl}-${c}`,
          type: 'column',
          object: 'column',
          position: [c * 4, (lvl - 1) * 3.5, 5],
          height: 3.5,
          radius: 0.25,
          parentId: levelId,
        } as any, { parentId: levelId })
      }
    }

    await harness.assertConvergence(1000)
    const durationMs = performance.now() - startTime

    expect(durationMs).toBeLessThan(1000)

    const viewerSnapshot = harness.viewer.getSnapshot()
    expect(Object.keys(viewerSnapshot.nodes).length).toBe(2 + 3 * (1 + 1 + 4)) // 2 + 18 = 20 nodes
  })
})
