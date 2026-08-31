import type { AnyNode, AnyNodeId, CeilingNode, SlabNode } from '../../schema'
import useLiveNodeOverrides, { type LiveNodeOverrides } from '../../store/use-live-node-overrides'
import type { LiveTransform } from '../../store/use-live-transforms'
import useScene from '../../store/use-scene'

type SurfaceOpeningUpdate = {
  id: AnyNodeId
  data: Partial<SlabNode | CeilingNode>
}

const SURFACE_OPENING_FIELDS = ['holes', 'holeMetadata'] as const

function isSurface(node: AnyNode | undefined): node is SlabNode | CeilingNode {
  return node?.type === 'slab' || node?.type === 'ceiling'
}

function isStairOpeningInputNode(node: AnyNode | undefined) {
  return node?.type === 'stair' || node?.type === 'stair-segment'
}

function omitPreviewSurfaceFields(override: LiveNodeOverrides) {
  const next = { ...override }
  for (const field of SURFACE_OPENING_FIELDS) {
    delete next[field]
  }
  return next
}

export function hasLiveStairOpeningInputs(
  nodes: Record<string, AnyNode>,
  liveTransforms: ReadonlyMap<string, LiveTransform>,
  liveOverrides: ReadonlyMap<string, LiveNodeOverrides>,
  previewSurfaceIds: ReadonlySet<string>,
) {
  for (const nodeId of liveTransforms.keys()) {
    if (nodes[nodeId]?.type === 'stair') return true
  }

  for (const [nodeId, override] of liveOverrides) {
    if (previewSurfaceIds.has(nodeId)) continue
    if (Object.keys(override).length > 0 && isStairOpeningInputNode(nodes[nodeId])) return true
  }

  return false
}

export function getNodesWithLiveStairOpeningInputs(
  nodes: Record<string, AnyNode>,
  liveTransforms: ReadonlyMap<string, LiveTransform>,
  liveOverrides: ReadonlyMap<string, LiveNodeOverrides>,
  previewSurfaceIds: ReadonlySet<string>,
) {
  const nextNodes: Record<string, AnyNode> = { ...nodes }

  for (const [nodeId, override] of liveOverrides) {
    const node = nextNodes[nodeId]
    if (!node) continue

    const values = previewSurfaceIds.has(nodeId) ? omitPreviewSurfaceFields(override) : override
    if (Object.keys(values).length === 0) continue
    nextNodes[nodeId] = { ...node, ...values } as AnyNode
  }

  for (const [nodeId, transform] of liveTransforms) {
    const node = nextNodes[nodeId]
    if (node?.type !== 'stair') continue
    nextNodes[nodeId] = {
      ...node,
      position: transform.position,
      rotation: transform.rotation,
    }
  }

  return nextNodes
}

export function createSurfaceOpeningPreviewController() {
  const previewSurfaceIds = new Set<AnyNodeId>()

  const clearSurface = (id: AnyNodeId) => {
    useLiveNodeOverrides.getState().clearFields(id, SURFACE_OPENING_FIELDS)
    useScene.getState().markDirty(id)
  }

  return {
    previewSurfaceIds,
    apply(updates: SurfaceOpeningUpdate[]) {
      const scene = useScene.getState()
      const nextSurfaceIds = new Set<AnyNodeId>()

      for (const update of updates) {
        const node = scene.nodes[update.id]
        if (!isSurface(node)) continue
        if (!('holes' in update.data || 'holeMetadata' in update.data)) continue

        nextSurfaceIds.add(update.id)
        useLiveNodeOverrides.getState().set(update.id, {
          holes: update.data.holes ?? [],
          holeMetadata: update.data.holeMetadata ?? [],
        })
        scene.markDirty(update.id)
      }

      for (const id of previewSurfaceIds) {
        if (!nextSurfaceIds.has(id)) clearSurface(id)
      }

      previewSurfaceIds.clear()
      for (const id of nextSurfaceIds) {
        previewSurfaceIds.add(id)
      }
    },
    clear() {
      for (const id of previewSurfaceIds) {
        clearSurface(id)
      }
      previewSurfaceIds.clear()
    },
  }
}
