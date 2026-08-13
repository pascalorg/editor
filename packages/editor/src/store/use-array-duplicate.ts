'use client'

import {
  type AnyNode,
  type AnyNodeId,
  cloneNodesInto,
  collectSubtree,
  runAsSingleSceneHistoryStep,
  subscribeSceneCommits,
  useScene,
} from '@pascal-app/core'
import { create } from 'zustand'
import {
  type ArrayCommand,
  buildArrayOffsets,
  detectUniformTranslation,
  translateNodeGeometry,
  type UniformTranslation,
} from '../lib/array-duplicate'

/**
 * The move an array command would repeat.
 *
 * Recorded from the scene commit stream rather than from each move tool. There
 * are several move paths — the 3D registry mover, the 2D floor-plan overlay,
 * the group-move gizmo — and they all land as one commit, so subscribing once
 * here gives the 2D/3D parity `wiki/architecture/tools.md` requires without
 * either view knowing arrays exist.
 */
type ArrayDuplicateState = {
  lastMove: UniformTranslation | null
  setLastMove: (move: UniformTranslation | null) => void
}

const useArrayDuplicate = create<ArrayDuplicateState>((set) => ({
  lastMove: null,
  setLastMove: (lastMove) => set({ lastMove }),
}))

/** True when a `*n` / `/n` command has a move to act on. */
export function isArrayCommandArmed(): boolean {
  return useArrayDuplicate.getState().lastMove !== null
}

export function getLastMove(): UniformTranslation | null {
  return useArrayDuplicate.getState().lastMove
}

export function clearLastMove(): void {
  useArrayDuplicate.getState().setLastMove(null)
}

let stopCommitSubscription: (() => void) | null = null

/**
 * Start watching scene commits for moves. Idempotent; the editor calls this
 * once on mount.
 */
export function startArrayDuplicateTracking(): () => void {
  if (stopCommitSubscription) return stopCommitSubscription

  stopCommitSubscription = subscribeSceneCommits((commit) => {
    // Only the user's own edits arm the command. A commit that arrived from a
    // load or a collaborator is not "the last move I made".
    if (commit.origin !== 'local') {
      useArrayDuplicate.getState().setLastMove(null)
      return
    }
    // A commit that is not a plain translation clears the arming rather than
    // leaving a stale one behind — after a delete, `*3` must not resurrect the
    // move from two edits ago.
    useArrayDuplicate
      .getState()
      .setLastMove(detectUniformTranslation(commit.before.nodes, commit.current.nodes))
  })

  return stopCommitSubscription
}

export function stopArrayDuplicateTracking(): void {
  stopCommitSubscription?.()
  stopCommitSubscription = null
}

function parentIdOf(node: AnyNode): AnyNodeId | undefined {
  return (node as { parentId?: AnyNodeId | null }).parentId ?? undefined
}

export type ArrayDuplicateResult = {
  createdIds: AnyNodeId[]
  copies: number
}

/**
 * Run an array command against the recorded move.
 *
 * Each moved node's whole subtree is cloned per offset, so arraying a cabinet
 * run copies its modules too. Every clone lands in one
 * `runAsSingleSceneHistoryStep`: twelve copies is one action to the user, and
 * without the fence backing it out would cost twelve undos.
 *
 * Returns `null` when nothing is armed or the command produces no copies.
 */
export function runArrayCommand(command: ArrayCommand): ArrayDuplicateResult | null {
  const move = useArrayDuplicate.getState().lastMove
  if (!move) return null

  const offsets = buildArrayOffsets(move.translation, command)
  if (offsets.length === 0) return null

  const scene = useScene.getState()
  if (scene.readOnly) return null

  // Resolve subtrees up front: the loop below inserts nodes, and re-reading the
  // scene mid-loop would start cloning the copies it just made.
  const sources: Array<{ root: AnyNode; descendants: AnyNode[] }> = []
  for (const id of move.nodeIds) {
    const subtree = collectSubtree(scene.nodes, id)
    if (subtree) sources.push(subtree)
  }
  if (sources.length === 0) return null

  const createdIds: AnyNodeId[] = []

  runAsSingleSceneHistoryStep(useScene, () => {
    for (const offset of offsets) {
      for (const { root, descendants } of sources) {
        const parentId = parentIdOf(root)
        // Shift the root's own geometry rather than relying on
        // `cloneNodesInto`'s `position` stamp — that only covers kinds that
        // have a `position`, and a wall's is its `start`/`end` pair.
        const cloned = cloneNodesInto([translateNodeGeometry(root, offset), ...descendants], {
          rootId: root.id,
          ...(parentId ? { parentId } : {}),
        })
        // Only the root is re-parented; `cloneNodesInto` already rewired every
        // descendant's `parentId` onto its cloned parent.
        useScene
          .getState()
          .createNodes(
            cloned.nodes.map((node, index) =>
              index === 0 && parentId ? { node, parentId } : { node },
            ),
          )
        createdIds.push(cloned.rootId)
      }
    }
  })

  return { createdIds, copies: createdIds.length }
}

export default useArrayDuplicate
