import {
  type AnyNode,
  type AnyNodeId,
  cloneNodesInto,
  collectSubtree,
  findLevelAncestorId,
  useScene,
} from '@pascal-app/core'
import { getPlacementMetadataRecord, stripPlacementMetadataFlags } from './placement-metadata'

function stripDuplicatedCabinetMetadata(metadata: unknown): unknown {
  const record = getPlacementMetadataRecord(stripPlacementMetadataFlags(metadata))
  if (Object.keys(record).length === 0) return record

  const {
    cabinetCornerDerivedRun: _derived,
    cabinetCornerSourceLink: _source,
    nodeSelectionProxyId: _proxy,
    ...rest
  } = record
  return rest
}

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

function isCabinetNode(node: AnyNode | null | undefined): node is AnyNode & {
  type: 'cabinet' | 'cabinet-module'
  position: [number, number, number]
  rotation: number
} {
  return (
    (node?.type === 'cabinet' || node?.type === 'cabinet-module') &&
    Array.isArray((node as { position?: unknown }).position) &&
    typeof (node as { rotation?: unknown }).rotation === 'number'
  )
}

function composeCabinetPose(
  parentPosition: readonly [number, number, number],
  parentRotation: number,
  childPosition: readonly [number, number, number],
  childRotation: number,
) {
  const cos = Math.cos(parentRotation)
  const sin = Math.sin(parentRotation)
  return {
    position: [
      parentPosition[0] + childPosition[0] * cos + childPosition[2] * sin,
      parentPosition[1] + childPosition[1],
      parentPosition[2] - childPosition[0] * sin + childPosition[2] * cos,
    ] as [number, number, number],
    rotation: parentRotation + childRotation,
  }
}

function cabinetWorldPose(
  node: AnyNode,
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
): { position: [number, number, number]; rotation: number } | null {
  if (!isCabinetNode(node)) return null
  const parent = node.parentId ? nodes[node.parentId as AnyNodeId] : null
  if (isCabinetNode(parent)) {
    const parentPose = cabinetWorldPose(parent, nodes)
    return parentPose
      ? composeCabinetPose(parentPose.position, parentPose.rotation, node.position, node.rotation)
      : null
  }
  return { position: [...node.position], rotation: node.rotation }
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

  const parent = (subtree.root.parentId ? scene.nodes[subtree.root.parentId as AnyNodeId] : null) as
    | AnyNode
    | undefined
  const nestedCabinetRun = subtree.root.type === 'cabinet' && isCabinetNode(parent)
  const worldPose = nestedCabinetRun ? cabinetWorldPose(subtree.root, scene.nodes) : null
  const levelId = nestedCabinetRun ? findLevelAncestorId(rootId, scene.nodes) : null
  const root = {
    ...subtree.root,
    ...rootPatch,
    ...(worldPose ? { position: worldPose.position, rotation: worldPose.rotation } : null),
    ...(levelId ? { parentId: levelId as AnyNodeId } : null),
    metadata: {
      ...getPlacementMetadataRecord(stripDuplicatedCabinetMetadata(subtree.root.metadata)),
      ...getPlacementMetadataRecord(stripDuplicatedCabinetMetadata(rootPatch.metadata)),
      isNew: true,
    },
  } as AnyNode
  const descendants = subtree.descendants.map((node) => ({
    ...node,
    metadata: stripDuplicatedCabinetMetadata(node.metadata),
  })) as AnyNode[]
  const parentId = parentIdOf(root)
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
