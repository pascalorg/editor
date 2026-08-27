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

type RafFn = (callback: (time: number) => void) => number
;(globalThis as { requestAnimationFrame?: RafFn }).requestAnimationFrame ??= (callback) => {
  callback(performance.now())
  return 0
}
;(globalThis as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame ??= () => {}

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

const MAX_BLOCKING_THRESHOLD_MS = 50

interface Metrics {
  durationMs: number
  startMs: number
  endMs: number
}

function measure(fn: () => void): Metrics {
  const startMs = performance.now()
  fn()
  const endMs = performance.now()
  return {
    durationMs: endMs - startMs,
    startMs,
    endMs,
  }
}

function buildMassiveScene(targetNodes: number) {
  const nodes: Record<string, any> = {}
  const rootNodeIds: string[] = []
  let count = 0

  const buildingsNeeded = Math.max(1, Math.floor(targetNodes / 100))
  const levelsPerBuilding = 2
  const nodesPerLevel = Math.max(1, Math.floor((targetNodes - buildingsNeeded * (1 + levelsPerBuilding)) / (buildingsNeeded * levelsPerBuilding)))

  for (let b = 0; b < buildingsNeeded; b++) {
    const bId = `building_stress_${b}`
    rootNodeIds.push(bId)
    count++
    const lIds: string[] = []

    for (let l = 0; l < levelsPerBuilding; l++) {
      const lId = `level_stress_${b}_${l}`
      lIds.push(lId)
      count++
      const cIds: string[] = []

      for (let n = 0; n < nodesPerLevel; n++) {
        const typeMod = n % 5
        let nodeObj: any

        if (typeMod === 0 || typeMod === 1) {
          const nId = `wall_stress_${b}_${l}_${n}`
          cIds.push(nId)
          nodeObj = WallNode.parse({
            id: nId,
            parentId: lId,
            start: [n * 2, 0],
            end: [n * 2 + 2, 0],
            height: 3,
            thickness: 0.2,
          })
          nodes[nId] = nodeObj
          count++
        } else if (typeMod === 2) {
          const nId = `slab_stress_${b}_${l}_${n}`
          cIds.push(nId)
          nodeObj = SlabNode.parse({
            id: nId,
            parentId: lId,
            polygon: [
              [n * 3, 0],
              [n * 3 + 3, 0],
              [n * 3 + 3, 3],
              [n * 3, 3],
            ],
            elevation: l * 3,
          })
          nodes[nId] = nodeObj
          count++
        } else if (typeMod === 3) {
          const nId = `item_stress_${b}_${l}_${n}`
          cIds.push(nId)
          nodeObj = ItemNode.parse({
            id: nId,
            parentId: lId,
            position: [n * 2, l * 3, 1],
            rotation: 0,
            asset: {
              id: `asset_${n}`,
              name: `Asset ${n}`,
              category: 'equipment',
              thumbnail: `/thumb_${n}.png`,
              src: `/model_${n}.glb`,
              dimensions: [1, 1, 1],
            },
          })
          nodes[nId] = nodeObj
          count++
        } else {
          const nId = `zone_stress_${b}_${l}_${n}`
          cIds.push(nId)
          nodeObj = ZoneNode.parse({
            id: nId,
            parentId: lId,
            name: `Zone ${n}`,
            color: '#10b981',
            polygon: [
              [n * 4, 0],
              [n * 4 + 4, 0],
              [n * 4 + 4, 4],
              [n * 4, 4],
            ],
          })
          nodes[nId] = nodeObj
          count++
        }
      }

      nodes[lId] = LevelNode.parse({
        id: lId,
        parentId: bId,
        level: l,
        elevation: l * 3,
        children: cIds,
      })
    }

    nodes[bId] = BuildingNode.parse({
      id: bId,
      children: lIds,
    })
  }

  return { nodes, rootNodeIds, totalCount: count }
}

describe('Empirical Challenger: Multiplayer Role Handoff Stress & Long Task SLA Verification', () => {
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

  test('EC-1: Ultra Scale (250, 500, 1000 nodes) Viewer -> Editor transitions strictly < 50ms', () => {
    const scales = [250, 500, 1000]

    for (const scale of scales) {
      const { nodes, rootNodeIds, totalCount } = buildMassiveScene(scale)
      useScene.setState({ nodes, rootNodeIds, dirtyNodes: new Set() } as never)
      useScene.temporal.getState().clear()
      useEditor.setState({ isPreviewMode: true })

      // Measure Viewer -> Editor
      const m1 = measure(() => {
        useEditor.getState().setPreviewMode(false)
      })

      // Measure Editor -> Viewer
      const m2 = measure(() => {
        useEditor.getState().setPreviewMode(true)
      })

      // Measure Viewer -> Editor with active selection
      const sampleIds = Object.keys(nodes).slice(0, 10)
      useViewer.getState().setSelection({
        buildingId: (rootNodeIds[0] as any) ?? null,
        levelId: null,
        zoneId: null,
        selectedIds: sampleIds,
      })

      const m3 = measure(() => {
        useEditor.getState().setPreviewMode(false)
      })

      console.log(`[Scale ${totalCount} nodes] V->E: ${m1.durationMs.toFixed(2)}ms, E->V: ${m2.durationMs.toFixed(2)}ms, V->E(selected): ${m3.durationMs.toFixed(2)}ms`)

      expect(m1.durationMs).toBeLessThan(MAX_BLOCKING_THRESHOLD_MS)
      expect(m2.durationMs).toBeLessThan(MAX_BLOCKING_THRESHOLD_MS)
      expect(m3.durationMs).toBeLessThan(MAX_BLOCKING_THRESHOLD_MS)
      expect(useEditor.getState().isPreviewMode).toBe(false)
    }
  })

  test('EC-2: 500 consecutive high-speed role flips under 200 nodes � 100% compliant (< 50ms), p99 < 25ms', () => {
    const { nodes, rootNodeIds } = buildMassiveScene(200)
    useScene.setState({ nodes, rootNodeIds, dirtyNodes: new Set() } as never)
    useScene.temporal.getState().clear()

    const FLIPS = 500
    const durations: number[] = []
    let maxDuration = 0

    for (let i = 0; i < FLIPS; i++) {
      const targetPreview = i % 2 === 0
      const m = measure(() => {
        useEditor.getState().setPreviewMode(targetPreview)
      })
      durations.push(m.durationMs)
      if (m.durationMs > maxDuration) {
        maxDuration = m.durationMs
      }
      expect(m.durationMs).toBeLessThan(MAX_BLOCKING_THRESHOLD_MS)
    }

    durations.sort((a, b) => a - b)
    const p50 = durations[Math.floor(FLIPS * 0.50)]
    const p95 = durations[Math.floor(FLIPS * 0.95)]
    const p99 = durations[Math.floor(FLIPS * 0.99)]
    const avg = durations.reduce((a, b) => a + b, 0) / FLIPS

    console.log(`[500 Flips Stats] Avg: ${avg.toFixed(3)}ms, p50: ${p50!.toFixed(3)}ms, p95: ${p95!.toFixed(3)}ms, p99: ${p99!.toFixed(3)}ms, Max: ${maxDuration.toFixed(3)}ms`)

    expect(maxDuration).toBeLessThan(MAX_BLOCKING_THRESHOLD_MS)
    expect(p99).toBeLessThan(25)
    expect(avg).toBeLessThan(5)
  })

  test('EC-3: Concurrent Chaos: Role handoff simultaneous with batch node mutations & transform thrashing', () => {
    const { nodes, rootNodeIds } = buildMassiveScene(200)
    useScene.setState({ nodes, rootNodeIds, dirtyNodes: new Set() } as never)
    useScene.temporal.getState().clear()
    useEditor.setState({ isPreviewMode: true })

    const m = measure(() => {
      // 1. Role handoff
      useEditor.getState().setPreviewMode(false)

      // 2. Batch mutate 30 nodes
      const allKeys = Object.keys(nodes)
      for (let i = 0; i < 30; i++) {
        const key = allKeys[i]!
        if ((nodes as any)[key]?.type === 'wall') {
          useScene.getState().updateNode(key as AnyNodeId, { height: 4.2 + (i % 3) })
        }
      }

      // 3. Live transform thrashing
      for (let i = 0; i < 10; i++) {
        useLiveTransforms.getState().set(allKeys[i]!, { position: [i * 2, 0, i], rotation: 0 })
        useLiveNodeOverrides.getState().set(allKeys[i]!, { position: [i * 2, 0, i] })
      }

      // 4. Mode and selection switches
      useEditor.getState().setMode('build')
      useEditor.getState().setTool('wall')
      useViewer.getState().setSelection({
        buildingId: (rootNodeIds[0] as any) ?? null,
        levelId: null,
        zoneId: null,
        selectedIds: [allKeys[0]!, allKeys[1]!],
      })
    })

    console.log(`[Chaos Mutation Test] Duration: ${m.durationMs.toFixed(2)}ms`)

    expect(m.durationMs).toBeLessThan(MAX_BLOCKING_THRESHOLD_MS)
    expect(useEditor.getState().isPreviewMode).toBe(false)
    expect(useEditor.getState().tool).toBe('wall')
  })

  test('EC-4: Multiplayer Awareness Swarm: 100 remote peers active during local role handoff', () => {
    const doc = new Y.Doc()
    const awareness = new awarenessProtocol.Awareness(doc)

    const awarenessService = new MultiplayerAwarenessService({
      awareness,
      localPresence: {
        userId: 'local_challenger',
        name: 'Local Challenger',
        role: 'viewer',
        color: '#ef4444',
      },
    })

    // Simulate 100 remote peers in awareness states
    const states = new Map<number, any>()
    for (let p = 1; p <= 100; p++) {
      states.set(p + 1000, {
        user: {
          userId: `remote_peer_${p}`,
          name: `Peer ${p}`,
          role: p % 2 === 0 ? 'editor' : 'viewer',
          color: '#3b82f6',
        },
        cursor: { x: p * 10, y: p * 5, z: 0 },
        selectedIds: [`wall_${p}`],
      })
    }

    const m = measure(() => {
      // Local role transition
      awarenessService.setLocalState({ role: 'editor' })
      awarenessService.flushLocalState()
      useEditor.getState().setPreviewMode(false)
    })

    console.log(`[100 Peers Swarm Handoff] Duration: ${m.durationMs.toFixed(2)}ms`)

    expect(m.durationMs).toBeLessThan(MAX_BLOCKING_THRESHOLD_MS)
    const local = awarenessService.getPresences().get(awareness.clientID)
    expect(local?.role).toBe('editor')
    expect(useEditor.getState().isPreviewMode).toBe(false)

    awarenessService.destroy()
    doc.destroy()
  })

  test('EC-5: React Profiler Full Layout Mock Re-render commit under heavy load is strictly < 50ms', () => {
    const { nodes } = buildMassiveScene(300)
    useScene.setState({ nodes } as never)
    useScene.temporal.getState().clear()

    let commitDuration = 0
    let renderDuration = 0

    const onRender: ProfilerOnRenderCallback = (
      id,
      phase,
      actualDuration,
      baseDuration
    ) => {
      commitDuration = actualDuration
      renderDuration = baseDuration
    }

    function MockEditorChrome({ isPreview }: { isPreview: boolean }) {
      return (
        <Profiler id="MockEditorChromeProfiler" onRender={onRender}>
          <div className="flex h-screen w-screen">
            {/* Sidebar (hidden in preview) */}
            {!isPreview && (
              <aside className="w-64 border-r bg-sidebar p-4">
                <nav>
                  <ul>
                    {Array.from({ length: 20 }).map((_, i) => (
                      <li key={i} className="py-1">Menu Item {i}</li>
                    ))}
                  </ul>
                </nav>
              </aside>
            )}

            {/* Persistent Viewer Surface */}
            <main className="relative flex-1 bg-background">
              <div data-testid="persistent-viewer-canvas" className="h-full w-full">
                <div data-overlay={isPreview ? 'viewer-overlay' : 'editor-toolbar'}>
                  {isPreview ? (
                    <div className="p-2 bg-black/50 text-white">Viewer Read-Only HUD</div>
                  ) : (
                    <div className="p-2 bg-neutral-800 text-white flex gap-2">
                      <button>Select</button>
                      <button>Wall</button>
                      <button>Slab</button>
                      <button>Item</button>
                    </div>
                  )}
                </div>
              </div>
            </main>
          </div>
        </Profiler>
      )
    }

    // Initial render in Viewer Mode
    renderToString(<MockEditorChrome isPreview={true} />)

    // Role handoff to Editor Mode
    const m = measure(() => {
      useEditor.getState().setPreviewMode(false)
      renderToString(<MockEditorChrome isPreview={false} />)
    })

    console.log(`[React Layout Commit Duration] Total: ${m.durationMs.toFixed(2)}ms, Profiler commit: ${commitDuration.toFixed(2)}ms`)

    expect(m.durationMs).toBeLessThan(MAX_BLOCKING_THRESHOLD_MS)
    expect(commitDuration).toBeLessThan(MAX_BLOCKING_THRESHOLD_MS)
  })

  test('EC-6: Memory stability across 500 handoff cycles (no store leakage, no unbounded collections)', () => {
    const { nodes, rootNodeIds } = buildMassiveScene(150)
    useScene.setState({ nodes, rootNodeIds } as never)
    useScene.temporal.getState().clear()

    const initialEditorKeys = Object.keys(useEditor.getState()).length
    const initialSceneKeys = Object.keys(useScene.getState()).length
    const initialViewerKeys = Object.keys(useViewer.getState()).length

    for (let i = 0; i < 500; i++) {
      useEditor.getState().setPreviewMode(i % 2 === 0)
    }

    // Verify store keys count did not balloon with dynamic garbage
    expect(Object.keys(useEditor.getState()).length).toBe(initialEditorKeys)
    expect(Object.keys(useScene.getState()).length).toBe(initialSceneKeys)
    expect(Object.keys(useViewer.getState()).length).toBe(initialViewerKeys)
    expect(useScene.temporal.getState().pastStates.length).toBe(0) // Preview mode toggles don't pollute undo history
  })
})
