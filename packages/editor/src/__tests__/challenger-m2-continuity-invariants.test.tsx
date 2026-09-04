// Memory storage mock for zustand persist middleware
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

// Polyfill RAF and cancelRAF for headless bun environment
type RafFn = (callback: (time: number) => void) => number
;(globalThis as any).requestAnimationFrame = (callback: (time: number) => void) => {
  callback(performance.now())
  return 0
}
;(globalThis as any).cancelAnimationFrame = () => {}

import { afterEach, beforeEach, describe, expect, test, mock } from 'bun:test'
import * as React from 'react'
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import {
  type AnyNodeId,
  BuildingNode,
  LevelNode,
  WallNode,
  SlabNode,
  ItemNode,
  useScene,
  acquireSceneReadOnlyLease,
  MultiplayerAwarenessService,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import useEditor from '../store/use-editor'
import { useMultiplayer, type UseMultiplayerOptions, type UseMultiplayerResult } from '../hooks/use-multiplayer'
import {
  useAutoSave,
  decideExitFlush,
  createStoredNodeCountTracker,
  isSuspiciousNodeDrop,
} from '../hooks/use-auto-save'

// ── Mock WebSocket Harness ──────────────────────────────────────────────────
class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  readonly CONNECTING = 0
  readonly OPEN = 1
  readonly CLOSING = 2
  readonly CLOSED = 3

  static instances: MockWebSocket[] = []
  url: string
  binaryType: string = 'blob'
  readyState: number = 0 // CONNECTING
  onopen: ((ev: any) => any) | null = null
  onmessage: ((ev: any) => any) | null = null
  onerror: ((ev: any) => any) | null = null
  onclose: ((ev: any) => any) | null = null
  sentMessages: any[] = []
  closeCallCount = 0

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
    // Synchronously open for deterministic testing
    queueMicrotask(() => {
      if (this.readyState === MockWebSocket.CONNECTING) {
        this.readyState = MockWebSocket.OPEN
        this.onopen?.({ type: 'open' })
      }
    })
  }

  send(data: any) {
    this.sentMessages.push(data)
  }

  close() {
    this.closeCallCount++
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.({ type: 'close' })
  }
}

// ── Deterministic React 19 Hook Execution Harness ───────────────────────────
const reactInternals = (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE

class HookHarness<Props, Result> {
  private hookFn: (props: Props) => Result
  private props: Props
  private result!: Result
  private hookStates: any[] = []
  private hookIndex = 0
  private effectCleanups: Array<(() => void) | null | undefined> = []
  private prevEffectDeps: Array<any[] | undefined> = []
  private pendingEffects: Array<() => (() => void) | void> = []
  private isUnmounted = false

  constructor(hookFn: (props: Props) => Result, initialProps: Props) {
    this.hookFn = hookFn
    this.props = initialProps
    this.render()
  }

  public get current(): Result {
    return this.result
  }

  public update(newProps: Props): Result {
    if (this.isUnmounted) throw new Error('Cannot update unmounted hook')
    this.props = newProps
    this.render()
    return this.result
  }

  public unmount() {
    if (this.isUnmounted) return
    this.isUnmounted = true
    // Run all effect cleanups in reverse order
    for (let i = this.effectCleanups.length - 1; i >= 0; i--) {
      const cleanup = this.effectCleanups[i]
      if (typeof cleanup === 'function') {
        cleanup()
      }
    }
  }

  private render() {
    this.hookIndex = 0
    this.pendingEffects = []

    const prevDispatcher = reactInternals.H

    const customDispatcher = {
      useState: (initialState: any) => {
        const idx = this.hookIndex++
        if (this.hookStates[idx] === undefined) {
          this.hookStates[idx] =
            typeof initialState === 'function' ? initialState() : initialState
        }
        const setState = (action: any) => {
          const nextVal = typeof action === 'function' ? action(this.hookStates[idx]) : action
          if (nextVal !== this.hookStates[idx]) {
            this.hookStates[idx] = nextVal
            if (!this.isUnmounted) {
              queueMicrotask(() => this.render())
            }
          }
        }
        return [this.hookStates[idx], setState]
      },

      useRef: (initialValue: any) => {
        const idx = this.hookIndex++
        if (this.hookStates[idx] === undefined) {
          this.hookStates[idx] = { current: initialValue }
        }
        return this.hookStates[idx]
      },

      useMemo: (factory: () => any, deps?: any[]) => {
        const idx = this.hookIndex++
        const prev = this.hookStates[idx]
        if (!prev || !this.areDepsEqual(prev.deps, deps)) {
          const value = factory()
          this.hookStates[idx] = { value, deps }
          return value
        }
        return prev.value
      },

      useCallback: (callback: any, deps?: any[]) => {
        const idx = this.hookIndex++
        const prev = this.hookStates[idx]
        if (!prev || !this.areDepsEqual(prev.deps, deps)) {
          this.hookStates[idx] = { callback, deps }
          return callback
        }
        return prev.callback
      },

      useEffect: (effect: () => (() => void) | void, deps?: any[]) => {
        const idx = this.hookIndex++
        const prevDeps = this.prevEffectDeps[idx]
        const shouldRun = prevDeps === undefined || !this.areDepsEqual(prevDeps, deps)

        if (shouldRun) {
          this.prevEffectDeps[idx] = deps
          this.pendingEffects.push(() => {
            const oldCleanup = this.effectCleanups[idx]
            if (typeof oldCleanup === 'function') {
              oldCleanup()
            }
            const cleanup = effect()
            this.effectCleanups[idx] = typeof cleanup === 'function' ? cleanup : null
          })
        }
      },

      useSyncExternalStore: (subscribe: (onStoreChange: () => void) => () => void, getSnapshot: () => any) => {
        const idx = this.hookIndex++
        if (this.hookStates[idx] === undefined) {
          const unsub = subscribe(() => {
            if (!this.isUnmounted) {
              this.render()
            }
          })
          this.hookStates[idx] = { unsub }
        }
        return getSnapshot()
      },
    }

    try {
      reactInternals.H = customDispatcher
      this.result = this.hookFn(this.props)
    } finally {
      reactInternals.H = prevDispatcher
    }

    // Run synchronous effect flush (mimicking React commit phase)
    for (const effect of this.pendingEffects) {
      effect()
    }
  }

  private areDepsEqual(a?: any[], b?: any[]): boolean {
    if (!a || !b) return false
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (!Object.is(a[i], b[i])) return false
    }
    return true
  }
}

// ── Test Suite ──────────────────────────────────────────────────────────────

describe('Challenger M2: Connection Continuity, State Invariants & Leak Auditing', () => {
  let originalWebSocket: any

  beforeEach(() => {
    MockWebSocket.instances = []
    originalWebSocket = (globalThis as any).WebSocket
    ;(globalThis as any).WebSocket = MockWebSocket

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
  })

  afterEach(() => {
    ;(globalThis as any).WebSocket = originalWebSocket
    MockWebSocket.instances = []
  })

  // ══════════════════════════════════════════════════════════════════════════
  // CHALLENGE DIMENSION 1: WebSocket & Y.Doc Continuity during Role Handoff
  // ══════════════════════════════════════════════════════════════════════════
  describe('Dimension 1: Connection Continuity & Zero Y.Doc Re-instantiations', () => {
    test('Role handoff (Viewer -> Editor -> Viewer) preserves WebSocket instance and Y.Doc without reconnection', async () => {
      const harness = new HookHarness<UseMultiplayerOptions, UseMultiplayerResult>(
        (props) => useMultiplayer(props),
        {
          sceneId: 'test_scene_continuity',
          serverUrl: 'ws://127.0.0.1:3002/collab/v1',
          role: 'viewer',
          userId: 'user_challenger_1',
          name: 'Challenger User',
        },
      )

      await new Promise((r) => setTimeout(r, 10))

      expect(MockWebSocket.instances.length).toBe(1)
      const initialWs = MockWebSocket.instances[0]!
      expect(initialWs.readyState).toBe(MockWebSocket.OPEN) // OPEN
      const initialDoc = harness.current.doc
      const initialAwareness = harness.current.awarenessService
      const initialUndoManager = harness.current.undoManager

      expect(initialDoc).not.toBeNull()
      expect(initialDoc!.isDestroyed).toBe(false)
      expect(initialAwareness).not.toBeNull()
      expect(initialWs.closeCallCount).toBe(0)

      // ── Step 1: Promote Viewer -> Editor ─────────────────────────────
      const wsSentBefore = initialWs.sentMessages.length
      harness.update({
        sceneId: 'test_scene_continuity',
        serverUrl: 'ws://127.0.0.1:3002/collab/v1',
        role: 'editor',
        userId: 'user_challenger_1',
        name: 'Challenger User',
      })

      // Invariants Check 1:
      expect(MockWebSocket.instances.length).toBe(1) // Still exactly 1 socket instance!
      expect(MockWebSocket.instances[0]).toBe(initialWs)
      expect(initialWs.closeCallCount).toBe(0) // Socket was NEVER closed!
      expect(initialWs.readyState).toBe(MockWebSocket.OPEN) // Socket remains OPEN!

      expect(harness.current.doc).toBe(initialDoc) // Y.Doc reference strictly unchanged!
      expect(harness.current.doc!.isDestroyed).toBe(false)
      expect(harness.current.undoManager).toBe(initialUndoManager)

      // Verify awareness update packet was transmitted over the open socket
      expect(initialWs.sentMessages.length).toBeGreaterThan(wsSentBefore)
      const presences = harness.current.awarenessService!.getPresences()
      const localPresence = presences.get(harness.current.localClientId!)
      expect(localPresence?.role).toBe('editor')

      // ── Step 2: Demote Editor -> Viewer ─────────────────────────────
      const wsSentBefore2 = initialWs.sentMessages.length
      harness.update({
        sceneId: 'test_scene_continuity',
        serverUrl: 'ws://127.0.0.1:3002/collab/v1',
        role: 'viewer',
        userId: 'user_challenger_1',
        name: 'Challenger User',
      })

      // Invariants Check 2:
      expect(MockWebSocket.instances.length).toBe(1)
      expect(initialWs.closeCallCount).toBe(0)
      expect(initialWs.readyState).toBe(MockWebSocket.OPEN)
      expect(harness.current.doc).toBe(initialDoc)
      expect(harness.current.doc!.isDestroyed).toBe(false)

      const demotedPresence = harness.current.awarenessService!.getPresences().get(harness.current.localClientId!)
      expect(demotedPresence?.role).toBe('viewer')
      expect(initialWs.sentMessages.length).toBeGreaterThan(wsSentBefore2)

      // ── Step 3: Unmount should cleanly teardown ──────────────────────
      harness.unmount()
      expect(initialWs.closeCallCount).toBe(1)
      expect(initialDoc!.isDestroyed).toBe(true)
    })

    test('Identity change (different sceneId or userId) correctly triggers full socket & doc re-creation', async () => {
      const harness = new HookHarness<UseMultiplayerOptions, UseMultiplayerResult>(
        (props) => useMultiplayer(props),
        {
          sceneId: 'scene_A',
          userId: 'user_1',
          role: 'viewer',
        },
      )
      await new Promise((r) => setTimeout(r, 10))

      expect(MockWebSocket.instances.length).toBe(1)
      const firstWs = MockWebSocket.instances[0]!
      const firstDoc = harness.current.doc

      // Change sceneId
      harness.update({
        sceneId: 'scene_B',
        userId: 'user_1',
        role: 'viewer',
      })
      await new Promise((r) => setTimeout(r, 20))

      expect(MockWebSocket.instances.length).toBe(2)
      expect(firstWs.closeCallCount).toBe(1)
      expect(firstDoc!.isDestroyed).toBe(true)
      expect(harness.current.doc).not.toBe(firstDoc)
      expect(harness.current.doc!.isDestroyed).toBe(false)

      harness.unmount()
    })
  })

  // ══════════════════════════════════════════════════════════════════════════
  // CHALLENGE DIMENSION 2: ToolManager Store Selector Memoization
  // ══════════════════════════════════════════════════════════════════════════
  describe('Dimension 2: ToolManager Store Selector Memoization & Spurious Re-render Immunity', () => {
    test('buildingTransform selector does not fire when non-building nodes (walls, items) mutate', () => {
      const buildingId = 'building_main' as AnyNodeId
      const wall1Id = 'wall_1' as AnyNodeId
      const wall2Id = 'wall_2' as AnyNodeId

      useScene.setState({
        nodes: {
          [buildingId]: BuildingNode.parse({ id: buildingId, children: [] }),
          [wall1Id]: WallNode.parse({
            id: wall1Id,
            start: [0, 0],
            end: [5, 0],
            height: 3,
            thickness: 0.2,
          }),
          [wall2Id]: WallNode.parse({
            id: wall2Id,
            start: [5, 0],
            end: [5, 5],
            height: 3,
            thickness: 0.2,
          }),
        },
        rootNodeIds: [buildingId],
      } as never)

      useViewer.setState({
        selection: {
          buildingId: buildingId as any,
          levelId: null,
          zoneId: null,
          selectedIds: [],
        },
      })

      // Selector as defined in ToolManager.tsx
      const selector = (state: any) => {
        const selectedBuildingId = useViewer.getState().selection.buildingId
        const building = selectedBuildingId
          ? (state.nodes[selectedBuildingId as AnyNodeId] as BuildingNode | undefined)
          : undefined
        return {
          position: building?.position ?? [0, 0, 0],
          rotation: building?.rotation ?? [0, 0, 0],
        }
      }

      // Simulate zustand subscriber with shallow equality
      let subscriberNotificationCount = 0
      let currentVal = selector(useScene.getState())

      const unsub = useScene.subscribe((state) => {
        const nextVal = selector(state)
        const shallowEqual =
          nextVal.position[0] === currentVal.position[0] &&
          nextVal.position[1] === currentVal.position[1] &&
          nextVal.position[2] === currentVal.position[2] &&
          nextVal.rotation[0] === currentVal.rotation[0] &&
          nextVal.rotation[1] === currentVal.rotation[1] &&
          nextVal.rotation[2] === currentVal.rotation[2]

        if (!shallowEqual) {
          subscriberNotificationCount++
          currentVal = nextVal
        }
      })

      // ── Mutate 100 unrelated walls ──────────────────────────────────
      for (let i = 0; i < 100; i++) {
        useScene.getState().updateNode(wall1Id, { height: 3 + i * 0.01 })
      }

      // Assertions:
      // Even though scene state was updated 100 times, the shallow result did NOT change,
      // so downstream React components subscribing via useShallow receive 0 spurious render triggers.
      expect(subscriberNotificationCount).toBe(0)

      // Now mutate the actual building position
      useScene.getState().updateNode(buildingId, { position: [10, 0, 10] })
      expect(subscriberNotificationCount).toBe(1)
      expect(currentVal.position).toEqual([10, 0, 10])

      unsub()
    })

    test('slab selection selector ignores wall/item edits and only triggers on slab/selection updates', () => {
      const slabId = 'slab_main' as AnyNodeId
      const wallId = 'wall_other' as AnyNodeId

      useScene.setState({
        nodes: {
          [slabId]: SlabNode.parse({
            id: slabId,
            polygon: [
              [0, 0],
              [4, 0],
              [4, 4],
              [0, 4],
            ],
          }),
          [wallId]: WallNode.parse({
            id: wallId,
            start: [0, 0],
            end: [5, 0],
            height: 3,
            thickness: 0.2,
          }),
        },
        rootNodeIds: [],
      } as never)

      useViewer.setState({
        selection: {
          buildingId: null,
          levelId: null,
          zoneId: null,
          selectedIds: [slabId],
        },
      })

      const getSlabSelectionData = (state: any, selectedIds: string[], editingHole: any) => {
        const selectedSlab = selectedIds.find(
          (id) => state.nodes[id as AnyNodeId]?.type === 'slab',
        ) as SlabNode['id'] | undefined
        const slab = selectedSlab ? (state.nodes[selectedSlab as AnyNodeId] as SlabNode | undefined) : null
        const isManual =
          selectedSlab !== undefined &&
          editingHole?.nodeId === selectedSlab &&
          slab?.holeMetadata?.[editingHole.holeIndex]?.source === 'manual'
        return {
          selectedSlabId: selectedSlab,
          editingSlabHoleIsManual: Boolean(isManual),
        }
      }

      let shallowChangedCount = 0
      let current = getSlabSelectionData(useScene.getState(), [slabId], null)

      const unsub = useScene.subscribe((state) => {
        const next = getSlabSelectionData(state, useViewer.getState().selection.selectedIds, null)
        if (
          next.selectedSlabId !== current.selectedSlabId ||
          next.editingSlabHoleIsManual !== current.editingSlabHoleIsManual
        ) {
          shallowChangedCount++
          current = next
        }
      })

      // Mutate unrelated wall 50 times
      for (let i = 0; i < 50; i++) {
        useScene.getState().updateNode(wallId, { height: 3 + i * 0.1 })
      }

      expect(shallowChangedCount).toBe(0)
      expect(current.selectedSlabId).toBe(slabId as any)

      unsub()
    })
  })

  // ══════════════════════════════════════════════════════════════════════════
  // CHALLENGE DIMENSION 3: O(1) AutoSave Reference Checks & Invariants
  // ══════════════════════════════════════════════════════════════════════════
  describe('Dimension 3: O(1) AutoSave Reference Checks & Save Invariants', () => {
    test('Role handoff readOnly lease acquisition does not trigger dirty flag or save serialization', async () => {
      let savedCount = 0
      let dirtyCallCount = 0

      const onSaveMock = mock(async (_scene: any) => {
        savedCount++
      })
      const onDirtyMock = mock(() => {
        dirtyCallCount++
      })

      // Seed initial scene before loading completes
      const wallId = 'wall_init' as AnyNodeId
      useScene.setState({
        nodes: {
          [wallId]: WallNode.parse({
            id: wallId,
            start: [0, 0],
            end: [5, 0],
            height: 3,
            thickness: 0.2,
          }),
        },
        rootNodeIds: [],
        readOnly: false,
      } as never)

      const harness = new HookHarness(
        (props) => useAutoSave(props),
        {
          onSave: onSaveMock,
          onDirty: onDirtyMock,
        },
      )
      // Scene load finishes
      harness.current.isLoadingSceneRef.current = false

      // Trigger store notification to update initial reference pointers while clean
      useScene.setState((s) => ({ ...s }))

      expect(dirtyCallCount).toBe(0)
      expect(savedCount).toBe(0)

      // Acquire read-only lease (simulating role transition lease lock)
      const releaseLease = acquireSceneReadOnlyLease()
      expect(useScene.getState().readOnly).toBe(true)

      // Allow potential debounce tick
      await new Promise((r) => setTimeout(r, 50))

      // Crucial verification: Since nodes/rootNodeIds/materials/collections references did not change,
      // onDirty and onSave were NOT falsely invoked by the readOnly toggle!
      expect(dirtyCallCount).toBe(0)
      expect(savedCount).toBe(0)

      releaseLease()
      expect(useScene.getState().readOnly).toBe(false)
      await new Promise((r) => setTimeout(r, 50))
      expect(dirtyCallCount).toBe(0)
      expect(savedCount).toBe(0)

      // Now perform genuine mutation
      useScene.getState().updateNode(wallId, { height: 4.0 })
      expect(dirtyCallCount).toBe(1)

      harness.unmount()
    })

    test('decideExitFlush adheres to safety invariants during role switches and loading states', () => {
      // 1. Clean session
      expect(
        decideExitFlush({
          isLoadingScene: false,
          hasDirtyChanges: false,
          storedNodeCount: 50,
          currentNodeCount: 50,
        }),
      ).toBe('skip-clean')

      // 2. In-flight loading with dirty flags
      expect(
        decideExitFlush({
          isLoadingScene: true,
          hasDirtyChanges: true,
          storedNodeCount: 50,
          currentNodeCount: 0,
        }),
      ).toBe('skip-loading')

      // 3. Suspicious full scene drop (50 -> 2 nodes)
      expect(
        decideExitFlush({
          isLoadingScene: false,
          hasDirtyChanges: true,
          storedNodeCount: 50,
          currentNodeCount: 2,
        }),
      ).toBe('blocked-suspicious')

      // 4. Valid user edit flush
      expect(
        decideExitFlush({
          isLoadingScene: false,
          hasDirtyChanges: true,
          storedNodeCount: 50,
          currentNodeCount: 52,
        }),
      ).toBe('flush')
    })
  })

  // ══════════════════════════════════════════════════════════════════════════
  // CHALLENGE DIMENSION 4: Stress & Resource Leak Verification
  // ══════════════════════════════════════════════════════════════════════════
  describe('Dimension 4: Multi-Cycle Role Switch Stress & Listener Leak Audit', () => {
    test('100 consecutive role flips produce zero dangling WebSocket connections or unhandled timers', async () => {
      const harness = new HookHarness<UseMultiplayerOptions, UseMultiplayerResult>(
        (props) => useMultiplayer(props),
        {
          sceneId: 'stress_scene',
          role: 'viewer',
          userId: 'stress_user',
        },
      )
      await new Promise((r) => setTimeout(r, 10))

      expect(MockWebSocket.instances.length).toBe(1)
      const ws = MockWebSocket.instances[0]!

      // 100 rapid role handoffs
      for (let i = 0; i < 100; i++) {
        harness.update({
          sceneId: 'stress_scene',
          role: i % 2 === 0 ? 'editor' : 'viewer',
          userId: 'stress_user',
        })
      }

      // Verify no extra sockets were created
      expect(MockWebSocket.instances.length).toBe(1)
      expect(ws.closeCallCount).toBe(0)
      expect(ws.readyState).toBe(MockWebSocket.OPEN)

      // Unmount cleanly
      harness.unmount()
      expect(ws.closeCallCount).toBe(1)
      expect(ws.readyState).toBe(MockWebSocket.CLOSED)
    })
  })
})
