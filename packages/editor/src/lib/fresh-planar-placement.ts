import {
  type AnyNode,
  type AnyNodeId,
  cloneNodesInto,
  collectSubtree,
  useScene,
} from '@pascal-app/core'
import { stripPlacementMetadataFlags } from './placement-metadata'

function cleanPlacementMetadata<N extends AnyNode>(node: N): N {
  return {
    ...node,
    metadata: stripPlacementMetadataFlags(node.metadata),
  } as N
}

function parentIdOf(node: AnyNode): AnyNodeId | undefined {
  const parentId = (node as { parentId?: AnyNodeId | null }).parentId
  return parentId ?? undefined
}

/**
 * Finalises a fresh catalog/duplicate draft as a single undoable creation.
 *
 * Fresh drafts already exist in the scene so renderers and move tools can
 * preview real geometry. On commit we delete that draft while history is
 * paused, then create a clean clone at the final cursor position with history
 * resumed. Undo therefore removes the placed node instead of resurrecting the
 * hidden draft at its origin.
 */
export function commitFreshPlacementSubtree(
  rootId: AnyNodeId,
  rootPatch: Partial<AnyNode>,
): AnyNodeId | null {
  const scene = useScene.getState()
  const subtree = collectSubtree(scene.nodes, rootId)
  if (!subtree) return null

  const root = cleanPlacementMetadata({
    ...subtree.root,
    ...rootPatch,
  } as AnyNode)
  const descendants = subtree.descendants.map((node) => cleanPlacementMetadata(node))
  const parentId = parentIdOf(root)
  const cloned = cloneNodesInto([root, ...descendants], {
    rootId,
    parentId,
  })

  const temporal = useScene.temporal.getState()
  const wasTracking = (temporal as { isTracking?: boolean }).isTracking !== false
  if (wasTracking) temporal.pause()
  useScene.getState().deleteNode(rootId)
  temporal.resume()
  useScene
    .getState()
    .createNodes(
      cloned.nodes.map((node, index) => (index === 0 && parentId ? { node, parentId } : { node })),
    )
  if (!wasTracking) temporal.pause()

  return cloned.rootId
}
