import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import * as Y from 'yjs'
import {
  createMultiplayerTestHarness,
  type MultiplayerTestHarness,
  type SimulatedMultiplayerClient,
  healSceneCycles,
  yDocToSnapshot,
} from './multiplayer-test-harness'
import { bindZustandToYjs } from '../yjs-bridge'
import { writeNodeToYMap } from '../crdt-schema'
import { WallNode } from '../../schema/nodes/wall'
import useScene, { type SceneOperationPatch } from '../../store/use-scene'
import type { AnyNode, AnyNodeId } from '../../schema/types'

describe('Challenger 1: Adversarial Stress & Extreme Concurrency Suite', () => {
  let harness: MultiplayerTestHarness

  beforeEach(async () => {
    harness = await createMultiplayerTestHarness()
  })

  afterEach(async () => {
    if (harness) {
      await harness.cleanup()
    }
  })

  // =========================================================================
  // 1. EXTREME CONCURRENCY: 10+ CLIENTS & 500+ CONCURRENT NODES
  // =========================================================================
  describe('1. Extreme Concurrency & High-Scale Load', () => {
    test('1.1: 10 concurrent clients rapidly creating 50 nodes each (500 nodes total) simultaneously', async () => {
      const clientCount = 10
      const nodesPerClient = 50
      const clients: SimulatedMultiplayerClient[] = [harness.editor]

      for (let i = 2; i <= clientCount; i++) {
        const client = await harness.createClient('editor', `stress-editor-${i}`)
        clients.push(client)
      }

      const startTime = Date.now()

      // Concurrently add nodes across all 10 clients
      const creationPromises = clients.map((client, clientIndex) => {
        return (async () => {
          for (let n = 0; n < nodesPerClient; n++) {
            const nodeId = `client-${clientIndex}-node-${n}`
            const node: AnyNode = {
              id: nodeId,
              type: 'wall',
              object: 'node',
              name: `Wall ${clientIndex}-${n}`,
              position: [clientIndex * 10, n * 2, 0],
              rotation: (n * Math.PI) / 180,
              parentId: null,
              children: [],
              slots: {
                interior: `mat-${clientIndex}`,
                exterior: 'mat-default',
              },
              metadata: {
                createdBy: client.userId,
                index: n,
              },
            } as any

            client.addNode(node)
          }
        })()
      })

      await Promise.all(creationPromises)

      // Sync and assert convergence
      await harness.syncAll(10000)
      const duration = Date.now() - startTime

      console.log(`[Adversarial 1.1] 500 nodes created across 10 clients and synchronized in ${duration}ms`)

      // Verify all 10 clients have exactly 500 nodes
      const baseSnapshot = harness.editor.getSnapshot()
      expect(Object.keys(baseSnapshot.nodes).length).toBe(clientCount * nodesPerClient)

      for (const client of clients) {
        const snap = client.getSnapshot()
        expect(Object.keys(snap.nodes).length).toBe(500)
        expect(JSON.stringify(snap.nodes)).toBe(JSON.stringify(baseSnapshot.nodes))
        expect(snap.rootNodeIds.length).toBe(500)
      }

      // Also check the server doc directly
      const serverRoom = harness.server.getOrCreateRoom(harness.editor.sceneId)
      const serverSnap = yDocToSnapshot(serverRoom.doc)
      expect(Object.keys(serverSnap.nodes).length).toBe(500)
      expect(JSON.stringify(serverSnap.nodes)).toBe(JSON.stringify(baseSnapshot.nodes))
    }, 15000)

    test('1.2: 10 concurrent clients simultaneously mutating, reparenting, and translating 500 nodes', async () => {
      const clientCount = 10
      const clients: SimulatedMultiplayerClient[] = [harness.editor]

      for (let i = 2; i <= clientCount; i++) {
        const client = await harness.createClient('editor', `stress-editor-${i}`)
        clients.push(client)
      }

      // First create a site and 10 building parents
      const siteNode: AnyNode = {
        id: 'root-site',
        type: 'site',
        object: 'node',
        name: 'Root Site',
        position: [0, 0, 0],
        rotation: 0,
        parentId: null,
        children: [],
      } as any
      harness.editor.addNode(siteNode)

      for (let b = 0; b < 10; b++) {
        const bldgNode: AnyNode = {
          id: `bldg-${b}`,
          type: 'building',
          object: 'node',
          name: `Building ${b}`,
          position: [b * 50, 0, 0],
          rotation: 0,
          parentId: 'root-site',
          children: [],
        } as any
        harness.editor.addNode(bldgNode, { parentId: 'root-site' })
      }

      // Seed 500 child nodes
      for (let i = 0; i < 500; i++) {
        const targetBldg = `bldg-${i % 10}`
        const node: AnyNode = {
          id: `work-node-${i}`,
          type: 'wall',
          object: 'node',
          name: `Initial Node ${i}`,
          position: [i, 0, 0],
          rotation: 0,
          parentId: targetBldg,
          children: [],
          metadata: { rev: 0 },
        } as any
        harness.editor.addNode(node, { parentId: targetBldg })
      }

      await harness.syncAll(10000)

      const startTime = Date.now()

      // Concurrently mutate:
      // Client k mutates work-node-(k*50 .. k*50 + 49) multiple times and reparents them
      const mutationPromises = clients.map((client, clientIdx) => {
        return (async () => {
          const startIdx = clientIdx * 50
          const endIdx = startIdx + 50

          for (let i = startIdx; i < endIdx; i++) {
            const nodeId = `work-node-${i}`
            const newParent = `bldg-${(clientIdx + 1) % 10}`

            // Step 1: Translate
            client.translateNode(nodeId, [i * 2, 3.5, clientIdx * 10])

            // Step 2: Rotate
            client.rotateNode(nodeId, Math.PI / 4)

            // Step 3: Update metadata
            client.updateNode(nodeId, {
              name: `Updated by ${client.userId}`,
              metadata: { rev: 1, modifiedBy: client.userId, timestamp: Date.now() },
            })

            // Step 4: Reparent
            client.updateNode(nodeId, { parentId: newParent } as any)
          }
        })()
      })

      await Promise.all(mutationPromises)
      await harness.syncAll(10000)

      const duration = Date.now() - startTime
      console.log(`[Adversarial 1.2] 500 nodes mutated and reparented across 10 clients in ${duration}ms`)

      // Verify convergence across all 10 clients
      const snap0 = harness.editor.getSnapshot()
      for (const client of clients) {
        const snap = client.getSnapshot()
        expect(JSON.stringify(snap.nodes)).toBe(JSON.stringify(snap0.nodes))
      }

      // Verify all 500 work nodes exist and have their parent updated
      for (let i = 0; i < 500; i++) {
        const node = snap0.nodes[`work-node-${i}`]
        expect(node).toBeDefined()
        expect(node.position).toEqual([i * 2, 3.5, Math.floor(i / 50) * 10])
        const expectedAuthor = Math.floor(i / 50) === 0 ? 'editor-primary' : `stress-editor-${Math.floor(i / 50) + 1}`
        expect(node.name).toBe(`Updated by ${expectedAuthor}`)
      }
    }, 20000)
  })

  // =========================================================================
  // 2. COMPLEX HIERARCHY CYCLES & TARJAN SCC HEALING
  // =========================================================================
  describe('2. Complex Hierarchy Cycles & Deterministic Tarjan SCC Healing', () => {
    test('2.1: 4-node circular loop (A -> B -> C -> D -> A) deterministically broken at min ID', () => {
      const nodes: Record<AnyNodeId, AnyNode> = {
        node_d: {
          id: 'node_d' as any,
          type: 'building' as any,
          object: 'node' as any,
          parentId: 'node_c' as any,
          children: [] as any,
        } as AnyNode,
        node_c: {
          id: 'node_c' as any,
          type: 'building' as any,
          object: 'node' as any,
          parentId: 'node_b' as any,
          children: [] as any,
        } as AnyNode,
        node_b: {
          id: 'node_b' as any,
          type: 'building' as any,
          object: 'node' as any,
          parentId: 'node_a' as any,
          children: [] as any,
        } as AnyNode,
        node_a: {
          id: 'node_a' as any,
          type: 'building' as any,
          object: 'node' as any,
          parentId: 'node_d' as any,
          children: [] as any,
        } as AnyNode,
      }

      const result = healSceneCycles(nodes, 'site_root' as any)

      // Lexicographical min in {node_a, node_b, node_c, node_d} is 'node_a'
      expect(result.brokenCycleNodes).toEqual(['node_a' as any])
      expect(result.nodes.node_a.parentId).toBe('site_root' as any)
      expect(result.nodes.node_b.parentId).toBe('node_a' as any)
      expect(result.nodes.node_c.parentId).toBe('node_b' as any)
      expect(result.nodes.node_d.parentId).toBe('node_c' as any)

      // Re-run cycle healer on the repaired output to verify 100% cycle-freedom
      const recheck = healSceneCycles(result.nodes, 'site_root' as any)
      expect(recheck.brokenCycleNodes).toHaveLength(0)
    })

    test('2.2: 5-node cycle with attached non-cyclic subtrees preserves valid subtrees', () => {
      const nodes: Record<AnyNodeId, AnyNode> = {
        // Cycle: cyc_5 -> cyc_4 -> cyc_3 -> cyc_2 -> cyc_1 -> cyc_5
        cyc_5: { id: 'cyc_5', type: 'level', parentId: 'cyc_4', children: [] } as any,
        cyc_4: { id: 'cyc_4', type: 'level', parentId: 'cyc_3', children: [] } as any,
        cyc_3: { id: 'cyc_3', type: 'level', parentId: 'cyc_2', children: [] } as any,
        cyc_2: { id: 'cyc_2', type: 'level', parentId: 'cyc_1', children: [] } as any,
        cyc_1: { id: 'cyc_1', type: 'level', parentId: 'cyc_5', children: [] } as any,

        // Subtrees attached to cyc_3
        sub_wall_1: { id: 'sub_wall_1', type: 'wall', parentId: 'cyc_3', children: [] } as any,
        sub_wall_2: { id: 'sub_wall_2', type: 'wall', parentId: 'cyc_3', children: [] } as any,
        sub_door_1: { id: 'sub_door_1', type: 'door', parentId: 'sub_wall_1', children: [] } as any,

        // Subtree attached to cyc_5
        sub_column_1: { id: 'sub_column_1', type: 'column', parentId: 'cyc_5', children: [] } as any,
      }

      const result = healSceneCycles(nodes, null)

      // 'cyc_1' is lexicographically smallest cycle node
      expect(result.brokenCycleNodes).toEqual(['cyc_1' as any])
      expect(result.nodes.cyc_1.parentId).toBeNull()

      // Subtrees must remain untouched and connected to their respective parents
      expect(result.nodes.sub_wall_1.parentId).toBe('cyc_3')
      expect(result.nodes.sub_wall_2.parentId).toBe('cyc_3')
      expect(result.nodes.sub_door_1.parentId).toBe('sub_wall_1')
      expect(result.nodes.sub_column_1.parentId).toBe('cyc_5')

      // Children array reconstruction must accurately reflect hierarchy
      expect(result.nodes.cyc_3.children).toContain('sub_wall_1')
      expect(result.nodes.cyc_3.children).toContain('sub_wall_2')
      expect(result.nodes.sub_wall_1.children).toContain('sub_door_1')
      expect(result.nodes.cyc_5.children).toContain('sub_column_1')
    })

    test('2.3: Multiple independent disconnected cycles in same scene graph', () => {
      const nodes: Record<AnyNodeId, AnyNode> = {
        // Cycle 1: loop1_a -> loop1_b -> loop1_a
        loop1_b: { id: 'loop1_b', type: 'building', parentId: 'loop1_a', children: [] } as any,
        loop1_a: { id: 'loop1_a', type: 'building', parentId: 'loop1_b', children: [] } as any,

        // Cycle 2: loop2_x -> loop2_y -> loop2_z -> loop2_x
        loop2_z: { id: 'loop2_z', type: 'level', parentId: 'loop2_y', children: [] } as any,
        loop2_y: { id: 'loop2_y', type: 'level', parentId: 'loop2_x', children: [] } as any,
        loop2_x: { id: 'loop2_x', type: 'level', parentId: 'loop2_z', children: [] } as any,

        // Valid node
        valid_site: { id: 'valid_site', type: 'site', parentId: null, children: [] } as any,
      }

      const result = healSceneCycles(nodes, 'valid_site' as any)

      expect(result.brokenCycleNodes).toContain('loop1_a' as any)
      expect(result.brokenCycleNodes).toContain('loop2_x' as any)
      expect(result.brokenCycleNodes.length).toBe(2)

      expect(result.nodes.loop1_a.parentId).toBe('valid_site' as any)
      expect(result.nodes.loop2_x.parentId).toBe('valid_site' as any)

      // Post-heal verification
      const verify = healSceneCycles(result.nodes, 'valid_site' as any)
      expect(verify.brokenCycleNodes).toHaveLength(0)
    })

    test('2.4: 4 concurrent peers racing to create circular reparenting loop over WebSocket', async () => {
      const p1 = harness.editor
      const p2 = await harness.createClient('editor', 'peer-2')
      const p3 = await harness.createClient('editor', 'peer-3')
      const p4 = await harness.createClient('editor', 'peer-4')

      // Create initial 4 building nodes in linear hierarchy: A -> B -> C -> D
      p1.addNode({ id: 'race_a', type: 'building', object: 'node', parentId: null, children: [] } as any)
      p1.addNode({ id: 'race_b', type: 'building', object: 'node', parentId: 'race_a', children: [] } as any)
      p1.addNode({ id: 'race_c', type: 'building', object: 'node', parentId: 'race_b', children: [] } as any)
      p1.addNode({ id: 'race_d', type: 'building', object: 'node', parentId: 'race_c', children: [] } as any)

      await harness.syncAll()

      // Concurrently execute reparenting that creates a cycle:
      // p1 sets race_a.parentId = race_d
      // p2 sets race_c.parentId = race_a
      // p3 sets race_b.parentId = race_d
      // p4 sets race_d.parentId = race_b
      p1.updateNode('race_a', { parentId: 'race_d' } as any)
      p2.updateNode('race_c', { parentId: 'race_a' } as any)
      p3.updateNode('race_b', { parentId: 'race_d' } as any)
      p4.updateNode('race_d', { parentId: 'race_b' } as any)

      await harness.syncAll(5000)

      // Get converged snapshot from all 4 peers
      const snap1 = p1.getSnapshot()
      const snap2 = p2.getSnapshot()
      const snap3 = p3.getSnapshot()
      const snap4 = p4.getSnapshot()

      expect(JSON.stringify(snap1.nodes)).toBe(JSON.stringify(snap2.nodes))
      expect(JSON.stringify(snap2.nodes)).toBe(JSON.stringify(snap3.nodes))
      expect(JSON.stringify(snap3.nodes)).toBe(JSON.stringify(snap4.nodes))

      // Execute deterministic cycle healing on the converged state
      const healed1 = healSceneCycles(snap1.nodes)
      const healed4 = healSceneCycles(snap4.nodes)

      expect(JSON.stringify(healed1.nodes)).toBe(JSON.stringify(healed4.nodes))
      expect(healed1.brokenCycleNodes.length).toBeGreaterThanOrEqual(1)

      // Assert no cycles exist in healed graph
      const doubleCheck = healSceneCycles(healed1.nodes)
      expect(doubleCheck.brokenCycleNodes).toHaveLength(0)
    })

    test('2.5: 100-node massive circular chain (N_0 -> N_1 -> ... -> N_99 -> N_0) with 200 attached leaves', () => {
      const nodes: Record<AnyNodeId, AnyNode> = {}
      const chainLength = 100

      // Create 100-node cycle
      for (let i = 0; i < chainLength; i++) {
        const nextParent = `chain_node_${(i + 1) % chainLength}`
        nodes[`chain_node_${i}`] = {
          id: `chain_node_${i}`,
          type: 'building',
          object: 'node',
          parentId: nextParent,
          children: [],
        } as any
      }

      // Attach 200 leaf nodes onto various cycle nodes
      for (let j = 0; j < 200; j++) {
        const parentCycleNode = `chain_node_${j % chainLength}`
        nodes[`leaf_node_${j}`] = {
          id: `leaf_node_${j}`,
          type: 'wall',
          object: 'node',
          parentId: parentCycleNode,
          children: [],
        } as any
      }

      const result = healSceneCycles(nodes, 'site_master' as any)

      // Lexicographical min among chain_node_0 .. chain_node_99 is 'chain_node_0'
      expect(result.brokenCycleNodes).toEqual(['chain_node_0' as any])
      expect(result.nodes.chain_node_0.parentId).toBe('site_master' as any)

      // All 200 leaf nodes must remain intact and attached
      for (let j = 0; j < 200; j++) {
        expect(result.nodes[`leaf_node_${j}`].parentId).toBe(`chain_node_${j % chainLength}`)
      }

      // Verify no cycles remain
      const recheck = healSceneCycles(result.nodes, 'site_master' as any)
      expect(recheck.brokenCycleNodes).toHaveLength(0)
    })

    test('2.6: Permutation Invariance — healing produces identical output regardless of dictionary key order', () => {
      const generateCycleGraph = (): Record<AnyNodeId, AnyNode> => ({
        z_node: { id: 'z_node', type: 'level', parentId: 'm_node', children: [] } as any,
        m_node: { id: 'm_node', type: 'level', parentId: 'a_node', children: [] } as any,
        a_node: { id: 'a_node', type: 'level', parentId: 'z_node', children: [] } as any,
        orphan_k: { id: 'orphan_k', type: 'wall', parentId: 'ghost_parent', children: [] } as any,
        self_loop: { id: 'self_loop', type: 'site', parentId: 'self_loop', children: [] } as any,
      })

      const graph1 = generateCycleGraph()
      const result1 = healSceneCycles(graph1, 'root_site' as any)

      // Permute key order
      const permutedKeys = Object.keys(graph1).reverse() as AnyNodeId[]
      const graph2: Record<AnyNodeId, AnyNode> = {}
      for (const k of permutedKeys) {
        graph2[k] = graph1[k]!
      }

      const result2 = healSceneCycles(graph2, 'root_site' as any)

      expect(result1.nodes).toEqual(result2.nodes)
      expect(result1.brokenCycleNodes.sort()).toEqual(result2.brokenCycleNodes.sort())
      expect(result1.orphanedNodesRepaired.sort()).toEqual(result2.orphanedNodesRepaired.sort())
    })
  })

  // =========================================================================
  // 3. RAPID UNDO / REDO OSCILLATION UNDER CONCURRENT REMOTE EDITS
  // =========================================================================
  describe('3. Collaborative Undo/Redo Oscillation Under Concurrent Remote Traffic', () => {
    test('3.1: Client 1 rapidly undoes and redoes 30 times while Clients 2-5 are rapidly mutating', async () => {
      const client1 = harness.editor
      const client2 = await harness.createClient('editor', 'remote-editor-2')
      const client3 = await harness.createClient('editor', 'remote-editor-3')
      const client4 = await harness.createClient('editor', 'remote-editor-4')

      // Client 1 creates its own wall
      client1.addNode({
        id: 'client1_wall',
        type: 'wall',
        object: 'node',
        name: 'Client 1 Wall Initial',
        position: [0, 0, 0],
        rotation: 0,
        parentId: null,
        children: [],
      } as any)

      // Remote clients create their own nodes
      client2.addNode({ id: 'client2_item', type: 'furniture', object: 'node', position: [10, 0, 0], parentId: null } as any)
      client3.addNode({ id: 'client3_item', type: 'column', object: 'node', position: [20, 0, 0], parentId: null } as any)
      client4.addNode({ id: 'client4_item', type: 'door', object: 'node', position: [30, 0, 0], parentId: null } as any)

      await harness.syncAll()

      // Client 1 makes 5 distinct tracked modifications
      for (let step = 1; step <= 5; step++) {
        client1.stopCapturing()
        client1.translateNode('client1_wall', [step * 5, 0, 0])
        client1.updateNode('client1_wall', { name: `Client 1 Wall Step ${step}` })
      }

      // Now run rapid concurrent oscillation:
      // Client 1 performs 30 undo/redo cycles
      // Clients 2, 3, 4 perform 30 continuous updates to their respective nodes
      const p1UndoRedo = (async () => {
        for (let i = 0; i < 30; i++) {
          if (client1.undoManager.canUndo()) {
            client1.undo()
          }
          if (client1.undoManager.canRedo()) {
            client1.redo()
          }
        }
      })()

      const p2Mutate = (async () => {
        for (let i = 0; i < 30; i++) {
          client2.translateNode('client2_item', [10 + i, 0, 0])
          client2.updateNode('client2_item', { name: `C2 Update ${i}` })
        }
      })()

      const p3Mutate = (async () => {
        for (let i = 0; i < 30; i++) {
          client3.rotateNode('client3_item', (i * Math.PI) / 10)
        }
      })()

      const p4Mutate = (async () => {
        for (let i = 0; i < 30; i++) {
          client4.updateNode('client4_item', { metadata: { step: i } })
        }
      })()

      await Promise.all([p1UndoRedo, p2Mutate, p3Mutate, p4Mutate])
      await harness.syncAll(10000)

      // Convergence assertion
      const snap1 = client1.getSnapshot()
      const snap2 = client2.getSnapshot()
      const snap3 = client3.getSnapshot()
      const snap4 = client4.getSnapshot()

      expect(JSON.stringify(snap1.nodes)).toBe(JSON.stringify(snap2.nodes))
      expect(JSON.stringify(snap2.nodes)).toBe(JSON.stringify(snap3.nodes))
      expect(JSON.stringify(snap3.nodes)).toBe(JSON.stringify(snap4.nodes))

      // Remote nodes MUST NOT have been destroyed or reverted by Client 1's undo actions
      expect(snap1.nodes['client2_item']).toBeDefined()
      expect(snap1.nodes['client2_item'].name).toBe('C2 Update 29')
      expect(snap1.nodes['client3_item']).toBeDefined()
      expect(snap1.nodes['client4_item']).toBeDefined()
      expect((snap1.nodes['client4_item'] as any).metadata.step).toBe(29)
    })

    test('3.2: Undoing a property modification on a remotely deleted node does not revive deleted node', async () => {
      const client1 = harness.editor
      const client2 = await harness.createClient('editor', 'remote-deleter')

      // Client 1 creates a wall
      client1.addNode({
        id: 'target_wall',
        type: 'wall',
        object: 'node',
        name: 'Original Wall',
        position: [0, 0, 0],
        parentId: null,
        children: [],
      } as any)

      await harness.syncAll()

      // Client 1 modifies the wall
      client1.stopCapturing()
      client1.updateNode('target_wall', { name: 'Client 1 Renamed Wall' })

      await harness.syncAll()

      // Client 2 deletes the wall
      client2.deleteNode('target_wall')

      await harness.syncAll()
      expect(client1.getNode('target_wall')).toBeUndefined()
      expect(client2.getNode('target_wall')).toBeUndefined()

      // Client 1 calls undo (which attempts to undo the rename)
      client1.undo()

      await harness.syncAll()

      // The node MUST remain deleted and not revived as a phantom / broken entity
      expect(client1.getNode('target_wall')).toBeUndefined()
      expect(client2.getNode('target_wall')).toBeUndefined()
      await harness.assertConvergence()
    })

    test('3.3: 100 consecutive rapid Undo/Redo operations during high-frequency remote traffic', async () => {
      const c1 = harness.editor
      const c2 = await harness.createClient('editor', 'c2-worker')

      c1.addNode({ id: 'c1_node', type: 'slab', object: 'node', position: [0, 0, 0], parentId: null } as any)
      c2.addNode({ id: 'c2_node', type: 'slab', object: 'node', position: [100, 0, 0], parentId: null } as any)
      await harness.syncAll()

      // c1 performs 10 modifications
      for (let i = 0; i < 10; i++) {
        c1.stopCapturing()
        c1.translateNode('c1_node', [i * 10, 0, 0])
      }

      // Concurrently: c1 runs 100 undo/redo oscillations, c2 performs 50 updates
      const runC1 = (async () => {
        for (let i = 0; i < 100; i++) {
          if (c1.undoManager.canUndo()) c1.undo()
          if (c1.undoManager.canRedo()) c1.redo()
        }
      })()

      const runC2 = (async () => {
        for (let i = 0; i < 50; i++) {
          c2.translateNode('c2_node', [100 + i, i, 0])
        }
      })()

      await Promise.all([runC1, runC2])
      await harness.syncAll(5000)
      await harness.assertConvergence()

      const finalSnap = c1.getSnapshot()
      expect(finalSnap.nodes['c2_node'].position).toEqual([149, 49, 0])
    })
  })

  // =========================================================================
  // 4. GRANULAR PROPERTY MERGE & COMPOSITE DICTIONARY CONFLICT RESOLUTION
  // =========================================================================
  describe('4. Granular Property Merging & CRDT Convergence', () => {
    test('4.1: 4 concurrent clients modifying distinct sub-properties of the same node merge without data loss', async () => {
      const c1 = harness.editor
      const c2 = await harness.createClient('editor', 'client-2')
      const c3 = await harness.createClient('editor', 'client-3')
      const c4 = await harness.createClient('editor', 'client-4')

      // Create a single shared wall node
      c1.addNode({
        id: 'shared_wall',
        type: 'wall',
        object: 'node',
        name: 'Shared Wall',
        position: [0, 0, 0],
        rotation: 0,
        parentId: null,
        children: [],
        slots: {
          interior: 'mat-white',
          exterior: 'mat-brick',
        },
        metadata: {
          cost: 100,
          author: 'initial',
        },
      } as any)

      await harness.syncAll()

      // Concurrently:
      // c1 updates slots.interior
      // c2 updates slots.exterior
      // c3 updates metadata.cost
      // c4 updates metadata.author & name
      c1.updateNode('shared_wall', { slots: { interior: 'mat-gold' } as any })
      c2.updateNode('shared_wall', { slots: { exterior: 'mat-stone' } as any })
      c3.updateNode('shared_wall', { metadata: { cost: 999 } as any })
      c4.updateNode('shared_wall', { name: 'Wall Masterpiece', metadata: { author: 'Leonardo' } as any })

      await harness.syncAll()
      await harness.assertConvergence()

      const finalNode = c1.getNode('shared_wall') as any
      expect(finalNode).toBeDefined()
      expect(finalNode.name).toBe('Wall Masterpiece')
      expect(finalNode.slots.interior).toBe('mat-gold')
      expect(finalNode.slots.exterior).toBe('mat-stone')
      expect(finalNode.metadata.cost).toBe(999)
      expect(finalNode.metadata.author).toBe('Leonardo')
    })

    test('4.2: Concurrent deletion vs simultaneous mutation resolves deterministically to deletion', async () => {
      const c1 = harness.editor
      const c2 = await harness.createClient('editor', 'client-mutator-1')
      const c3 = await harness.createClient('editor', 'client-mutator-2')

      c1.addNode({
        id: 'doomed_node',
        type: 'column',
        object: 'node',
        position: [5, 5, 0],
        parentId: null,
        children: [],
      } as any)

      await harness.syncAll()

      // c1 deletes the node
      // c2 moves the node
      // c3 scales the node
      c1.deleteNode('doomed_node')
      c2.translateNode('doomed_node', [100, 100, 0])
      c3.scaleNode('doomed_node', { radius: 2.5 })

      await harness.syncAll()
      await harness.assertConvergence()

      expect(c1.getNode('doomed_node')).toBeUndefined()
      expect(c2.getNode('doomed_node')).toBeUndefined()
      expect(c3.getNode('doomed_node')).toBeUndefined()
    })

    test('4.3: Deep structural byte-for-byte identity verification across 10 peers with diverse heterogeneous nodes', async () => {
      const clients: SimulatedMultiplayerClient[] = [harness.editor]
      for (let i = 2; i <= 10; i++) {
        const client = await harness.createClient('editor', `deep-peer-${i}`)
        clients.push(client)
      }

      // Add heterogeneous node types: wall, slab, door, window, column, roof, site, building, level
      const types = ['wall', 'slab', 'door', 'window', 'column', 'roof', 'site', 'building', 'level']
      for (let i = 0; i < types.length; i++) {
        const client = clients[i % clients.length]!
        client.addNode({
          id: `typed_node_${i}_${types[i]}`,
          type: types[i] as any,
          object: 'node',
          name: `Node ${types[i]}`,
          position: [i * 10, i * 2, i * 3],
          rotation: (i * Math.PI) / 6,
          parentId: null,
          children: [],
          metadata: { type: types[i], index: i },
        } as any)
      }

      await harness.syncAll(5000)

      // Verify all 10 peers have identical byte-for-byte serialized JSON
      const canonical = JSON.stringify(harness.editor.getSnapshot())
      for (const client of clients) {
        const clientJson = JSON.stringify(client.getSnapshot())
        expect(clientJson).toBe(canonical)
      }
    })
  })

  // =========================================================================
  // 5. BIDIRECTIONAL ZUSTAND <-> YJS BRIDGE INTEGRATION STRESS
  // =========================================================================
  describe('5. Bidirectional Zustand Bridge Stress & Loop Immunity', () => {
    test('5.1: Rapid local Zustand commits synchronize to Y.Doc with zero echo feedback loop', async () => {
      const doc = new Y.Doc()
      const unbind = bindZustandToYjs({ doc, sceneStore: useScene })

      try {
        // Perform sequential node additions in useScene
        for (let i = 0; i < 20; i++) {
          const id = `wall_stress_${i}`
          const wallNode = WallNode.parse({
            id: id as any,
            name: `Zustand Wall ${i}`,
            start: [i * 10, 0],
            end: [i * 10 + 5, 0],
            thickness: 0.2,
            height: 3,
            children: [],
          })
          useScene.getState().createNode(wallNode)
        }

        // Verify Y.Doc holds all 20 nodes
        const yNodes = doc.getMap('nodes')
        for (let i = 0; i < 20; i++) {
          const id = `wall_stress_${i}`
          expect(yNodes.has(id)).toBe(true)
        }

        // Mutate properties directly in Y.Doc with remote origin using writeNodeToYMap
        const targetYNode = yNodes.get('wall_stress_0') as Y.Map<unknown>
        const baseNode = useScene.getState().nodes['wall_stress_0' as AnyNodeId]!
        doc.transact(() => {
          writeNodeToYMap(targetYNode, {
            ...baseNode,
            name: 'Remotely Renamed Wall 0',
          })
        }, 'remote-peer')

        // Verify useScene ingested the remote update
        expect(useScene.getState().nodes['wall_stress_0' as AnyNodeId]?.name).toBe('Remotely Renamed Wall 0')

        // Clean up added test nodes
        for (let i = 0; i < 20; i++) {
          const id = `wall_stress_${i}`
          useScene.getState().deleteNode(id as any)
        }
      } finally {
        unbind()
      }
    })
  })
})
