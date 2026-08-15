'use client'

import { runAsSingleSceneHistoryStep, useScene } from '@pascal-app/core'
import useAgentActivity, { type AgentActivityEntry } from '../store/use-agent-activity'
import { type SceneGraph, syncEditorSelectionFromCurrentScene } from './scene'

/** The scene as the editor currently holds it, in the shape the API round-trips. */
export function currentSceneGraph(): SceneGraph {
  const {
    nodes,
    rootNodeIds,
    collections,
    savedViews,
    comments,
    definitions,
    materials,
    installedPlugins,
  } = useScene.getState()
  return {
    nodes,
    rootNodeIds,
    collections,
    savedViews,
    comments,
    definitions,
    materials,
    installedPlugins,
  } as SceneGraph
}

const nodeCount = (graph: SceneGraph): number => Object.keys(graph.nodes ?? {}).length

/**
 * Apply a graph the agent produced as **exactly one undo step**.
 *
 * This is the whole reason agent changes don't go through
 * `applySceneGraphToEditor`: that function ends with `clearSceneHistory()`,
 * which is right for loading a document (the load is the undo floor) and wrong
 * for an edit arriving mid-session — it threw away everything the user had
 * done before the agent touched the scene. Here the prior history survives and
 * the agent's whole operation collapses into a single Ctrl+Z, which is what
 * the user means by "undo what the agent just did".
 */
export function applyAgentSceneGraph(graph: SceneGraph): void {
  runAsSingleSceneHistoryStep(useScene, () => {
    useScene.getState().setScene(graph.nodes as never, graph.rootNodeIds as never, {
      collections: graph.collections as never,
      savedViews: graph.savedViews as never,
      comments: graph.comments as never,
      definitions: graph.definitions as never,
      materials: graph.materials as never,
      ...(graph.installedPlugins && {
        installedPlugins: graph.installedPlugins,
        hasExplicitPluginInstallState: true,
      }),
    })
  })
  syncEditorSelectionFromCurrentScene()
}

/**
 * Receive a live scene event produced by an MCP tool.
 *
 * Either applies it straight away (when the user has opted into auto-apply) or
 * holds it as the pending proposal for the review bar. Returns whether the
 * change was applied, so the caller can keep its version/echo bookkeeping in
 * step — a held change must *not* advance the echo signature, or the eventual
 * apply reads as a local edit.
 */
export function receiveAgentSceneChange(change: {
  eventId: number
  kind: string
  version: number
  graph: SceneGraph
}): boolean {
  const store = useAgentActivity.getState()
  const previousGraph = currentSceneGraph()

  const entry: AgentActivityEntry = {
    id: change.eventId,
    kind: change.kind,
    version: change.version,
    receivedAt: new Date().toISOString(),
    nodesBefore: nodeCount(previousGraph),
    nodesAfter: nodeCount(change.graph),
    status: store.autoApply ? 'applied' : 'pending',
  }

  if (store.autoApply) {
    applyAgentSceneGraph(change.graph)
    store.recordEntry(entry)
    return true
  }

  // A second proposal while one is still pending: the newer server state
  // supersedes it — the agent has moved on, and holding a stale graph would
  // let the user "apply" something the server no longer has. Keep the original
  // `previousGraph` so rejecting still lands on the last user-approved state.
  const superseded = store.pending
  store.recordEntry(entry)
  if (superseded) store.updateEntryStatus(superseded.entry.id, 'rejected')
  store.setPending({
    entry,
    graph: change.graph,
    previousGraph: superseded ? superseded.previousGraph : previousGraph,
  })
  return false
}

/** Accept the held proposal. */
export function applyPendingAgentChange(): void {
  const { pending, setPending, updateEntryStatus } = useAgentActivity.getState()
  if (!pending) return
  applyAgentSceneGraph(pending.graph)
  updateEntryStatus(pending.entry.id, 'applied')
  setPending(null)
}

/**
 * Reject the held proposal and restore what the editor had before it.
 *
 * The restore is itself a single undo step: the user should be able to take
 * back a rejection the same way they take back anything else.
 */
export function rejectPendingAgentChange(): void {
  const { pending, setPending, updateEntryStatus } = useAgentActivity.getState()
  if (!pending) return
  applyAgentSceneGraph(pending.previousGraph)
  updateEntryStatus(pending.entry.id, 'rejected')
  setPending(null)
}
