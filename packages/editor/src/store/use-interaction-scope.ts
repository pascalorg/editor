'use client'

import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import {
  type ActiveInteractionScope,
  editingHoleInfo,
  handleDragInfo,
  IDLE_SCOPE,
  type InteractionScope,
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

export default useInteractionScope
