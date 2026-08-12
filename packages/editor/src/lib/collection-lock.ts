import { buildCollectionMembershipIndex, isLockedByCollections, useScene } from '@pascal-app/core'

/**
 * Whether a node may be picked, given the collections it belongs to.
 *
 * A locked collection is a request not to touch its members, and refusing the
 * *selection* is what makes that stick: move, rotate, delete, the action menu
 * and the parametric inspector are all reached through the selection, so
 * guarding this one door covers them without each growing a check of its own.
 *
 * Deliberately not applied to programmatic selection — a tool selecting the node
 * it just created is not the user reaching for locked geometry.
 */
export function isNodeLockedForSelection(nodeId: string): boolean {
  return isLockedByCollections(
    buildCollectionMembershipIndex(useScene.getState().collections),
    nodeId,
  )
}
