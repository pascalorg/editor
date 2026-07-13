import {
  type AnyNode,
  type AnyNodeId,
  cloneNodesInto,
  collectSubtree,
  type DuplicableConfig,
  nodeRegistry,
  useScene,
} from '@pascal-app/core'
import { getPlacementMetadataRecord, stripPlacementMetadataFlags } from './placement-metadata'

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

function duplicableConfigFor(node: AnyNode): DuplicableConfig | null {
  const duplicable = nodeRegistry.get(node.type)?.capabilities?.duplicable
  return duplicable && typeof duplicable === 'object' ? duplicable : null
}

export function duplicatesAsFreshSubtree(node: AnyNode): boolean {
  const children = (node as { children?: unknown }).children
  return (
    duplicableConfigFor(node)?.subtree === true && Array.isArray(children) && children.length > 0
  )
}

/**
 * Creates a fresh draft copy of a live subtree, with every child reference
 * rewired before move mode starts.
 */
export function createFreshPlacementSubtree(
  rootId: AnyNodeId,
  rootPatch: Partial<AnyNode> = {},
): AnyNodeId | null {
  const scene = useScene.getState()
  const subtree = collectSubtree(scene.nodes, rootId)
  if (!subtree) return null

  const baseRoot = {
    ...subtree.root,
    ...rootPatch,
  } as AnyNode
  const prepared = duplicableConfigFor(subtree.root)?.prepareSubtreeClone?.({
    root: baseRoot,
    descendants: subtree.descendants,
    rootId,
    rootPatch,
    nodes: scene.nodes,
  })
  const preparedRoot = prepared?.root ?? baseRoot
  const root = {
    ...preparedRoot,
    metadata: {
      ...getPlacementMetadataRecord(stripPlacementMetadataFlags(preparedRoot.metadata)),
      isNew: true,
    },
  } as AnyNode
  const descendants = (prepared?.descendants ?? subtree.descendants).map((node: AnyNode) => ({
    ...node,
    metadata: stripPlacementMetadataFlags(node.metadata),
  })) as AnyNode[]
  const parentId =
    prepared && Object.hasOwn(prepared, 'parentId')
      ? (prepared.parentId ?? undefined)
      : parentIdOf(root)
  const cloned = cloneNodesInto([root, ...descendants], {
    rootId,
    parentId,
  })

  useScene
    .getState()
    .createNodes(
      cloned.nodes.map((node, index) => (index === 0 && parentId ? { node, parentId } : { node })),
    )

  return cloned.rootId
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
