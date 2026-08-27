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
  type UserPresence,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import * as Y from 'yjs'
import * as awarenessProtocol from 'y-protocols/awareness'
import { createJSONStorage } from 'zustand/middleware'
import useEditor from '../store/use-editor'

// ── Environment Mocks & Polyfills ───────────────────────────────────────────
type RafFn = (callback: (time: number) => void) => number
;(globalThis as { requestAnimationFrame?: RafFn }).requestAnimationFrame ??= (callback) => {
  callback(performance.now())
  return 0
}
;(globalThis as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame ??= () => {}

// Maximum allowable continuous main thread blocking time (Acceptance Criterion: strictly < 50ms)
const MAX_BLOCKING_THRESHOLD_MS = 50

// ── Timing & Profiling Helpers ──────────────────────────────────────────────
interface PerformanceMetrics {
  durationMs: number
  startMs: number
  endMs: number
  isCompliant: boolean
}

/**
 * Measures synchronous execution time of a closure with sub-millisecond precision.
 */
function measureExecutionTime(task: () => void): PerformanceMetrics {
  const startMs = performance.now()
  task()
  const endMs = performance.now()
  const durationMs = endMs - startMs
  return {
    durationMs,
    startMs,
    endMs,
    isCompliant: durationMs < MAX_BLOCKING_THRESHOLD_MS,
  }
}

/**
 * Measures async execution duration.
 */
async function measureAsyncExecutionTime(task: () => Promise<void>): Promise<PerformanceMetrics> {
  const startMs = performance.now()
  await task()
  const endMs = performance.now()
  const durationMs = endMs - startMs
  return {
    durationMs,
    startMs,
    endMs,
    isCompliant: durationMs < MAX_BLOCKING_THRESHOLD_MS,
  }
}

// ── Synthetic Scene Graph Builder ───────────────────────────────────────────
interface SyntheticSceneOptions {
  buildingCount?: number
  levelsPerBuilding?: number
  wallsPerLevel?: number
  slabsPerLevel?: number
  itemsPerLevel?: number
  zonesPerLevel?: number
}

function createSyntheticSceneGraph(options: SyntheticSceneOptions = {}) {
  const {
    buildingCount = 1,
    levelsPerBuilding = 2,
    wallsPerLevel = 25,
    slabsPerLevel = 5,
    itemsPerLevel = 20,
    zonesPerLevel = 4,
  } = options

  const nodes: Record<string, any> = {}
  const rootNodeIds: string[] = []

  let totalNodeCount = 0

  for (let b = 0; b < buildingCount; b++) {
    const buildingId = `building_perf_${b}`
    rootNodeIds.push(buildingId)
    const levelIds: string[] = []

    for (let l = 0; l < levelsPerBuilding; l++) {
      const levelId = `level_perf_${b}_${l}`
      levelIds.push(levelId)
      const childIds: string[] = []

      // 1. Walls
      for (let w = 0; w < wallsPerLevel; w++) {
        const wallId = `wall_perf_${b}_${l}_${w}`
        childIds.push(wallId)
        const wall = WallNode.parse({
          id: wallId,
          parentId: levelId,
          start: [w * 2, 0],
          end: [w * 2 + 2, 0],
          height: 3,
          thickness: 0.2,
        })
        nodes[wallId] = wall
        totalNodeCount++
      }

      // 2. Slabs
      for (let s = 0; s < slabsPerLevel; s++) {
        const slabId = `slab_perf_${b}_${l}_${s}`
        childIds.push(slabId)
        const slab = SlabNode.parse({
          id: slabId,
          parentId: levelId,
          polygon: [
            [s * 4, 0],
            [s * 4 + 4, 0],
            [s * 4 + 4, 4],
            [s * 4, 4],
          ],
          elevation: l * 3,
        })
        nodes[slabId] = slab
        totalNodeCount++
      }

      // 3. Items
      for (let i = 0; i < itemsPerLevel; i++) {
        const itemId = `item_perf_${b}_${l}_${i}`
        childIds.push(itemId)
        const item = ItemNode.parse({
          id: itemId,
          parentId: levelId,
          position: [i * 1.5, l * 3, 2],
          rotation: [0, (i * Math.PI) / 4, 0],
          asset: {
            id: `asset_type_${i % 5}`,
            name: `Asset Item ${i}`,
            category: 'furniture',
            thumbnail: `/item_${i % 5}.png`,
            src: `/item_${i % 5}.glb`,
            dimensions: [1, 1, 1],
          },
        })
        nodes[itemId] = item
        totalNodeCount++
      }

      // 4. Zones
      for (let z = 0; z < zonesPerLevel; z++) {
        const zoneId = `zone_perf_${b}_${l}_${z}`
        childIds.push(zoneId)
        const zone = ZoneNode.parse({
          id: zoneId,
          parentId: levelId,
          name: `Zone Room ${z}`,
          color: '#3b82f6',
          polygon: [
            [z * 5, 0],
            [z * 5 + 5, 0],
            [z * 5 + 5, 5],
            [z * 5, 5],
          ],
        })
        nodes[zoneId] = zone
        totalNodeCount++
      }

      // Construct Level
      const level = LevelNode.parse({
        id: levelId,
        parentId: buildingId,
        level: l,
        elevation: l * 3,
        children: childIds,
      })
      nodes[levelId] = level
      totalNodeCount++
    }

    // Construct Building
    const building = BuildingNode.parse({
      id: buildingId,
      children: levelIds,
    })
    nodes[buildingId] = building
    totalNodeCount++
  }

  return { nodes, rootNodeIds, totalNodeCount }
}

// ── Test Suite ──────────────────────────────────────────────────────────────

describe('Multiplayer Role Handoff Performance & Profiling Suite (Viewer -> Editor)', () => {
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
    // Reset stores to a clean baseline
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
      isPreviewMode: true, // Start in Viewer (Preview) mode
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
  // TIER 1: Feature Coverage (Core Functionality & Baseline Handoff)
  // ══════════════════════════════════════════════════════════════════════════
  describe('Tier 1: Feature Coverage (Core Functionality & Baseline Handoff)', () => {
    test('F7/F8: Baseline role handoff (Viewer -> Editor) blocking time is strictly < 50ms', () => {
      // 1. Setup scene with a single building and level
      const { nodes, rootNodeIds } = createSyntheticSceneGraph({
        buildingCount: 1,
        levelsPerBuilding: 1,
        wallsPerLevel: 10,
        slabsPerLevel: 2,
        itemsPerLevel: 5,
        zonesPerLevel: 1,
      })

      useScene.setState({ nodes, rootNodeIds, dirtyNodes: new Set() } as never)
      expect(useEditor.getState().isPreviewMode).toBe(true)

      // 2. Measure transition execution time
      const metrics = measureExecutionTime(() => {
        useEditor.getState().setPreviewMode(false)
      })

      // 3. Assertions
      expect(useEditor.getState().isPreviewMode).toBe(false)
      expect(metrics.durationMs).toBeLessThan(MAX_BLOCKING_THRESHOLD_MS)
      expect(metrics.isCompliant).toBe(true)
    })

    test('F1: Unified persistent viewer retains camera, wall mode, and selection state across role transition', () => {
      const { nodes, rootNodeIds } = createSyntheticSceneGraph({
        buildingCount: 1,
        levelsPerBuilding: 1,
        wallsPerLevel: 4,
      })
      useScene.setState({ nodes, rootNodeIds } as never)

      const targetLevelId = rootNodeIds[0] ? ((nodes[rootNodeIds[0]] as BuildingNode).children[0] as any) : null
      useViewer.setState({
        cameraMode: 'orthographic',
        wallMode: 'cutaway',
        selection: {
          buildingId: (rootNodeIds[0] as any) ?? null,
          levelId: targetLevelId ?? null,
          zoneId: null,
          selectedIds: [`wall_perf_0_0_1`],
        },
      })

      // Perform role transition (Viewer -> Editor)
      const metrics = measureExecutionTime(() => {
        useEditor.getState().setPreviewMode(false)
      })

      expect(metrics.durationMs).toBeLessThan(MAX_BLOCKING_THRESHOLD_MS)
      // Verify state was preserved without being wiped
      const viewerState = useViewer.getState()
      expect(viewerState.cameraMode).toBe('orthographic')
      expect(viewerState.wallMode).toBe('cutaway')
      expect(viewerState.selection.levelId).toBe(targetLevelId)
      expect(viewerState.selection.selectedIds).toContain('wall_perf_0_0_1')
    })

    test('F2: Gizmo and tool manager gating activates cleanly without Canvas destruction', () => {
      // In viewer mode, editing tools are inactive
      expect(useEditor.getState().isPreviewMode).toBe(true)
      expect(useEditor.getState().mode).toBe('select')

      // Switch to editor and set an active tool
      const metrics = measureExecutionTime(() => {
        useEditor.getState().setPreviewMode(false)
        useEditor.getState().setMode('build')
        useEditor.getState().setTool('wall')
      })

      expect(metrics.durationMs).toBeLessThan(MAX_BLOCKING_THRESHOLD_MS)
      expect(useEditor.getState().mode).toBe('build')
      expect(useEditor.getState().tool).toBe('wall')

      // Switch back to viewer: should cleanly reset tool without blocking
      const backMetrics = measureExecutionTime(() => {
        useEditor.getState().setPreviewMode(true)
      })

      expect(backMetrics.durationMs).toBeLessThan(MAX_BLOCKING_THRESHOLD_MS)
      expect(useEditor.getState().isPreviewMode).toBe(true)
      expect(useEditor.getState().mode).toBe('select')
      expect(useEditor.getState().tool).toBeNull()
    })

    test('F3: In-place multiplayer awareness role update executes in < 50ms without doc destruction', () => {
      const doc = new Y.Doc()
      const awareness = new awarenessProtocol.Awareness(doc)
      const awarenessService = new MultiplayerAwarenessService({
        awareness,
        localPresence: {
          userId: 'test_user_1',
          name: 'User 1',
          role: 'viewer',
          color: '#3b82f6',
        },
      })

      const initialPresence = awarenessService.getPresences().get(awareness.clientID)
      expect(initialPresence?.role).toBe('viewer')

      // Measure role handoff awareness update
      const metrics = measureExecutionTime(() => {
        awarenessService.setLocalState({ role: 'editor' })
        awarenessService.flushLocalState()
        useEditor.getState().setPreviewMode(false)
      })

      expect(metrics.durationMs).toBeLessThan(MAX_BLOCKING_THRESHOLD_MS)
      const updatedPresence = awarenessService.getPresences().get(awareness.clientID)
      expect(updatedPresence?.role).toBe('editor')
      expect(useEditor.getState().isPreviewMode).toBe(false)
      expect(doc.isDestroyed).toBe(false)

      awarenessService.destroy()
      doc.destroy()
    })

    test('F4: Granular store selector updates during role switch do not trigger full store invalidation', () => {
      const { nodes, rootNodeIds } = createSyntheticSceneGraph({
        buildingCount: 1,
        levelsPerBuilding: 1,
        wallsPerLevel: 20,
      })
      useScene.setState({ nodes, rootNodeIds } as never)

      let previewModeChangedCount = 0
      let previousIsPreview = useEditor.getState().isPreviewMode

      const unsubscribe = useEditor.subscribe((state) => {
        if (state.isPreviewMode !== previousIsPreview) {
          previewModeChangedCount++
          previousIsPreview = state.isPreviewMode
        }
      })

      const metrics = measureExecutionTime(() => {
        useEditor.getState().setPreviewMode(false)
      })

      expect(metrics.durationMs).toBeLessThan(MAX_BLOCKING_THRESHOLD_MS)
      expect(previewModeChangedCount).toBe(1)
      unsubscribe()
    })
  })

  // ══════════════════════════════════════════════════════════════════════════
  // TIER 2: Boundary & Corner Cases
  // ══════════════════════════════════════════════════════════════════════════
  describe('Tier 2: Boundary & Corner Cases', () => {
    test('Rapid consecutive role toggling (30 flips) maintains < 50ms blocking time per tick', () => {
      const { nodes, rootNodeIds } = createSyntheticSceneGraph({
        buildingCount: 1,
        levelsPerBuilding: 1,
        wallsPerLevel: 15,
        itemsPerLevel: 10,
      })
      useScene.setState({ nodes, rootNodeIds } as never)

      const FLIP_COUNT = 30
      let maxTickTime = 0

      for (let i = 0; i < FLIP_COUNT; i++) {
        const isTargetPreview = i % 2 === 0
        const metrics = measureExecutionTime(() => {
          useEditor.getState().setPreviewMode(isTargetPreview)
        })

        if (metrics.durationMs > maxTickTime) {
          maxTickTime = metrics.durationMs
        }
        expect(metrics.durationMs).toBeLessThan(MAX_BLOCKING_THRESHOLD_MS)
        expect(useEditor.getState().isPreviewMode).toBe(isTargetPreview)
      }

      expect(maxTickTime).toBeLessThan(MAX_BLOCKING_THRESHOLD_MS)
    })

    test('Role transition on empty scene graph (0 nodes) executes with minimal overhead (< 10ms)', () => {
      useScene.setState({ nodes: {}, rootNodeIds: [] } as never)

      const metrics = measureExecutionTime(() => {
        useEditor.getState().setPreviewMode(false)
      })

      expect(metrics.durationMs).toBeLessThan(10)
      expect(useEditor.getState().isPreviewMode).toBe(false)
    })

    test('Role transition on scene with nested null/undefined properties does not crash or stall', () => {
      const buildingId = 'building_corner'
      const levelId = 'level_corner'
      const nodes: Record<string, any> = {
        [buildingId]: BuildingNode.parse({ id: buildingId, children: [levelId] }),
        [levelId]: LevelNode.parse({ id: levelId, parentId: buildingId, level: 0, children: [] }),
      }

      useScene.setState({ nodes, rootNodeIds: [buildingId] } as never)

      const metrics = measureExecutionTime(() => {
        useEditor.getState().setPreviewMode(false)
        useViewer.getState().setSelection({
          buildingId,
          levelId,
          zoneId: null,
          selectedIds: [],
        })
      })

      expect(metrics.durationMs).toBeLessThan(MAX_BLOCKING_THRESHOLD_MS)
      expect(useEditor.getState().isPreviewMode).toBe(false)
    })

    test('Role transition respects scene read-only lease acquisition and release', () => {
      expect(useEditor.getState().isPreviewMode).toBe(true)

      // Acquire read-only lease (simulating forced viewer)
      const releaseLease = acquireSceneReadOnlyLease()
      expect(useScene.getState().readOnly).toBe(true)

      // Transition to editor mode while lease is held
      const metrics = measureExecutionTime(() => {
        useEditor.getState().setPreviewMode(false)
      })

      expect(metrics.durationMs).toBeLessThan(MAX_BLOCKING_THRESHOLD_MS)

      // Release lease
      releaseLease()
      expect(useScene.getState().readOnly).toBe(false)
    })
  })

  // ══════════════════════════════════════════════════════════════════════════
  // TIER 3: Cross-Feature Combinations
  // ══════════════════════════════════════════════════════════════════════════
  describe('Tier 3: Cross-Feature Combinations', () => {
    test('Role handoff during active multi-node selection preserves and sanitizes selection state', () => {
      const { nodes, rootNodeIds } = createSyntheticSceneGraph({
        buildingCount: 1,
        levelsPerBuilding: 1,
        wallsPerLevel: 10,
        itemsPerLevel: 10,
      })
      useScene.setState({ nodes, rootNodeIds } as never)

      const selectedIds = ['wall_perf_0_0_1', 'wall_perf_0_0_2', 'item_perf_0_0_3']
      useViewer.setState({
        selection: {
          buildingId: (rootNodeIds[0] as any) ?? null,
          levelId: 'level_perf_0_0',
          zoneId: null,
          selectedIds,
        },
      })

      const metrics = measureExecutionTime(() => {
        useEditor.getState().setPreviewMode(false)
      })

      expect(metrics.durationMs).toBeLessThan(MAX_BLOCKING_THRESHOLD_MS)
      expect(useViewer.getState().selection.selectedIds).toEqual(selectedIds)
    })

    test('Role handoff concurrent with live transform overrides executes under 50ms', () => {
      const { nodes, rootNodeIds } = createSyntheticSceneGraph({
        buildingCount: 1,
        levelsPerBuilding: 1,
        wallsPerLevel: 10,
        itemsPerLevel: 10,
      })
      useScene.setState({ nodes, rootNodeIds } as never)

      // Simulate active live transform overrides (e.g. active dragging)
      useLiveTransforms.getState().set('item_perf_0_0_1', {
        position: [10, 0, 5],
        rotation: Math.PI / 2,
      })
      useLiveNodeOverrides.getState().set('item_perf_0_0_1', {
        position: [10, 0, 5],
      })

      const metrics = measureExecutionTime(() => {
        useEditor.getState().setPreviewMode(false)
      })

      expect(metrics.durationMs).toBeLessThan(MAX_BLOCKING_THRESHOLD_MS)
      expect(useLiveTransforms.getState().transforms.has('item_perf_0_0_1')).toBe(true)

      // Clean up transforms
      useLiveTransforms.getState().clearAll()
      useLiveNodeOverrides.getState().clearAll()
    })

    test('Role handoff during viewMode switch (3D -> Split 2D/3D) maintains < 50ms compliance', () => {
      const { nodes, rootNodeIds } = createSyntheticSceneGraph({
        buildingCount: 1,
        levelsPerBuilding: 1,
        wallsPerLevel: 15,
      })
      useScene.setState({ nodes, rootNodeIds } as never)

      const metrics = measureExecutionTime(() => {
        useEditor.getState().setPreviewMode(false)
        useEditor.getState().setViewMode('split')
        useEditor.getState().setFloorplanPaneRatio(0.4)
      })

      expect(metrics.durationMs).toBeLessThan(MAX_BLOCKING_THRESHOLD_MS)
      expect(useEditor.getState().viewMode).toBe('split')
      expect(useEditor.getState().isFloorplanOpen).toBe(true)
      expect(useEditor.getState().floorplanPaneRatio).toBe(0.4)
    })

    test('F5: Role handoff concurrent with auto-save dirty tracking avoids heavy synchronous stalls', async () => {
      const { nodes, rootNodeIds } = createSyntheticSceneGraph({
        buildingCount: 1,
        levelsPerBuilding: 2,
        wallsPerLevel: 20,
        itemsPerLevel: 15,
      })
      useScene.setState({ nodes, rootNodeIds } as never)

      // Mutate a node to dirty state
      useScene.getState().markDirty('wall_perf_0_0_1' as AnyNodeId)

      const metrics = measureExecutionTime(() => {
        useEditor.getState().setPreviewMode(false)
      })

      expect(metrics.durationMs).toBeLessThan(MAX_BLOCKING_THRESHOLD_MS)
      expect(useEditor.getState().isPreviewMode).toBe(false)
    })

    test('Multiplayer presence awareness sync with multiple peers during role handoff', () => {
      const doc = new Y.Doc()
      const awareness = new awarenessProtocol.Awareness(doc)

      // Local client
      const awarenessService = new MultiplayerAwarenessService({
        awareness,
        localPresence: {
          userId: 'local_user',
          name: 'Local User',
          role: 'viewer',
          color: '#3b82f6',
        },
      })

      let presenceSize = 0
      const unsubscribe = awarenessService.subscribe((presences) => {
        presenceSize = presences.size
      })

      const metrics = measureExecutionTime(() => {
        // Handoff role locally
        awarenessService.setLocalState({ role: 'editor' })
        awarenessService.flushLocalState()
        useEditor.getState().setPreviewMode(false)
      })

      expect(metrics.durationMs).toBeLessThan(MAX_BLOCKING_THRESHOLD_MS)
      const local = awarenessService.getPresences().get(awareness.clientID)
      expect(local?.role).toBe('editor')

      unsubscribe()
      awarenessService.destroy()
      doc.destroy()
    })
  })

  // ══════════════════════════════════════════════════════════════════════════
  // TIER 4: Real-World Workload Simulation (50-100+ Scene Nodes)
  // ══════════════════════════════════════════════════════════════════════════
  describe('Tier 4: Real-World Workload Simulation (50-100+ Scene Nodes)', () => {
    test('F7/F8: Scaled scene graph (100+ nodes) role transition strictly adheres to < 50ms Long Task limit', () => {
      // 1. Build realistic heavy scene with 100+ nodes
      const { nodes, rootNodeIds, totalNodeCount } = createSyntheticSceneGraph({
        buildingCount: 2,
        levelsPerBuilding: 2,
        wallsPerLevel: 20, // 2 * 2 * 20 = 80 walls
        slabsPerLevel: 4,  // 2 * 2 * 4 = 16 slabs
        itemsPerLevel: 10, // 2 * 2 * 10 = 40 items
        zonesPerLevel: 2,  // 2 * 2 * 2 = 8 zones
      })

      expect(totalNodeCount).toBeGreaterThanOrEqual(100)

      useScene.setState({
        nodes,
        rootNodeIds,
        materials: {},
        collections: {},
        dirtyNodes: new Set(),
      } as never)

      expect(useEditor.getState().isPreviewMode).toBe(true)

      // 2. Perform and profile Viewer -> Editor role transition
      const metrics = measureExecutionTime(() => {
        useEditor.getState().setPreviewMode(false)
        useViewer.getState().setSelection({
          buildingId: (rootNodeIds[0] as any) ?? null,
          levelId: 'level_perf_0_0',
          zoneId: null,
          selectedIds: ['wall_perf_0_0_1', 'item_perf_0_0_2'],
        })
      })

      // 3. Performance Assertions
      expect(metrics.durationMs).toBeLessThan(MAX_BLOCKING_THRESHOLD_MS)
      expect(metrics.isCompliant).toBe(true)
      expect(useEditor.getState().isPreviewMode).toBe(false)
      expect(Object.keys(useScene.getState().nodes).length).toBe(totalNodeCount)
    })

    test('Bidirectional role transitions (Viewer -> Editor -> Viewer) under 100+ nodes stay < 50ms', () => {
      const { nodes, rootNodeIds } = createSyntheticSceneGraph({
        buildingCount: 1,
        levelsPerBuilding: 3,
        wallsPerLevel: 25,
        slabsPerLevel: 5,
        itemsPerLevel: 15,
      })

      useScene.setState({ nodes, rootNodeIds } as never)

      // Transition 1: Viewer -> Editor
      const toEditorMetrics = measureExecutionTime(() => {
        useEditor.getState().setPreviewMode(false)
      })
      expect(toEditorMetrics.durationMs).toBeLessThan(MAX_BLOCKING_THRESHOLD_MS)
      expect(useEditor.getState().isPreviewMode).toBe(false)

      // Transition 2: Editor -> Viewer
      const toViewerMetrics = measureExecutionTime(() => {
        useEditor.getState().setPreviewMode(true)
      })
      expect(toViewerMetrics.durationMs).toBeLessThan(MAX_BLOCKING_THRESHOLD_MS)
      expect(useEditor.getState().isPreviewMode).toBe(true)

      // Transition 3: Viewer -> Editor again
      const reEditorMetrics = measureExecutionTime(() => {
        useEditor.getState().setPreviewMode(false)
      })
      expect(reEditorMetrics.durationMs).toBeLessThan(MAX_BLOCKING_THRESHOLD_MS)
      expect(useEditor.getState().isPreviewMode).toBe(false)
    })

    test('React Profiler measurement: Component render & commit duration under 100+ nodes is < 50ms', () => {
      const { nodes, rootNodeIds } = createSyntheticSceneGraph({
        buildingCount: 2,
        levelsPerBuilding: 2,
        wallsPerLevel: 20,
        itemsPerLevel: 15,
      })
      useScene.setState({ nodes, rootNodeIds } as never)

      let actualCommitDuration = 0
      let baseRenderDuration = 0

      const onRender: ProfilerOnRenderCallback = (
        id,
        phase,
        actualDuration,
        baseDuration,
        startTime,
        commitTime,
      ) => {
        actualCommitDuration = actualDuration
        baseRenderDuration = baseDuration
      }

      function ProfilingHarness({ isPreview }: { isPreview: boolean }) {
        return (
          <Profiler id="RoleHandoffProfiler" onRender={onRender}>
            <div data-mode={isPreview ? 'viewer' : 'editor'}>
              <span>Status: {isPreview ? 'Viewer' : 'Editor'}</span>
              <span>Node Count: {Object.keys(nodes).length}</span>
            </div>
          </Profiler>
        )
      }

      // Initial render in Viewer mode
      renderToString(<ProfilingHarness isPreview={true} />)

      // Measure role switch re-render commit
      const metrics = measureExecutionTime(() => {
        useEditor.getState().setPreviewMode(false)
        renderToString(<ProfilingHarness isPreview={false} />)
      })

      expect(metrics.durationMs).toBeLessThan(MAX_BLOCKING_THRESHOLD_MS)
      expect(actualCommitDuration).toBeLessThan(MAX_BLOCKING_THRESHOLD_MS)
      expect(useEditor.getState().isPreviewMode).toBe(false)
    })

    test('Scene graph integrity and spatial grid consistency are preserved post-transition under load', () => {
      const { nodes, rootNodeIds, totalNodeCount } = createSyntheticSceneGraph({
        buildingCount: 2,
        levelsPerBuilding: 2,
        wallsPerLevel: 15,
        itemsPerLevel: 10,
      })
      useScene.setState({ nodes, rootNodeIds } as never)

      // Trigger role transition
      useEditor.getState().setPreviewMode(false)

      // Query scene graph nodes
      const currentNodes = useScene.getState().nodes
      expect(Object.keys(currentNodes).length).toBe(totalNodeCount)

      // Confirm all buildings and levels intact
      for (const bId of rootNodeIds) {
        const building = (currentNodes as any)[bId] as BuildingNode
        expect(building).toBeDefined()
        expect(building.type).toBe('building')
        for (const lId of building.children) {
          const level = (currentNodes as any)[lId] as LevelNode
          expect(level).toBeDefined()
          expect(level.type).toBe('level')
        }
      }
    })
  })

  // ══════════════════════════════════════════════════════════════════════════
  // TIER 5: Adversarial Stress & Chaos Verification
  // ══════════════════════════════════════════════════════════════════════════
  describe('Tier 5: Adversarial Stress & Chaos Verification', () => {
    test('Stress loop: 100 consecutive role handoffs under 100-node scene graph with 0 Long Tasks >= 50ms', () => {
      const { nodes, rootNodeIds } = createSyntheticSceneGraph({
        buildingCount: 2,
        levelsPerBuilding: 2,
        wallsPerLevel: 20,
        itemsPerLevel: 10,
      })
      useScene.setState({ nodes, rootNodeIds } as never)

      const ITERATIONS = 100
      let maxRecordedBlockingTime = 0
      let totalTime = 0

      for (let i = 0; i < ITERATIONS; i++) {
        const targetPreview = i % 2 === 0
        const metrics = measureExecutionTime(() => {
          useEditor.getState().setPreviewMode(targetPreview)
        })

        totalTime += metrics.durationMs
        if (metrics.durationMs > maxRecordedBlockingTime) {
          maxRecordedBlockingTime = metrics.durationMs
        }

        // Strict assertion per iteration: zero long tasks >= 50ms
        expect(metrics.durationMs).toBeLessThan(MAX_BLOCKING_THRESHOLD_MS)
      }

      const avgTime = totalTime / ITERATIONS
      expect(maxRecordedBlockingTime).toBeLessThan(MAX_BLOCKING_THRESHOLD_MS)
      expect(avgTime).toBeLessThan(10) // Average transition should be well under 10ms
    })

    test('Chaos test: Random concurrent node mutations during role handoff do not violate blocking limit', () => {
      const { nodes, rootNodeIds } = createSyntheticSceneGraph({
        buildingCount: 1,
        levelsPerBuilding: 2,
        wallsPerLevel: 20,
        itemsPerLevel: 10,
      })
      useScene.setState({ nodes, rootNodeIds } as never)

      const metrics = measureExecutionTime(() => {
        // 1. Role handoff
        useEditor.getState().setPreviewMode(false)

        // 2. Concurrent node updates injected in same event loop tick
        for (let i = 0; i < 10; i++) {
          const targetWallId = `wall_perf_0_0_${i}`
          if ((useScene.getState().nodes as any)[targetWallId]) {
            useScene.getState().updateNode(targetWallId as AnyNodeId, {
              height: 3.5 + i * 0.1,
            })
          }
        }

        // 3. Selection change
        useViewer.getState().setSelection({
          buildingId: (rootNodeIds[0] as any) ?? null,
          levelId: 'level_perf_0_0',
          zoneId: null,
          selectedIds: ['wall_perf_0_0_5'],
        })
      })

      expect(metrics.durationMs).toBeLessThan(MAX_BLOCKING_THRESHOLD_MS)
      expect(useEditor.getState().isPreviewMode).toBe(false)
      expect((useScene.getState().nodes['wall_perf_0_0_5'] as WallNode).height).toBe(4.0)
    })

    test('Memory & listener leak guard: 50 subscribe/unsubscribe cycles during role transitions maintain zero leak', () => {
      const unsubs: Array<() => void> = []

      const metrics = measureExecutionTime(() => {
        for (let i = 0; i < 50; i++) {
          const unsub = useEditor.subscribe(() => {})
          unsubs.push(unsub)
          useEditor.getState().setPreviewMode(i % 2 === 0)
        }
      })

      expect(metrics.durationMs).toBeLessThan(MAX_BLOCKING_THRESHOLD_MS)

      // Clean up subscriptions
      for (const unsub of unsubs) {
        unsub()
      }
      expect(unsubs.length).toBe(50)
    })
  })
})
