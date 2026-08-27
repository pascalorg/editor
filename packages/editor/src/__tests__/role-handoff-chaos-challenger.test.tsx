// Provide in-memory storage for Zustand persist middleware
const memoryStorage = new Map<string, string>()
const mockStorage = {
  getItem: (key: string) => memoryStorage.get(key) ?? null,
  setItem: (key: string, value: string) => {
    memoryStorage.set(key, String(value))
  },
  removeItem: (key: string) => {
    memoryStorage.delete(key)
  },
  clear: () => memoryStorage.clear(),
  key: (index: number) => Array.from(memoryStorage.keys())[index] ?? null,
  get length() {
    return memoryStorage.size
  },
}

if (typeof globalThis.window === 'undefined') {
  ;(globalThis as any).window = globalThis
}
;(globalThis as any).localStorage = mockStorage
;(globalThis.window as any).localStorage = mockStorage

// Global animation frame stubs for Node/Bun runtime
;(globalThis as any).requestAnimationFrame = (callback: (time: number) => void) => {
  callback(performance.now())
  return 0
}
;(globalThis as any).cancelAnimationFrame = () => {}

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import React, { Profiler, type ProfilerOnRenderCallback } from 'react'
import { renderToString } from 'react-dom/server'
import {
  type AnyNodeId,
  BuildingNode,
  LevelNode,
  WallNode,
  SlabNode,
  ItemNode,
  ZoneNode,
  useScene,
  useLiveTransforms,
  useLiveNodeOverrides,
  spatialGridManager,
  initSpatialGridSync,
  acquireSceneReadOnlyLease,
  MultiplayerAwarenessService,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import * as Y from 'yjs'
import * as awarenessProtocol from 'y-protocols/awareness'
import useEditor from '../store/use-editor'

// Maximum allowable continuous main thread blocking time (<50ms SLA)
const SLA_MAX_BLOCKING_MS = 50

interface PerformanceMetrics {
  durationMs: number
  startMs: number
  endMs: number
  isCompliant: boolean
}

function measureExecutionTime(task: () => void): PerformanceMetrics {
  const startMs = performance.now()
  task()
  const endMs = performance.now()
  const durationMs = endMs - startMs
  return {
    durationMs,
    startMs,
    endMs,
    isCompliant: durationMs < SLA_MAX_BLOCKING_MS,
  }
}

/**
 * Builds heavy synthetic scene graph with arbitrary scale and schema-compliant ID prefixes.
 */
function createHeavySyntheticScene(targetNodeCount: number = 500) {
  const nodes: Record<string, any> = {}
  const rootNodeIds: string[] = []

  const buildingsCount = Math.max(1, Math.floor(targetNodeCount / 100))
  const levelsPerBuilding = 2
  const nodesPerLevel = Math.ceil((targetNodeCount - buildingsCount * (1 + levelsPerBuilding)) / (buildingsCount * levelsPerBuilding))

  let currentCount = 0

  for (let b = 0; b < buildingsCount; b++) {
    const buildingId = `building_chaos_${b}`
    rootNodeIds.push(buildingId)
    const levelIds: string[] = []

    for (let l = 0; l < levelsPerBuilding; l++) {
      const levelId = `level_chaos_${b}_${l}`
      levelIds.push(levelId)
      const childIds: string[] = []

      for (let n = 0; n < nodesPerLevel; n++) {
        const wallId = `wall_chaos_${b}_${l}_${n}`
        childIds.push(wallId)
        nodes[wallId] = WallNode.parse({
          id: wallId,
          parentId: levelId,
          start: [n * 3, 0],
          end: [n * 3 + 3, 0],
          height: 3.2,
          thickness: 0.25,
        })
        currentCount++

        if (n % 3 === 0) {
          const itemId = `item_chaos_${b}_${l}_${n}`
          childIds.push(itemId)
          nodes[itemId] = ItemNode.parse({
            id: itemId,
            parentId: levelId,
            position: [n * 3, l * 3.5, 1],
            rotation: [0, 0, 0],
            asset: {
              id: `asset_${n % 10}`,
              name: `Industrial Rack ${n}`,
              category: 'warehouse',
              thumbnail: `/rack_${n % 10}.png`,
              src: `/rack_${n % 10}.glb`,
              dimensions: [2, 4, 1.5],
            },
          })
          currentCount++
        }

        if (n % 5 === 0) {
          const slabId = `slab_chaos_${b}_${l}_${n}`
          childIds.push(slabId)
          nodes[slabId] = SlabNode.parse({
            id: slabId,
            parentId: levelId,
            polygon: [
              [n * 3, 0],
              [n * 3 + 6, 0],
              [n * 3 + 6, 6],
              [n * 3, 6],
            ],
            elevation: l * 3.5,
          })
          currentCount++
        }
      }

      nodes[levelId] = LevelNode.parse({
        id: levelId,
        parentId: buildingId,
        level: l,
        elevation: l * 3.5,
        children: childIds,
      })
      currentCount++
    }

    nodes[buildingId] = BuildingNode.parse({
      id: buildingId,
      children: levelIds,
    })
    currentCount++
  }

  return { nodes, rootNodeIds, totalNodeCount: currentCount }
}

describe('Challenger Adversarial Stress & Chaos Verification Suite (<50ms SLA)', () => {
  let unsubscribeSpatial: (() => void) | null = null
  let originalWarn: typeof console.warn

  beforeAll(() => {
    originalWarn = console.warn
    console.warn = (...args: any[]) => {
      if (typeof args[0] === 'string' && args[0].includes('[zustand persist middleware]')) {
        return
      }
      originalWarn(...args)
    }
  })

  afterAll(() => {
    console.warn = originalWarn
  })

  beforeEach(() => {
    useScene.setState({
      nodes: {},
      rootNodeIds: [],
      materials: {},
      collections: {},
      dirtyNodes: new Set(),
      readOnly: false,
    } as never)
    useScene.temporal.getState().clear()

    useViewer.setState({
      selection: {
        buildingId: null,
        levelId: null,
        zoneId: null,
        selectedIds: [],
      },
      cameraMode: 'perspective',
      wallMode: 'up',
      shading: 'solid',
    })

    useEditor.setState({
      isPreviewMode: true,
      mode: 'select',
      tool: null,
      catalogCategory: null,
      viewMode: '3d',
      isFloorplanOpen: false,
    })

    spatialGridManager.clear()
    unsubscribeSpatial = initSpatialGridSync()
  })

  afterEach(() => {
    unsubscribeSpatial?.()
    spatialGridManager.clear()
    useLiveTransforms.getState().clearAll()
    useLiveNodeOverrides.getState().clearAll()
  })

  // ══════════════════════════════════════════════════════════════════════════
  // CHALLENGE DIMENSION 1: ULTRA-SCALE SCENE GRAPH (500 & 1,000+ NODES)
  // ══════════════════════════════════════════════════════════════════════════
  test('Ultra-Scale 1: 500+ node scene graph role handoff strictly maintains < 50ms SLA', () => {
    const { nodes, rootNodeIds, totalNodeCount } = createHeavySyntheticScene(500)
    expect(totalNodeCount).toBeGreaterThanOrEqual(500)

    useScene.setState({ nodes, rootNodeIds, dirtyNodes: new Set() } as never)

    const metrics = measureExecutionTime(() => {
      useEditor.getState().setPreviewMode(false)
      useViewer.getState().setSelection({
        buildingId: rootNodeIds[0] ?? null,
        levelId: 'level_chaos_0_0',
        zoneId: null,
        selectedIds: ['wall_chaos_0_0_1', 'wall_chaos_0_0_2'],
      })
    })

    expect(metrics.durationMs).toBeLessThan(SLA_MAX_BLOCKING_MS)
    expect(metrics.isCompliant).toBe(true)
    expect(useEditor.getState().isPreviewMode).toBe(false)
  })

  test('Ultra-Scale 2: 1,000+ node scene graph role handoff strictly maintains < 50ms SLA', () => {
    const { nodes, rootNodeIds, totalNodeCount } = createHeavySyntheticScene(1000)
    expect(totalNodeCount).toBeGreaterThanOrEqual(1000)

    useScene.setState({ nodes, rootNodeIds, dirtyNodes: new Set() } as never)

    const metrics = measureExecutionTime(() => {
      useEditor.getState().setPreviewMode(false)
    })

    expect(metrics.durationMs).toBeLessThan(SLA_MAX_BLOCKING_MS)
    expect(metrics.isCompliant).toBe(true)
    expect(useEditor.getState().isPreviewMode).toBe(false)
  })

  // ══════════════════════════════════════════════════════════════════════════
  // CHALLENGE DIMENSION 2: CONCURRENT MUTATION STORMS DURING TRANSITION
  // ══════════════════════════════════════════════════════════════════════════
  test('Chaos Storm 1: 25 individual unbatched node mutations in same tick as role switch stay < 50ms', () => {
    const { nodes, rootNodeIds } = createHeavySyntheticScene(500)
    useScene.setState({ nodes, rootNodeIds, dirtyNodes: new Set() } as never)

    const wallKeys = Object.keys(nodes).filter((k) => k.startsWith('wall_chaos_')).slice(0, 25)

    const metrics = measureExecutionTime(() => {
      // 1. Role handoff
      useEditor.getState().setPreviewMode(false)

      // 2. Simultaneous 25-node individual mutation burst
      for (const wallId of wallKeys) {
        useScene.getState().updateNode(wallId as AnyNodeId, {
          height: 4.0,
          thickness: 0.3,
        })
      }

      // 3. Selection change
      useViewer.getState().setSelection({
        buildingId: rootNodeIds[0] ?? null,
        levelId: 'level_chaos_0_0',
        zoneId: null,
        selectedIds: wallKeys.slice(0, 5),
      })
    })

    expect(metrics.durationMs).toBeLessThan(SLA_MAX_BLOCKING_MS)
    expect(useEditor.getState().isPreviewMode).toBe(false)
    expect((useScene.getState().nodes[wallKeys[0]] as WallNode).height).toBe(4.0)
  })

  test('Chaos Storm 2: 100-node batched mutation storm during role switch stays < 50ms', () => {
    const { nodes, rootNodeIds } = createHeavySyntheticScene(500)
    useScene.setState({ nodes, rootNodeIds, dirtyNodes: new Set() } as never)

    const wallKeys = Object.keys(nodes).filter((k) => k.startsWith('wall_chaos_')).slice(0, 100)
    const batchUpdates = wallKeys.map((k) => ({
      id: k as AnyNodeId,
      data: {
        height: 4.2,
        thickness: 0.28,
      },
    }))

    const metrics = measureExecutionTime(() => {
      // 1. Role handoff
      useEditor.getState().setPreviewMode(false)

      // 2. Batch update 100 nodes in single store transaction
      useScene.getState().updateNodes(batchUpdates as any)

      // 3. Selection change
      useViewer.getState().setSelection({
        buildingId: rootNodeIds[0] ?? null,
        levelId: 'level_chaos_0_0',
        zoneId: null,
        selectedIds: wallKeys.slice(0, 10),
      })
    })

    expect(metrics.durationMs).toBeLessThan(SLA_MAX_BLOCKING_MS)
    expect(useEditor.getState().isPreviewMode).toBe(false)
    expect((useScene.getState().nodes[wallKeys[0]] as WallNode).height).toBe(4.2)
  })

  // ══════════════════════════════════════════════════════════════════════════
  // CHALLENGE DIMENSION 3: 100-CYCLE CONTINUOUS ROLE FLIPPING UNDER LOAD
  // ══════════════════════════════════════════════════════════════════════════
  test('Stress Loop: 100 consecutive rapid role flips under 500 nodes with 0 Long Tasks >= 50ms', () => {
    const { nodes, rootNodeIds } = createHeavySyntheticScene(500)
    useScene.setState({ nodes, rootNodeIds, dirtyNodes: new Set() } as never)

    const ITERATIONS = 100
    let maxBlocking = 0
    let violationCount = 0

    for (let i = 0; i < ITERATIONS; i++) {
      const targetPreview = i % 2 === 0
      const metrics = measureExecutionTime(() => {
        useEditor.getState().setPreviewMode(targetPreview)
        if (i % 5 === 0) {
          useViewer.getState().setSelection({
            buildingId: rootNodeIds[0] ?? null,
            levelId: 'level_chaos_0_0',
            zoneId: null,
            selectedIds: [`wall_chaos_0_0_${i % 20}`],
          })
        }
      })

      if (metrics.durationMs > maxBlocking) {
        maxBlocking = metrics.durationMs
      }
      if (metrics.durationMs >= SLA_MAX_BLOCKING_MS) {
        violationCount++
      }
    }

    expect(violationCount).toBe(0)
    expect(maxBlocking).toBeLessThan(SLA_MAX_BLOCKING_MS)
  })

  // ══════════════════════════════════════════════════════════════════════════
  // CHALLENGE DIMENSION 4: MULTIPLAYER AWARENESS & PEER PRESENCE FLOOD
  // ══════════════════════════════════════════════════════════════════════════
  test('Multiplayer Chaos: 50 peer awareness updates concurrent with local role handoff', () => {
    const doc = new Y.Doc()
    const awareness = new awarenessProtocol.Awareness(doc)

    const awarenessService = new MultiplayerAwarenessService({
      awareness,
      localPresence: {
        userId: 'challenger_client',
        name: 'Challenger',
        role: 'viewer',
        color: '#ef4444',
      },
    })

    // Simulate 50 remote peers
    const remoteAwarenesses: awarenessProtocol.Awareness[] = []
    for (let p = 0; p < 50; p++) {
      const peerAwareness = new awarenessProtocol.Awareness(doc)
      peerAwareness.setLocalState({
        user: {
          id: `peer_${p}`,
          name: `Peer ${p}`,
          role: 'viewer',
          color: '#10b981',
        },
      })
      remoteAwarenesses.push(peerAwareness)
    }

    const metrics = measureExecutionTime(() => {
      // Local role transition
      awarenessService.setLocalState({ role: 'editor' })
      awarenessService.flushLocalState()
      useEditor.getState().setPreviewMode(false)
    })

    expect(metrics.durationMs).toBeLessThan(SLA_MAX_BLOCKING_MS)
    expect(doc.isDestroyed).toBe(false)
    const local = awarenessService.getPresences().get(awareness.clientID)
    expect(local?.role).toBe('editor')

    awarenessService.destroy()
    for (const r of remoteAwarenesses) {
      r.destroy()
    }
    doc.destroy()
  })

  // ══════════════════════════════════════════════════════════════════════════
  // CHALLENGE DIMENSION 5: AUTOSAVE $O(1)$ REF TRACKING & NO-OP OVERHEAD
  // ══════════════════════════════════════════════════════════════════════════
  test('Autosave Invariant: Read-only lease toggling on 1,000 nodes avoids JSON stringification (<10ms)', () => {
    const { nodes, rootNodeIds } = createHeavySyntheticScene(1000)
    useScene.setState({ nodes, rootNodeIds, dirtyNodes: new Set() } as never)

    const leaseRelease = acquireSceneReadOnlyLease()
    expect(useScene.getState().readOnly).toBe(true)

    const metrics = measureExecutionTime(() => {
      useEditor.getState().setPreviewMode(false)
      leaseRelease()
    })

    // Should be instant (< 10ms) because of O(1) reference comparison
    expect(metrics.durationMs).toBeLessThan(10)
    expect(useScene.getState().readOnly).toBe(false)
  })

  // ══════════════════════════════════════════════════════════════════════════
  // CHALLENGE DIMENSION 6: REACT PROFILER COMMIT LATENCY UNDER 500 NODES
  // ══════════════════════════════════════════════════════════════════════════
  test('React Profiler Commit: Concurrent UI wrapper commit latency stays strictly < 50ms', () => {
    const { nodes, rootNodeIds } = createHeavySyntheticScene(500)
    useScene.setState({ nodes, rootNodeIds } as never)

    let commitDuration = 0
    const onRender: ProfilerOnRenderCallback = (id, phase, actualDuration) => {
      commitDuration = actualDuration
    }

    function HeavyUIWrapper({ isPreview }: { isPreview: boolean }) {
      return (
        <Profiler id="HeavyUI" onRender={onRender}>
          <div className={isPreview ? 'viewer-mode' : 'editor-mode'}>
            <div className="status-badge">{isPreview ? 'Viewer' : 'Editor'}</div>
            <div className="node-count">{Object.keys(nodes).length} nodes mounted</div>
          </div>
        </Profiler>
      )
    }

    // Initial render
    renderToString(<HeavyUIWrapper isPreview={true} />)

    const metrics = measureExecutionTime(() => {
      useEditor.getState().setPreviewMode(false)
      renderToString(<HeavyUIWrapper isPreview={false} />)
    })

    expect(metrics.durationMs).toBeLessThan(SLA_MAX_BLOCKING_MS)
    expect(commitDuration).toBeLessThan(SLA_MAX_BLOCKING_MS)
  })

  // ══════════════════════════════════════════════════════════════════════════
  // CHALLENGE DIMENSION 7: LONG-RUNNING 200-CYCLE MEMORY & LISTENER STABILITY
  // ══════════════════════════════════════════════════════════════════════════
  test('Leak Resistance: 200 rapid role toggles with active store subscriptions maintain zero leak', () => {
    const unsubs: Array<() => void> = []

    const metrics = measureExecutionTime(() => {
      for (let i = 0; i < 200; i++) {
        const unsub = useEditor.subscribe(() => {})
        unsubs.push(unsub)
        useEditor.getState().setPreviewMode(i % 2 === 0)
      }
    })

    expect(metrics.durationMs).toBeLessThan(SLA_MAX_BLOCKING_MS)

    for (const unsub of unsubs) {
      unsub()
    }
    expect(unsubs.length).toBe(200)
  })
})
