'use client'

import { type AnyNode, type AnyNodeId, useScene } from '@pascal-app/core'
import { useRef } from 'react'
import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import {
  type ActiveInteractionScope,
  controlPointReshapeInfo,
  editingHoleInfo,
  endpointReshapeInfo,
  handleDragInfo,
  IDLE_SCOPE,
  type InteractionScope,
  isCurveReshape,
  movingNodeOf,
  reshapingNodeId,
  tangentReshapeInfo,
} from '../lib/interaction/scope'

// The authoritative interaction state machine. A single owner holds exactly one
// scope at a time. `begin` enters an interaction (atomically replacing any prior
// one — a single owner, no producer races), `update` narrows the live payload,
// and `end` returns to idle atomically so no interaction payload can leak past
// the end of its interaction. There is no setter that can leave the store in an
// illegal half-state: the only writable shape is `InteractionScope`.

export type InteractionScopeState = {
  scope: InteractionScope
  // Enter an interaction. If one is already active it is ended first, so the
  // store is always single-owner.
  begin: (scope: ActiveInteractionScope) => void
  // Patch the current scope's payload. Ignored when idle, or when the patch's
  // implied kind differs from the active kind — payload updates must not change
  // which interaction is running (use `begin` for that).
  update: (patch: Partial<ActiveInteractionScope>) => void
  // Return to idle atomically. Both commit and cancel paths call this; the
  // distinction (write vs revert) lives in the interaction body, not here.
  end: () => void
  // Return to idle only if the active scope matches `match`. Used when scope is
  // driven from independent legacy flag clears, so clearing one flag (e.g. a
  // fence curve) cannot stomp an unrelated active scope (e.g. a wall move).
  endIf: (match: (scope: ActiveInteractionScope) => boolean) => void
}

const useInteractionScope = create<InteractionScopeState>((set, get) => ({
  scope: IDLE_SCOPE,
  begin: (scope) => set({ scope }),
  update: (patch) =>
    set((state) => {
      if (state.scope.kind === 'idle') return state
      if ('kind' in patch && patch.kind !== state.scope.kind) return state
      return { scope: { ...state.scope, ...patch } as InteractionScope }
    }),
  end: () => {
    if (get().scope.kind === 'idle') return
    set({ scope: IDLE_SCOPE })
  },
  endIf: (match) => {
    const scope = get().scope
    if (scope.kind === 'idle') return
    if (match(scope)) set({ scope: IDLE_SCOPE })
  },
}))

// Derived, reference-stable views of the active scope, replacing the legacy
// `useEditor.activeHandleDrag` / `useEditor.editingHole` flags. `useShallow`
// keeps the result reference-stable across unrelated scope changes, so hot-path
// subscribers (camera controls, floating menu) don't re-render on every update.
export const useActiveHandleDrag = (): { nodeId: string; label: string } | null =>
  useInteractionScope(useShallow((s) => handleDragInfo(s.scope)))

export const useEditingHole = (): { nodeId: string; holeIndex: number } | null =>
  useInteractionScope(useShallow((s) => editingHoleInfo(s.scope)))

// Imperative (non-React) reads for event handlers / effects.
export const getEditingHole = (): { nodeId: string; holeIndex: number } | null =>
  editingHoleInfo(useInteractionScope.getState().scope)

export const getIsCurveReshape = (): boolean => isCurveReshape(useInteractionScope.getState().scope)

// Replaces the legacy `curvingWall` / `curvingFence` existence flags. The
// wall-vs-fence distinction (both now map to one `reshaping/'curve'` scope) is
// recovered by reading the reshaped node's type from `useReshapingNode`.
export const useIsCurveReshape = (): boolean => useInteractionScope((s) => isCurveReshape(s.scope))

// Replaces the legacy `movingWallEndpoint` / `movingFenceEndpoint` payloads,
// minus the node (fetch it from `useReshapingNode`).
export const useEndpointReshape = (): { nodeId: string; endpoint: 'start' | 'end' } | null =>
  useInteractionScope(useShallow((s) => endpointReshapeInfo(s.scope)))

export const useControlPointReshape = (): { nodeId: string; index: number } | null =>
  useInteractionScope(useShallow((s) => controlPointReshapeInfo(s.scope)))

export const useTangentReshape = (): { nodeId: string; index: number; side: 'in' | 'out' } | null =>
  useInteractionScope(useShallow((s) => tangentReshapeInfo(s.scope)))

// The node currently being reshaped (curve / endpoint / hole), looked up live
// from the scene by the scope's `nodeId`. During a reshape the scene node holds
// the same data the legacy `curvingWall` / `movingWallEndpoint.wall` carried, so
// consumers that need the full node (affordance-tool mounts, wall-vs-fence type
// checks) read it here instead of from a parallel flag.
export const useReshapingNode = (): AnyNode | null => {
  const nodeId = useInteractionScope((s) => reshapingNodeId(s.scope))
  // Snapshot the node ONCE when the reshape begins (keyed on nodeId), like the
  // legacy `curvingWall` / `movingWallEndpoint.wall` flags did. The affordance
  // tools write the node live during the drag; subscribing to the live scene
  // node would feed those writes straight back into the tool — the curve resets
  // on pointer-stop, the endpoint drag loops and freezes. nodeId is stable for
  // the whole gesture, so a ref snapshot stays frozen until the next reshape.
  const snapshot = useRef<{ id: string | null; node: AnyNode | null }>({ id: null, node: null })
  if (snapshot.current.id !== nodeId) {
    snapshot.current = {
      id: nodeId,
      node: nodeId ? (useScene.getState().nodes[nodeId as AnyNodeId] ?? null) : null,
    }
  }
  return snapshot.current.node
}

// The node currently being placed or moved. Replaces the legacy
// `useEditor.movingNode` flag. Unlike `useReshapingNode`, no `useRef` snapshot is
// needed: the node is carried inline in the scope and set once at `begin`, so it
// is already a stable reference for the whole gesture (nothing calls `begin` mid
// drag). Returns null whenever no placing/moving interaction is active.
export const useMovingNode = (): AnyNode | null => useInteractionScope((s) => movingNodeOf(s.scope))

// Imperative (non-React) read for event handlers / effects.
export const getMovingNode = (): AnyNode | null =>
  movingNodeOf(useInteractionScope.getState().scope)

export default useInteractionScope
