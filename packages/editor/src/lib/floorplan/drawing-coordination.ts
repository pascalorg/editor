import {
  type AnyNode,
  type ConstructionDimensionNode,
  type ConstructionDrawingType,
  resolveConstructionDimensionDrawingPresentation,
} from '@pascal-app/core'

export function resolveNodeForDrawingType(
  node: AnyNode,
  nodes: Record<string, AnyNode>,
  drawingType: ConstructionDrawingType,
): AnyNode | null {
  if (node.type !== 'construction-dimension') return node
  const presentation = resolveConstructionDimensionDrawingPresentation(node, drawingType)
  if (presentation === 'omit') return null
  if (presentation === 'shown') return node
  if (presentation === 'reference') {
    return { ...node, metadata: lockedMetadata(node), reference: true }
  }

  const controller = node.controllingDimensionId ? nodes[node.controllingDimensionId] : undefined
  if (
    controller?.type !== 'construction-dimension' ||
    controller.id === node.id ||
    controller.drawingType !== 'foundation-plan'
  ) {
    return {
      ...node,
      metadata: lockedMetadata(node),
      prefix: `UNLINKED CONTROL · ${node.prefix}`,
      reference: true,
    }
  }

  return resolveControlledDimension(node, controller)
}

function resolveControlledDimension(
  node: ConstructionDimensionNode,
  controller: ConstructionDimensionNode,
): ConstructionDimensionNode {
  return {
    ...node,
    metadata: lockedMetadata(node),
    anchors: controller.anchors,
    baseline: controller.baseline,
    chainMode: controller.chainMode,
    mode: controller.mode,
    showCenterMark: controller.showCenterMark,
    reference: true,
  }
}

function lockedMetadata(node: ConstructionDimensionNode): ConstructionDimensionNode['metadata'] {
  const metadata =
    typeof node.metadata === 'object' && node.metadata !== null && !Array.isArray(node.metadata)
      ? node.metadata
      : {}
  return { ...metadata, drawingCoordinationLocked: true }
}
