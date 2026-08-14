'use client'

import type { CommentId } from '@pascal-app/core'
import { create } from 'zustand'

/**
 * A pin the user has dropped but not yet written a body for. Held here rather
 * than in `useScene` so an abandoned pin never reaches the scene file — the
 * thread is only created when the body is submitted.
 */
export type CommentDraft = {
  position: [number, number, number]
  nodeId?: string
  offset?: [number, number, number]
  levelId?: string
  /** Which view dropped the pin. The 2D view has no camera to record. */
  origin: '2d' | '3d'
}

type CommentUiState = {
  /** The thread whose bubble is open. */
  activeId: CommentId | null
  setActiveId: (id: CommentId | null) => void

  draft: CommentDraft | null
  setDraft: (draft: CommentDraft | null) => void

  /** Resolved threads are hidden by default — the panel is a to-do list. */
  showResolved: boolean
  setShowResolved: (showResolved: boolean) => void
}

/**
 * Ephemeral comment UI state: which bubble is open, and the pin waiting for a
 * body. Deliberately neither persisted nor history-tracked, like the other
 * per-gesture stores.
 */
const useCommentUi = create<CommentUiState>((set) => ({
  activeId: null,
  setActiveId: (activeId) => set({ activeId, ...(activeId ? { draft: null } : {}) }),

  draft: null,
  setDraft: (draft) => set({ draft, ...(draft ? { activeId: null } : {}) }),

  showResolved: false,
  setShowResolved: (showResolved) => set({ showResolved }),
}))

export default useCommentUi
