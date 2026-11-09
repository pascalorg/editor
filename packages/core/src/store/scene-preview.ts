import { toSceneMaterialRef } from '../material-library'
import type { AnyNode, AnyNodeId } from '../schema/types'
import {
  beginSceneHistoryPauseSession,
  getSceneHistoryPauseDepth,
  registerSceneWriteGuard,
  runAsRemoteSceneChange,
  type SceneSnapshot,
} from './history-control'
import { hasSceneHistoryDrafts } from './history-drafts'
import useLiveNodeOverrides from './use-live-node-overrides'
import useLiveTransforms from './use-live-transforms'
import useScene, { acquireSceneReadOnlyLease } from './use-scene'

// A scene preview shows another state of the document (what it was before an agent's turn) for as
// long as someone holds a control, and gives the live scene back, untouched, when they let go.
//
// It is not an edit. History is held for its whole life, the scene is read only, and no commit is
// announced, so nothing that watches commits (the collaboration journal, the construction reveal,
// the pin) hears of it. Anything that is about to write the scene (an agent, a collaborator, an
// undo) lets go of the preview first, because a write onto a preview would be lost or land on the
// wrong state. Whoever persists the scene reads `isScenePreviewing()` and stays still.

export type ScenePreview = {
  /** Gives the live scene back. Idempotent. */
  end: () => void
}

type Held = Pick<
  SceneSnapshot,
  | 'nodes'
  | 'rootNodeIds'
  | 'collections'
  | 'materials'
  | 'installedPlugins'
  | 'hasExplicitPluginInstallState'
>

type ActivePreview = {
  held: Held
  releaseHistory: () => void
  releaseReadOnly: () => void
}

let active: ActivePreview | null = null
const listeners = new Set<(previewing: boolean) => void>()

export function isScenePreviewing(): boolean {
  return active !== null
}

export function subscribeScenePreview(listener: (previewing: boolean) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function notify(previewing: boolean): void {
  for (const listener of [...listeners]) {
    try {
      listener(previewing)
    } catch (error) {
      console.error('[Scene] Scene preview listener failed', error)
    }
  }
}

/** The ids whose node differs between two records: created, deleted or changed. Nodes are immutable. */
function differingNodeIds(
  left: Record<AnyNodeId, AnyNode>,
  right: Record<AnyNodeId, AnyNode>,
): AnyNodeId[] {
  const ids: AnyNodeId[] = []
  for (const id of Object.keys(left) as AnyNodeId[]) if (left[id] !== right[id]) ids.push(id)
  for (const id of Object.keys(right) as AnyNodeId[]) if (!(id in left)) ids.push(id)
  return ids
}

const childrenOf = (node: AnyNode | undefined): readonly string[] =>
  node && 'children' in node && Array.isArray(node.children) ? (node.children as string[]) : []

/**
 * Puts `target` on screen: the store takes it as a remote change (history and collaboration leave
 * it alone), and only what differs is marked for the systems to rebuild, with its parents and the
 * siblings of its kind when a node appears or goes, as the host's own patches do for walls.
 */
function showState(target: Held): void {
  const before = useScene.getState()
  const touched = differingNodeIds(before.nodes, target.nodes)
  useLiveNodeOverrides.getState().clearAll()
  useLiveTransforms.getState().clearAll()
  runAsRemoteSceneChange(() =>
    useScene.setState({
      nodes: target.nodes,
      rootNodeIds: target.rootNodeIds,
      collections: target.collections,
      materials: target.materials,
      installedPlugins: target.installedPlugins,
      hasExplicitPluginInstallState: target.hasExplicitPluginInstallState ?? false,
    }),
  )
  const current = useScene.getState()
  const dirty = new Set<AnyNodeId>()
  for (const id of touched) {
    if (current.nodes[id]) dirty.add(id)
    else current.clearDirty(id)
    for (const parentId of [before.nodes[id]?.parentId, current.nodes[id]?.parentId]) {
      if (parentId && current.nodes[parentId as AnyNodeId]) dirty.add(parentId as AnyNodeId)
    }
    // A wall gone or come back re-mitres its neighbours; a chair has none, so only the same kind.
    const node = before.nodes[id] ?? current.nodes[id]
    const appeared = !before.nodes[id] || !current.nodes[id]
    const parentId = node?.parentId as AnyNodeId | undefined
    if (appeared && node && parentId) {
      for (const siblingId of childrenOf(current.nodes[parentId])) {
        if (current.nodes[siblingId as AnyNodeId]?.type === node.type) {
          dirty.add(siblingId as AnyNodeId)
        }
      }
    }
  }
  if (before.materials !== current.materials) {
    const changed = new Set<string>()
    for (const id of Object.keys({ ...before.materials, ...current.materials })) {
      const key = id as keyof typeof current.materials
      if (before.materials[key] !== current.materials[key]) changed.add(toSceneMaterialRef(key))
    }
    for (const node of Object.values(current.nodes)) {
      const slots = 'slots' in node ? (node.slots as Record<string, string> | undefined) : undefined
      if (slots && Object.values(slots).some((ref) => changed.has(ref))) dirty.add(node.id)
    }
  }
  for (const id of dirty) current.markDirty(id)
}

/**
 * Shows `snapshot` (typically the state from before an agent's turn, read from the history Undo
 * would restore) until the returned handle ends. Refused (null) while another preview is up or an
 * interaction holds history: a gesture's live writes must not be shown over or swapped out.
 */
export function beginScenePreview(snapshot: SceneSnapshot): ScenePreview | null {
  if (active) return null
  if (
    !useScene.temporal.getState().isTracking ||
    getSceneHistoryPauseDepth() > 0 ||
    hasSceneHistoryDrafts()
  ) {
    return null
  }
  const state = useScene.getState()
  const held: Held = {
    nodes: state.nodes,
    rootNodeIds: state.rootNodeIds,
    collections: state.collections,
    materials: state.materials,
    installedPlugins: state.installedPlugins,
    hasExplicitPluginInstallState: state.hasExplicitPluginInstallState,
  }
  const history = beginSceneHistoryPauseSession(useScene)
  const preview: ActivePreview = {
    held,
    releaseHistory: () => history.end(),
    releaseReadOnly: acquireSceneReadOnlyLease(),
  }
  active = preview
  notify(true)
  showState(snapshot)
  return { end: () => endIf(preview) }
}

function endIf(preview: ActivePreview): void {
  if (active !== preview) return
  showState(preview.held)
  active = null
  preview.releaseReadOnly()
  preview.releaseHistory()
  notify(false)
}

/** Lets go of whichever preview is up; nothing when none is. */
export function endScenePreview(): void {
  if (active) endIf(active)
}

registerSceneWriteGuard(endScenePreview)
