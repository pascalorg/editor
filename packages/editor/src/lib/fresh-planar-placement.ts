import {
  type AnyNode,
  type AnyNodeId,
  cloneNodesInto,
  collectSubtree,
  createSceneApi,
  type DuplicableConfig,
  getSurfaceProvider,
  nodeRegistry,
  resolveSurfacePlacement,
  type SurfaceRejectReason,
  useScene,
} from '@pascal-app/core'
import { evaluateRecipe, isProceduralItem } from '@pascal-app/core/procedural-items'
import useInteractionScope from '../store/use-interaction-scope'
import usePlacementPreview from '../store/use-placement-preview'
import { getPlacementMetadataRecord, stripPlacementMetadataFlags } from './placement-metadata'
import {
  surfaceAttachmentId,
  surfaceAttachmentUpdates,
  surfaceFramePose,
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

function namedSurfaceRejection(
  root: AnyNode,
  surfaceId: string | null,
): SurfaceRejectReason | null {
  if (surfaceId === null) return null
  const scene = createSceneApi(useScene)
  const host = root.parentId ? scene.get(root.parentId as AnyNodeId) : undefined
  if (!host || !('position' in root) || !Array.isArray(root.rotation)) return 'no-surface'
  const surface = getSurfaceProvider(host)
    .surfaces?.(host, { scene })
    .find((s) => s.id === surfaceId)
  if (!surface) return 'no-surface'
  const pose = surfaceFramePose(
    root.parentId,
    surfaceId,
    root as {
      position: [number, number, number]
      rotation: [number, number, number]
    },
    false,
  )
  const capabilities = nodeRegistry.get(root.type)?.capabilities
  const evaluated = isProceduralItem(root) ? evaluateRecipe(root.recipe, root.parameters) : null
  const bounds =
    capabilities?.dragBounds?.(root, scene.nodes()) ??
    (evaluated
      ? {
          size: evaluated.dimensions,
          center: evaluated.min.map((v, i) => (v + evaluated.max[i]!) / 2) as [
            number,
            number,
            number,
          ],
        }
      : undefined)
  const size = bounds?.size ??
    capabilities?.floorPlaced?.footprint?.(root, { nodes: scene.nodes() }).dimensions ?? [0, 0, 0]
  const center = bounds?.center
  const localBounds = center
    ? {
        min: center.map((value, axis) => value - size[axis]! / 2) as [number, number, number],
        max: center.map((value, axis) => value + size[axis]! / 2) as [number, number, number],
      }
    : undefined
  let reason: SurfaceRejectReason | null = null
  const placement = resolveSurfacePlacement({
    host,
    surface,
    childKind: root.type,
    childId: root.id,
    childFootprint: {
      size,
      rotationY: pose.rotation[1],
      rotation: pose.rotation,
      localBounds,
    },
    hit: { point: pose.position, normalWorldY: 1 },
    origin: pose.position,
    scene,
    onReject: (value) => {
      reason = value
    },
  })
  if (!placement) return reason ?? 'no-surface'
  return null
}

/**
 * Replace the draft in one validated write. History already excludes fresh
 * subtrees, so this records one creation without first deleting the preview.
 */
export function commitFreshPlacementSubtree(
  rootId: AnyNodeId,
  rootPatch: Partial<AnyNode>,
  onReject?: (reason: SurfaceRejectReason) => void,
): AnyNodeId | null {
  const scene = useScene.getState()
  const subtree = collectSubtree(scene.nodes, rootId)
  if (!subtree || scene.readOnly) return null

  const root = cleanPlacementMetadata({ ...subtree.root, ...rootPatch } as AnyNode)
  const surfaceId =
    root.parentId === subtree.root.parentId ? surfaceAttachmentId(subtree.root) : null
  const rejection = namedSurfaceRejection(root, surfaceId)
  if (rejection) {
    onReject?.(rejection)
    return null
  }
  const descendants = subtree.descendants.map((node) => cleanPlacementMetadata(node))
  const parentId = parentIdOf(root)
  const cloned = cloneNodesInto([root, ...descendants], { rootId, parentId })
  const updates = surfaceAttachmentUpdates(rootId, null, null)
  for (const update of surfaceAttachmentUpdates(cloned.rootId, parentId, surfaceId)) {
    const attachments = { ...(update.data as { attachments: Record<string, string> }).attachments }
    delete attachments[rootId]
    const previous = updates.findIndex((entry) => entry.id === update.id)
    const merged = { id: update.id, data: { attachments } }
    if (previous === -1) updates.push(merged)
    else updates[previous] = merged
  }

  const scope = useInteractionScope.getState()
  const factoryCreated =
    scope.ownedSubtree?.creation.rootId === rootId || scope.pendingSubtree?.rootId === rootId
  const temporal = useScene.temporal.getState()
  const wasTracking = temporal.isTracking
  if (!factoryCreated && descendants.length === 0 && surfaceId === null) {
    // Preserve the established root-only lifecycle for placements outside the subtree factory.
    if (wasTracking) temporal.pause()
    updateSurfaceNode(rootId, {}, null)
    useScene.getState().deleteNode(rootId)
    temporal.resume()
    useScene.getState().applyNodeChanges({
      create: cloned.nodes.map((node, index) =>
        index === 0 && parentId ? { node, parentId } : { node },
      ),
      update: updates,
    })
    if (!wasTracking) temporal.pause()
  } else {
    temporal.resume()
    try {
      // applyNodeChanges validates the complete proposed graph before publishing any part of it.
      scene.applyNodeChanges({
        delete: [rootId],
        create: cloned.nodes.map((node, index) =>
          index === 0 && parentId ? { node, parentId } : { node },
        ),
        update: updates,
      })
      for (const node of [subtree.root, ...subtree.descendants]) scene.clearDirty(node.id)
    } catch (error) {
      // Zustand publishes before notifying subscribers. A subscriber error must restore
      // the draft and its ownership/history, never masquerade as a placement refusal.
      temporal.pause()
      try {
        if (useScene.getState() !== scene) useScene.setState(scene, true)
      } finally {
        useInteractionScope.setState(scope)
        useScene.temporal.setState(temporal)
      }
      throw error
    } finally {
      if (!wasTracking) temporal.pause()
    }
  }
  useInteractionScope.getState().finishSubtree(rootId)
  if (usePlacementPreview.getState().node?.id === rootId) usePlacementPreview.getState().clear()
  return cloned.rootId
}
