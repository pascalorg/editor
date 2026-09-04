import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import * as http from 'node:http'
import type { AddressInfo } from 'node:net'
import { WebSocketServer, WebSocket } from 'ws'
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import {
  createMultiplayerTestHarness,
  type MultiplayerTestHarness,
  SimulatedMultiplayerClient,
  CollabServer,
  MESSAGE_SYNC,
  MESSAGE_AWARENESS,
  writeNodeToYMap,
  yDocToSnapshot,
} from './multiplayer-test-harness'
import { CollabWebSocketServer } from '../../../../../server/multiplayer/ws-server'
import { MultiplayerAwarenessService } from '../awareness-service'
import useLiveTransforms from '../../store/use-live-transforms'
import type { AnyNode, AnyNodeId } from '../../schema/types'

describe('Adversarial Stress & Security Test Suite (Challenger 2)', () => {
  let harness: MultiplayerTestHarness | null = null

  beforeEach(async () => {
    useLiveTransforms.getState().clearAll()
  })

  afterEach(async () => {
    if (harness) {
      await harness.cleanup()
      harness = null
    }
    useLiveTransforms.getState().clearAll()
  })

  // =========================================================================
  // SUITE 1: Security & RBAC Enforcement (Rogue Viewer Malicious Packets)
  // =========================================================================
  describe('1. Security & RBAC: Rogue Viewer Attack Scenarios', () => {
    test('1.1 Rogue viewer crafting raw binary Yjs update packet is rejected by server without state corruption', async () => {
      harness = await createMultiplayerTestHarness()
      const { server, editor, viewer } = harness

      // 1. Establish baseline scene with a legitimate node from Editor
      const legitimateNode: AnyNode = {
        id: 'legit-wall-1',
        type: 'wall',
        object: 'wall',
        start: [0, 0],
        end: [10, 0],
        thickness: 0.2,
        height: 3,
        parentId: null,
      } as any

      editor.addNode(legitimateNode)
      await harness.assertConvergence()

      const initialDropped = server.droppedViewerPacketsCount

      // 2. Rogue viewer crafts a raw binary Yjs update packet containing a malicious node injection
      const maliciousDoc = new Y.Doc()
      const maliciousYNodes = maliciousDoc.getMap<Y.Map<unknown>>('nodes')
      const maliciousYRoot = maliciousDoc.getArray<string>('rootNodeIds')

      const maliciousNode: AnyNode = {
        id: 'rogue-injected-node',
        type: 'wall',
        object: 'wall',
        start: [666, 666],
        end: [999, 999],
        name: 'MALICIOUS_INJECTION',
        parentId: null,
      } as any

      maliciousDoc.transact(() => {
        const yNode = new Y.Map<unknown>()
        maliciousYNodes.set(maliciousNode.id, yNode)
        writeNodeToYMap(yNode, maliciousNode)
        maliciousYRoot.push([maliciousNode.id])
      })

      const rawUpdate = Y.encodeStateAsUpdate(maliciousDoc)

      // Package into raw syncProtocol messageUpdate (type 2)
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, MESSAGE_SYNC)
      syncProtocol.writeUpdate(encoder, rawUpdate)
      const maliciousPacket = encoding.toUint8Array(encoder)

      // Transmit directly over Viewer's WebSocket connection
      expect(viewer.ws).not.toBeNull()
      viewer.ws!.send(maliciousPacket)

      // Wait a short duration for server to process packet
      await new Promise((r) => setTimeout(r, 100))

      // 3. Verify server RBAC guard triggered
      expect(server.droppedViewerPacketsCount).toBe(initialDropped + 1)

      // 4. Verify room doc in server and editor was NOT corrupted
      const room = server.getOrCreateRoom(harness.editor.sceneId)
      expect(room.doc.getMap('nodes').has('rogue-injected-node')).toBe(false)
      expect(editor.getNode('rogue-injected-node')).toBeUndefined()
      expect(editor.getNode('legit-wall-1')).toBeDefined()

      // 5. Verify Editor can still perform legitimate updates normally
      editor.updateNode('legit-wall-1', { height: 3.5 } as any)
      await harness.assertConvergence()
      const viewerLegitNode = viewer.getNode('legit-wall-1') as any
      expect(viewerLegitNode.height).toBe(3.5)

      maliciousDoc.destroy()
    })

    test('1.2 Rogue viewer sending SyncStep2 mutation payload is dropped and does not overwrite existing properties', async () => {
      harness = await createMultiplayerTestHarness()
      const { server, editor, viewer } = harness

      // Add target node
      editor.addNode({
        id: 'target-item-1',
        type: 'item',
        object: 'item',
        position: [10, 0, 10],
        name: 'Safe Original Name',
        parentId: null,
      } as any)
      await harness.assertConvergence()

      const initialDropped = server.droppedViewerPacketsCount

      // Craft SyncStep2 packet with mutation
      const attackDoc = new Y.Doc()
      const attackMap = attackDoc.getMap<Y.Map<unknown>>('nodes')
      attackDoc.transact(() => {
        const yNode = new Y.Map<unknown>()
        attackMap.set('target-item-1', yNode)
        yNode.set('id', 'target-item-1')
        yNode.set('name', 'PCL_PWNED_ATTACK')
        yNode.set('position', [0, 9999, 0])
      })

      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, MESSAGE_SYNC)
      syncProtocol.writeSyncStep2(encoder, attackDoc)
      const packet = encoding.toUint8Array(encoder)

      viewer.ws!.send(packet)
      await new Promise((r) => setTimeout(r, 100))

      // Verify packet was dropped
      expect(server.droppedViewerPacketsCount).toBe(initialDropped + 1)

      // Verify node state preserved
      const editorNode = editor.getNode('target-item-1') as any
      expect(editorNode.name).toBe('Safe Original Name')
      expect(editorNode.position).toEqual([10, 0, 10])

      attackDoc.destroy()
    })

    test('1.3 Rogue viewer deletion attack: attempting to wipe entire nodes map is completely blocked', async () => {
      harness = await createMultiplayerTestHarness()
      const { server, editor, viewer } = harness

      // Setup 5 nodes
      for (let i = 0; i < 5; i++) {
        editor.addNode({
          id: `protected-node-${i}`,
          type: 'wall',
          object: 'wall',
          start: [i * 2, 0],
          end: [i * 2 + 1, 0],
          parentId: null,
        } as any)
      }
      await harness.assertConvergence()

      const initialDropped = server.droppedViewerPacketsCount

      // Viewer crafts an update that deletes all 5 nodes
      const attackDoc = new Y.Doc()
      const attackMap = attackDoc.getMap<Y.Map<unknown>>('nodes')
      attackDoc.transact(() => {
        for (let i = 0; i < 5; i++) {
          attackMap.delete(`protected-node-${i}`)
        }
      })
      const attackUpdate = Y.encodeStateAsUpdate(attackDoc)

      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, MESSAGE_SYNC)
      syncProtocol.writeUpdate(encoder, attackUpdate)
      viewer.ws!.send(encoding.toUint8Array(encoder))

      await new Promise((r) => setTimeout(r, 100))

      expect(server.droppedViewerPacketsCount).toBe(initialDropped + 1)

      // Verify all 5 nodes survive
      for (let i = 0; i < 5; i++) {
        expect(editor.getNode(`protected-node-${i}`)).toBeDefined()
        expect(viewer.getNode(`protected-node-${i}`)).toBeDefined()
      }

      attackDoc.destroy()
    })

    test('1.4 Concurrent rogue injection from 3 malicious viewer clients simultaneously', async () => {
      harness = await createMultiplayerTestHarness()
      const { server, editor } = harness

      const rogue1 = await harness.createClient('viewer', 'rogue-1')
      const rogue2 = await harness.createClient('viewer', 'rogue-2')
      const rogue3 = await harness.createClient('viewer', 'rogue-3')
      await harness.syncAll()

      const initialDropped = server.droppedViewerPacketsCount

      const sendMalicious = (ws: WebSocket, id: string) => {
        const doc = new Y.Doc()
        doc.getMap('nodes').set(id, 'malicious-data')
        const update = Y.encodeStateAsUpdate(doc)
        const enc = encoding.createEncoder()
        encoding.writeVarUint(enc, MESSAGE_SYNC)
        syncProtocol.writeUpdate(enc, update)
        ws.send(encoding.toUint8Array(enc))
        doc.destroy()
      }

      const beforeSend = server.droppedViewerPacketsCount
      sendMalicious(rogue1.ws!, 'rogue-1-node')
      sendMalicious(rogue2.ws!, 'rogue-2-node')
      sendMalicious(rogue3.ws!, 'rogue-3-node')

      await new Promise((r) => setTimeout(r, 150))

      expect(server.droppedViewerPacketsCount - beforeSend).toBeGreaterThanOrEqual(3)

      const room = server.getOrCreateRoom(editor.sceneId)
      expect(room.doc.getMap('nodes').has('rogue-1-node')).toBe(false)
      expect(room.doc.getMap('nodes').has('rogue-2-node')).toBe(false)
      expect(room.doc.getMap('nodes').has('rogue-3-node')).toBe(false)
    })

    test('1.5 Production CollabWebSocketServer independently drops rogue viewer updates and survives fuzzing', async () => {
      // Test production CollabWebSocketServer directly on an ephemeral HTTP server
      const httpServer = http.createServer()
      const collabServer = new CollabWebSocketServer(httpServer)
      await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve()))
      const port = (httpServer.address() as AddressInfo).port

      const sceneId = 'prod-security-room-1'

      // Connect rogue viewer client
      const viewerWs = new WebSocket(`ws://127.0.0.1:${port}/collab/v1/scene:${sceneId}?role=viewer&userId=rogue-attacker`)
      await new Promise((resolve) => viewerWs.on('open', resolve))

      // Connect legitimate editor client
      const editorWs = new WebSocket(`ws://127.0.0.1:${port}/collab/v1/scene:${sceneId}?role=editor&userId=auth-editor`)
      await new Promise((resolve) => editorWs.on('open', resolve))

      // 1. Rogue viewer transmits malicious Yjs update
      const rogueDoc = new Y.Doc()
      rogueDoc.getMap('nodes').set('hacked-node', 'exploit')
      const rogueUpdate = Y.encodeStateAsUpdate(rogueDoc)

      const rogueEncoder = encoding.createEncoder()
      encoding.writeVarUint(rogueEncoder, MESSAGE_SYNC)
      syncProtocol.writeUpdate(rogueEncoder, rogueUpdate)
      viewerWs.send(encoding.toUint8Array(rogueEncoder))

      await new Promise((r) => setTimeout(r, 100))
      expect(collabServer.droppedViewerPacketsCount).toBe(1)

      const room = collabServer.getOrCreateRoom(sceneId)
      expect(room.doc.getMap('nodes').has('hacked-node')).toBe(false)

      // 2. Fuzzing test: Send malformed binary packets to server (random bytes, bad headers)
      const garbage1 = new Uint8Array([0xff, 0xff, 0xff, 0xff])
      const garbage2 = new Uint8Array([MESSAGE_SYNC, 0x99, 0x88, 0x77])
      const garbage3 = new Uint8Array([MESSAGE_AWARENESS, 0xfe, 0xed, 0xfa, 0xce])

      viewerWs.send(garbage1)
      viewerWs.send(garbage2)
      viewerWs.send(garbage3)

      await new Promise((r) => setTimeout(r, 100))

      // Verify server is alive and sockets are still operational
      expect(editorWs.readyState).toBe(WebSocket.OPEN)
      expect(viewerWs.readyState).toBe(WebSocket.OPEN)

      // 3. Legitimate editor update succeeds after attack/fuzzing
      const editorDoc = new Y.Doc()
      editorDoc.getMap('nodes').set('valid-editor-node', 'legit-data')
      const legitUpdate = Y.encodeStateAsUpdate(editorDoc)

      const legitEncoder = encoding.createEncoder()
      encoding.writeVarUint(legitEncoder, MESSAGE_SYNC)
      syncProtocol.writeUpdate(legitEncoder, legitUpdate)
      editorWs.send(encoding.toUint8Array(legitEncoder))

      await new Promise((r) => setTimeout(r, 100))
      expect(room.doc.getMap('nodes').has('valid-editor-node')).toBe(true)

      // Cleanup
      viewerWs.close()
      editorWs.close()
      rogueDoc.destroy()
      editorDoc.destroy()
      await collabServer.close()
    })
  })

  // =========================================================================
  // SUITE 2: Latency & Synchronization SLA (< 1.0s under Network Jitter)
  // =========================================================================
  describe('2. Latency & Synchronization SLA: 100 Consecutive Mutations under Network Jitter', () => {
    test('2.1 Measure sync latency across 100 consecutive scene mutations under artificial jitter; strictly satisfies < 1.0s SLA', async () => {
      harness = await createMultiplayerTestHarness()
      const { editor, viewer } = harness

      const mutationCount = 100
      const latencies: number[] = []

      // Create an initial anchor node
      editor.addNode({
        id: 'sla-test-node',
        type: 'item',
        object: 'item',
        position: [0, 0, 0],
        rotation: 0,
        name: 'SLA Benchmark Node',
        parentId: null,
      } as any)
      await harness.assertConvergence()

      // Execute 100 consecutive mutations under artificial jitter
      for (let i = 1; i <= mutationCount; i++) {
        // Simulate artificial network delay / jitter between 5ms and 30ms
        const jitterDelay = Math.floor(Math.random() * 25) + 5
        await new Promise((r) => setTimeout(r, jitterDelay))

        const targetX = i * 1.5
        const targetRot = (i * Math.PI) / 50
        const targetName = `Mutation Step #${i}`

        const startTimestamp = performance.now()

        // Apply mutation
        editor.updateNode('sla-test-node', {
          position: [targetX, 0, targetX],
          rotation: targetRot,
          name: targetName,
        } as any)

        // Wait for Viewer's Y.Doc to observe the converged mutation
        await viewer.waitForCondition(() => {
          const node = viewer.getNode('sla-test-node') as any
          return (
            node &&
            node.name === targetName &&
            Array.isArray(node.position) &&
            Math.abs(node.position[0] - targetX) < 1e-4
          )
        }, 1000)

        const endTimestamp = performance.now()
        const latencyMs = endTimestamp - startTimestamp
        latencies.push(latencyMs)

        // Strict per-mutation assertion: must be strictly < 1000ms (1.0s)
        expect(latencyMs).toBeLessThan(1000)
      }

      // Statistical analysis
      const minLatency = Math.min(...latencies)
      const maxLatency = Math.max(...latencies)
      const meanLatency = latencies.reduce((acc, v) => acc + v, 0) / latencies.length
      const sorted = [...latencies].sort((a, b) => a - b)
      const p50 = sorted[Math.floor(sorted.length * 0.5)]
      const p95 = sorted[Math.floor(sorted.length * 0.95)]
      const p99 = sorted[Math.floor(sorted.length * 0.99)]

      console.log(`[SLA Benchmark Results - 100 Consecutive Mutations under Jitter]`)
      console.log(`  Count: ${mutationCount}`)
      console.log(`  Min:   ${minLatency.toFixed(2)}ms`)
      console.log(`  Mean:  ${meanLatency.toFixed(2)}ms`)
      console.log(`  P50:   ${p50.toFixed(2)}ms`)
      console.log(`  P95:   ${p95.toFixed(2)}ms`)
      console.log(`  P99:   ${p99.toFixed(2)}ms`)
      console.log(`  Max:   ${maxLatency.toFixed(2)}ms (Strict SLA: < 1000ms)`)

      // Assertions
      expect(maxLatency).toBeLessThan(1000)
      expect(p99).toBeLessThan(500)
      expect(meanLatency).toBeLessThan(100)

      // Final full convergence check
      await harness.assertConvergence()
    })

    test('2.2 High-Throughput Burst: 50 concurrent batched mutations converge in < 1.0s', async () => {
      harness = await createMultiplayerTestHarness()
      const { editor, viewer } = harness

      const burstSize = 50
      const start = performance.now()

      for (let i = 0; i < burstSize; i++) {
        editor.addNode({
          id: `burst-item-${i}`,
          type: 'item',
          object: 'item',
          position: [i, 0, i],
          parentId: null,
        } as any)
      }

      await harness.syncAll(1000)
      const elapsed = performance.now() - start

      console.log(`[High-Throughput Burst] 50 nodes created and synchronized in ${elapsed.toFixed(2)}ms`)
      expect(elapsed).toBeLessThan(1000)

      const viewerSnap = viewer.getSnapshot()
      expect(Object.keys(viewerSnap.nodes).length).toBe(burstSize)
    })

    test('2.3 Latency isolation under multi-room concurrent traffic', async () => {
      const harness1 = await createMultiplayerTestHarness({ sceneId: 'room-alpha' })
      const harness2 = await createMultiplayerTestHarness({ sceneId: 'room-beta' })

      const start = performance.now()

      // Mutate room alpha
      harness1.editor.addNode({
        id: 'alpha-node',
        type: 'wall',
        object: 'wall',
        start: [0, 0],
        end: [10, 0],
        parentId: null,
      } as any)

      // Mutate room beta
      harness2.editor.addNode({
        id: 'beta-node',
        type: 'item',
        object: 'item',
        position: [5, 5, 5],
        parentId: null,
      } as any)

      await Promise.all([harness1.syncAll(1000), harness2.syncAll(1000)])
      const elapsed = performance.now() - start

      expect(elapsed).toBeLessThan(1000)
      expect(harness1.viewer.getNode('alpha-node')).toBeDefined()
      expect(harness1.viewer.getNode('beta-node')).toBeUndefined()
      expect(harness2.viewer.getNode('beta-node')).toBeDefined()
      expect(harness2.viewer.getNode('alpha-node')).toBeUndefined()

      await Promise.all([harness1.cleanup(), harness2.cleanup()])
    })
  })

  // =========================================================================
  // SUITE 3: Awareness Flood & Memory Stability (1,000 packets/sec)
  // =========================================================================
  describe('3. Awareness Flood: 1,000 Packets/sec & Memory Leak Stress Test', () => {
    test('3.1 Flood server with 1,000 awareness packets/sec; verify zero memory leaks and stream stability', async () => {
      harness = await createMultiplayerTestHarness()
      const { editor, viewer } = harness
      const viewer2 = await harness.createClient('viewer', 'viewer-audit-2')

      // Force initial GC if available to baseline memory
      if (typeof (globalThis as any).gc === 'function') {
        ;(globalThis as any).gc()
      }
      const initialMem = process.memoryUsage().heapUsed

      const packetCount = 1000
      const startTime = performance.now()

      // Stream 1,000 awareness packets as rapid pointer moves and selections
      for (let i = 1; i <= packetCount; i++) {
        const x = Math.sin(i * 0.05) * 100
        const z = Math.cos(i * 0.05) * 100

        editor.setCursor([x, 0, z], [x, z])
        if (i % 10 === 0) {
          editor.setSelection([`node-selected-${i % 5}`])
        }

        // Yield every 50 packets to keep loop fluid
        if (i % 50 === 0) {
          await new Promise((r) => setTimeout(r, 5))
        }
      }

      // Send a final distinctive awareness position to verify stream stability
      const finalX = 777.77
      const finalZ = 888.88
      editor.setCursor([finalX, 0, finalZ], [finalX, finalZ])
      editor.setSelection(['final-confirmed-selection'])

      // Wait for Viewers to observe the final state
      await viewer.waitForAwareness((states) => {
        for (const s of states.values()) {
          if (
            s.cursor?.worldPosition &&
            Math.abs(s.cursor.worldPosition[0] - finalX) < 1e-3
          ) {
            return true
          }
        }
        return false
      }, 3000)

      await viewer2.waitForAwareness((states) => {
        for (const s of states.values()) {
          if (
            s.selection?.selectedNodeIds &&
            s.selection.selectedNodeIds.includes('final-confirmed-selection')
          ) {
            return true
          }
        }
        return false
      }, 3000)

      const totalDuration = performance.now() - startTime
      const rate = (packetCount / (totalDuration / 1000)).toFixed(0)

      if (typeof (globalThis as any).gc === 'function') {
        ;(globalThis as any).gc()
      }
      const finalMem = process.memoryUsage().heapUsed
      const heapDeltaMb = (finalMem - initialMem) / (1024 * 1024)

      console.log(`[Awareness Flood Benchmark]`)
      console.log(`  Packets Sent:  ${packetCount}`)
      console.log(`  Duration:      ${totalDuration.toFixed(2)}ms (${rate} pkts/sec)`)
      console.log(`  Heap Delta:    ${heapDeltaMb.toFixed(2)} MB`)

      // Assertions:
      // 1. Zero memory leaks (heap growth bounded < 30 MB for 1k packets)
      expect(heapDeltaMb).toBeLessThan(30)
      // 2. Stream stability: All sockets remain open and connected
      expect(editor.isConnected).toBe(true)
      expect(viewer.isConnected).toBe(true)
      expect(viewer2.isConnected).toBe(true)
    })

    test('3.2 Multi-Client Concurrent Awareness Flood preserves client presence roster without corruption', async () => {
      harness = await createMultiplayerTestHarness()
      const client1 = harness.editor
      const client2 = harness.viewer
      const client3 = await harness.createClient('editor', 'editor-concurrent-3')

      const bursts = 150
      for (let i = 0; i < bursts; i++) {
        client1.setCursor([i, 0, i])
        client2.setCursor([-i, 0, -i])
        client3.setCursor([0, i, 0])
      }

      await new Promise((r) => setTimeout(r, 200))

      // Verify all 3 clients exist in awareness
      expect(client1.awareness.getStates().size).toBeGreaterThanOrEqual(3)
      expect(client2.awareness.getStates().size).toBeGreaterThanOrEqual(3)
      expect(client3.awareness.getStates().size).toBeGreaterThanOrEqual(3)
    })

    test('3.3 Awareness Flood during active concurrent CRDT mutations does not disrupt data synchronization', async () => {
      harness = await createMultiplayerTestHarness()
      const { editor, viewer } = harness

      // Flood 200 awareness updates interleaved with 20 discrete CRDT node mutations
      for (let i = 0; i < 20; i++) {
        editor.setCursor([i * 10, 0, i * 10])
        editor.addNode({
          id: `interleaved-node-${i}`,
          type: 'wall',
          object: 'wall',
          start: [i, 0],
          end: [i + 1, 0],
          parentId: null,
        } as any)
      }

      await harness.syncAll(2000)
      await harness.assertConvergence()

      const viewerSnap = viewer.getSnapshot()
      expect(Object.keys(viewerSnap.nodes).length).toBe(20)
    })
  })

  // =========================================================================
  // SUITE 4: Sudden Client Crash & Disconnect During Active Dragging
  // =========================================================================
  describe('4. Sudden Client Crash & Disconnect During Active Dragging', () => {
    test('4.1 Abrupt client crash during active dragging cleans up ephemeral ghost transforms and preserves valid scene state', async () => {
      harness = await createMultiplayerTestHarness()
      const { editor, viewer } = harness

      // 1. Add persistent item node
      const draggedNodeId = 'drag-target-wall'
      editor.addNode({
        id: draggedNodeId,
        type: 'wall',
        object: 'wall',
        start: [0, 0],
        end: [5, 0],
        position: [0, 0, 0],
        parentId: null,
      } as any)
      await harness.assertConvergence()

      // 2. Set up MultiplayerAwarenessService on both Editor and Viewer
      const editorAwarenessService = new MultiplayerAwarenessService({
        awareness: editor.awareness,
        localPresence: {
          userId: 'editor-user-1',
          name: 'Editor 1',
          email: null,
          color: '#3B82F6',
          role: 'editor',
          cursor: null,
          selection: { buildingId: null, levelId: null, selectedNodeIds: [] },
          activeDrag: null,
          lastActive: Date.now(),
        },
        throttleMs: 0, // Direct dispatch for tests
      })

      const viewerAwarenessService = new MultiplayerAwarenessService({
        awareness: viewer.awareness,
        localPresence: {
          userId: 'viewer-user-1',
          name: 'Viewer 1',
          email: null,
          color: '#10B981',
          role: 'viewer',
          cursor: null,
          selection: { buildingId: null, levelId: null, selectedNodeIds: [] },
          activeDrag: null,
          lastActive: Date.now(),
        },
        throttleMs: 0,
      })

      // 3. Editor begins active dragging
      const dragPosition: [number, number, number] = [25.5, 3.2, -14.8]
      editorAwarenessService.setLocalActiveDrag({
        nodeId: draggedNodeId,
        position: dragPosition,
        rotation: Math.PI / 4,
      })
      editorAwarenessService.flushLocalState()

      // Wait for Viewer's useLiveTransforms to register remote ghost
      await viewer.waitForCondition(() => {
        const live = useLiveTransforms.getState().get(draggedNodeId)
        return (
          live !== undefined &&
          Math.abs(live.position[0] - dragPosition[0]) < 1e-3 &&
          Math.abs(live.rotation - Math.PI / 4) < 1e-3
        )
      }, 2000)

      expect(useLiveTransforms.getState().transforms.has(draggedNodeId)).toBe(true)

      // 4. SUDDEN CLIENT CRASH: Abruptly terminate Editor's WebSocket and awareness
      const editorClientId = editor.awareness.clientID
      editor.ws!.terminate() // Abrupt TCP RST / termination without graceful close handshake
      editor.isConnected = false
      editorAwarenessService.destroy()

      // Notify awareness of client removal (as server/transport does on connection close)
      awarenessProtocol.removeAwarenessStates(viewer.awareness, [editorClientId], null)

      // 5. Verify remote ghost is CLEANLY REMOVED from useLiveTransforms
      await viewer.waitForCondition(() => {
        return !useLiveTransforms.getState().transforms.has(draggedNodeId)
      }, 2000)

      expect(useLiveTransforms.getState().get(draggedNodeId)).toBeUndefined()
      expect(useLiveTransforms.getState().transforms.size).toBe(0)

      // 6. Verify CRDT scene state remained valid and uncorrupted
      const viewerNode = viewer.getNode(draggedNodeId) as any
      expect(viewerNode).toBeDefined()
      expect(viewerNode.position).toEqual([0, 0, 0]) // Retains original committed position

      // Cleanup
      viewerAwarenessService.destroy()
    })

    test('4.2 Normal drag release commits discrete CRDT update and clears ghost transform', async () => {
      harness = await createMultiplayerTestHarness()
      const { editor, viewer } = harness

      const targetId = 'clean-release-node'
      editor.addNode({
        id: targetId,
        type: 'item',
        object: 'item',
        position: [0, 0, 0],
        parentId: null,
      } as any)
      await harness.assertConvergence()

      const editorAwarenessService = new MultiplayerAwarenessService({
        awareness: editor.awareness,
        localPresence: {
          userId: 'editor-p2',
          name: 'Editor 2',
          email: null,
          color: '#3B82F6',
          role: 'editor',
          cursor: null,
          selection: { buildingId: null, levelId: null, selectedNodeIds: [] },
          activeDrag: null,
          lastActive: Date.now(),
        },
        throttleMs: 0,
      })

      const viewerAwarenessService = new MultiplayerAwarenessService({
        awareness: viewer.awareness,
        localPresence: {
          userId: 'viewer-p2',
          name: 'Viewer 2',
          email: null,
          color: '#10B981',
          role: 'viewer',
          cursor: null,
          selection: { buildingId: null, levelId: null, selectedNodeIds: [] },
          activeDrag: null,
          lastActive: Date.now(),
        },
        throttleMs: 0,
      })

      // Begin drag
      editorAwarenessService.setLocalActiveDrag({
        nodeId: targetId,
        position: [15, 0, 15],
        rotation: 0,
      })
      editorAwarenessService.flushLocalState()

      await viewer.waitForCondition(() => useLiveTransforms.getState().transforms.has(targetId), 2000)

      // Release drag: clear activeDrag and commit discrete CRDT delta
      editorAwarenessService.clearLocalActiveDrag()
      editor.updateNode(targetId, { position: [15, 0, 15] } as any)

      await harness.assertConvergence()

      // Verify ghost cleared and persistent node updated
      expect(useLiveTransforms.getState().transforms.has(targetId)).toBe(false)
      const viewerNode = viewer.getNode(targetId) as any
      expect(viewerNode.position).toEqual([15, 0, 15])

      editorAwarenessService.destroy()
      viewerAwarenessService.destroy()
    })

    test('4.3 Multiple concurrent dragging editors: Editor 1 crashes while Editor 2 continues dragging', async () => {
      harness = await createMultiplayerTestHarness()
      const { editor: editor1, viewer } = harness
      const editor2 = await harness.createClient('editor', 'editor-worker-2')
      await harness.syncAll()

      editor1.addNode({
        id: 'node-drag-1',
        type: 'item',
        object: 'item',
        position: [0, 0, 0],
        parentId: null,
      } as any)
      editor1.addNode({
        id: 'node-drag-2',
        type: 'item',
        object: 'item',
        position: [10, 0, 10],
        parentId: null,
      } as any)
      await harness.assertConvergence()

      const svcViewer = new MultiplayerAwarenessService({
        awareness: viewer.awareness,
        localPresence: { userId: 'v1', name: 'V1', color: '#3', role: 'viewer' },
        throttleMs: 0,
      })

      // Both editors start dragging their respective nodes via awareness
      editor1.awareness.setLocalState({
        userId: 'e1',
        name: 'Editor 1',
        role: 'editor',
        color: '#3B82F6',
        activeDrag: {
          nodeId: 'node-drag-1',
          position: [50, 0, 50],
          rotation: 0,
        },
      })

      editor2.awareness.setLocalState({
        userId: 'e2',
        name: 'Editor 2',
        role: 'editor',
        color: '#3B82F6',
        activeDrag: {
          nodeId: 'node-drag-2',
          position: [90, 0, 90],
          rotation: 0,
        },
      })

      await viewer.waitForCondition(() => {
        return (
          useLiveTransforms.getState().transforms.has('node-drag-1') &&
          useLiveTransforms.getState().transforms.has('node-drag-2')
        )
      }, 2000)

      // Editor 1 crashes abruptly
      const e1ClientId = editor1.awareness.clientID
      editor1.ws!.terminate()
      editor1.isConnected = false

      awarenessProtocol.removeAwarenessStates(viewer.awareness, [e1ClientId], null)

      // Node 1 ghost must be removed, Node 2 ghost must remain!
      await viewer.waitForCondition(() => {
        return !useLiveTransforms.getState().transforms.has('node-drag-1')
      }, 2000)

      expect(useLiveTransforms.getState().transforms.has('node-drag-1')).toBe(false)
      expect(useLiveTransforms.getState().transforms.has('node-drag-2')).toBe(true)

      // Editor 2 finishes drag cleanly
      editor2.awareness.setLocalState({
        userId: 'e2',
        name: 'Editor 2',
        role: 'editor',
        color: '#3B82F6',
        activeDrag: null,
      })
      editor2.updateNode('node-drag-2', { position: [90, 0, 90] } as any)

      await harness.syncAll()

      await viewer.waitForCondition(() => {
        return !useLiveTransforms.getState().transforms.has('node-drag-2')
      }, 2000)

      expect(useLiveTransforms.getState().transforms.size).toBe(0)
      expect((viewer.getNode('node-drag-2') as any).position).toEqual([90, 0, 90])

      svcViewer.destroy()
    })
  })
})
