import {
  type AnyNode,
  type AnyNodeId,
  cloneNodesInto,
  collectSubtree,
  type DuplicableConfig,
  nodeRegistry,
  useScene,
} from '@pascal-app/core'
import useInteractionScope from '../store/use-interaction-scope'
import usePlacementPreview from '../store/use-placement-preview'
import { getPlacementMetadataRecord, stripPlacementMetadataFlags } from './placement-metadata'
import {
  surfaceAttachmentId,
  surfaceAttachmentUpdates,
  updateSurfaceNode,
} from './surface-attachment'

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
  // A surface-local root needs the same attachment lifecycle even without descendants.
  if (surfaceAttachmentId(node) !== null) return true
  const policy = duplicableConfigFor(node)?.subtree
  return (
    policy === true ||
    (policy === 'with-children' && 'children' in node && node.children.length > 0)
  )
}

/**
 * Prepares a non-subtree duplicate without retaining ownership of the
 * original node's children. Subtree-capable kinds take the path above and
 * receive fresh descendant IDs; every other kind duplicates only its root.
 */
export function prepareFreshPlacementRootDuplicate(node: AnyNode): AnyNode {
  const duplicate = structuredClone(node) as unknown as Record<string, unknown> & {
    id?: AnyNodeId
    children?: unknown
    metadata?: unknown
  }
  delete duplicate.id
  if (Array.isArray(duplicate.children)) duplicate.children = []
  duplicate.metadata = {
    ...getPlacementMetadataRecord(stripPlacementMetadataFlags(duplicate.metadata)),
    isNew: true,
  }
  return duplicate as unknown as AnyNode
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

  scene.applyNodeChanges({
    create: cloned.nodes.map((node, index) =>
      index === 0 && parentId ? { node, parentId } : { node },
    ),
    update: surfaceAttachmentUpdates(cloned.rootId, parentId, surfaceAttachmentId(subtree.root)),
  })

  const created = useScene.getState().nodes[cloned.rootId]
  if (!created) return null
  useInteractionScope.getState().noteSubtreeCreation(created)
  return cloned.rootId
}

export function discardFreshPlacementSubtree(rootId: AnyNodeId): void {
  const scene = useScene.getState()
  if (!scene.nodes[rootId]) return
  scene.applyNodeChanges({
    delete: [rootId],
    update: surfaceAttachmentUpdates(rootId, null, null),
  })
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

  useInteractionScope.getState().finishSubtree(rootId)
  const surfaceId = surfaceAttachmentId(subtree.root)
  const temporal = useScene.temporal.getState()
  const wasTracking = (temporal as { isTracking?: boolean }).isTracking !== false
  if (wasTracking) temporal.pause()
  updateSurfaceNode(rootId, {}, null)
  useScene.getState().deleteNode(rootId)
  temporal.resume()
  useScene.getState().applyNodeChanges({
    create: cloned.nodes.map((node, index) =>
      index === 0 && parentId ? { node, parentId } : { node },
    ),
    update: surfaceAttachmentUpdates(cloned.rootId, parentId, surfaceId),
  })
  if (!wasTracking) temporal.pause()
  if (usePlacementPreview.getState().node?.id === rootId) usePlacementPreview.getState().clear()

  return cloned.rootId
}
