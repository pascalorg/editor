'use client'

import { create } from 'zustand'
import type { SceneGraph } from '../lib/scene'

/**
 * One MCP operation as seen from the editor.
 *
 * Every mutating MCP tool already publishes a live event naming itself
 * (`publishLiveSceneSnapshot(bridge, 'create_wall')` and friends), so the feed
 * costs nothing to produce — it was simply never surfaced. `kind` is that tool
 * name verbatim.
 */
export type AgentActivityEntry = {
  /** Server-assigned scene-event id; also the dedupe key. */
  id: number
  kind: string
  version: number
  receivedAt: string
  /** Node counts either side of the change — the cheapest honest "what happened". */
  nodesBefore: number
  nodesAfter: number
  status: 'applied' | 'pending' | 'rejected'
}

/**
 * A change the agent made server-side that the editor is holding back until the
 * user decides.
 *
 * `previousGraph` is what the local editor held before the change. Rejecting
 * restores it and lets autosave push it back — the agent's own client already
 * believes the change landed, so a rejection is a *correction*, not a veto.
 * That asymmetry is inherent to MCP's write-then-notify shape and is surfaced
 * in the UI rather than hidden.
 */
export type PendingAgentChange = {
  entry: AgentActivityEntry
  graph: SceneGraph
  previousGraph: SceneGraph
}

/**
 * A prompt the user typed in the editor, and what became of it.
 *
 * MCP is client-driven — the editor cannot message a connected agent — so the
 * prompt goes into a queue the agent polls with `await_editor_request`. Which
 * means "sent" and "read" are genuinely different states here, and the user has
 * to be able to see that nothing has picked their prompt up yet.
 */
export type AgentPrompt = {
  requestId: number
  prompt: string
  status: 'pending' | 'claimed' | 'answered'
  answer: string | null
  createdAt: string
  /** When an agent took it. Null while still queued. */
  claimedAt: string | null
}

const MAX_ENTRIES = 50

type AgentActivityState = {
  /** Newest first, capped — this is a feed, not an audit log. */
  entries: AgentActivityEntry[]
  pending: PendingAgentChange | null
  /**
   * When true, incoming agent changes apply without asking. Off by default:
   * silent application is the problem this panel exists to fix. The escape
   * hatch is for users actively driving the agent from another window, where
   * confirming every step is friction rather than safety.
   */
  autoApply: boolean
  /** Whether a live event stream is currently connected. */
  connected: boolean
  /** Prompts sent from the editor, oldest first. */
  prompts: AgentPrompt[]
  /**
   * Installed by the host app, which owns the transport. Absent in an embedder
   * that has no queue endpoint — the prompt box then does not render at all,
   * rather than offering a box that silently drops what is typed into it.
   */
  sendPrompt: ((prompt: string) => Promise<void>) | null

  recordEntry: (entry: AgentActivityEntry) => void
  updateEntryStatus: (id: number, status: AgentActivityEntry['status']) => void
  setPending: (pending: PendingAgentChange | null) => void
  setAutoApply: (autoApply: boolean) => void
  setConnected: (connected: boolean) => void
  setPrompts: (prompts: AgentPrompt[]) => void
  setSendPrompt: (send: ((prompt: string) => Promise<void>) | null) => void
  clear: () => void
}

/**
 * Ephemeral view of what the connected agent has been doing. Deliberately not
 * persisted and not part of the scene: it describes the session, not the
 * document.
 */
const useAgentActivity = create<AgentActivityState>((set) => ({
  entries: [],
  pending: null,
  autoApply: false,
  connected: false,
  prompts: [],
  sendPrompt: null,

  recordEntry: (entry) =>
    set((state) => {
      // The stream can redeliver an event across a reconnect; the server id is
      // the only stable identity, so dedupe on it rather than on arrival order.
      if (state.entries.some((existing) => existing.id === entry.id)) return state
      return { entries: [entry, ...state.entries].slice(0, MAX_ENTRIES) }
    }),

  updateEntryStatus: (id, status) =>
    set((state) => ({
      entries: state.entries.map((entry) => (entry.id === id ? { ...entry, status } : entry)),
    })),

  setPending: (pending) => set({ pending }),
  setAutoApply: (autoApply) => set({ autoApply }),
  setConnected: (connected) => set({ connected }),
  setPrompts: (prompts) => set({ prompts }),
  setSendPrompt: (sendPrompt) => set({ sendPrompt }),
  clear: () => set({ entries: [], pending: null, prompts: [] }),
}))

export default useAgentActivity
