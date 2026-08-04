import {
  type AnyNode,
  type ConstructionDimensionNode,
  type ConstructionDrawingType,
  resolveConstructionDimensionDrawingOverride,
  resolveConstructionDimensionDrawingPresentation,
} from '@pascal-app/core'

export function resolveConstructionDimensionForDrawing(args: {
  node: ConstructionDimensionNode
  nodes: Record<string, AnyNode>
  drawingType: ConstructionDrawingType
}): ConstructionDimensionNode | null {
  const { node, nodes, drawingType } = args
  const presentation = resolveConstructionDimensionDrawingPresentation(node, drawingType)
  if (presentation === 'omit') return null
  if (presentation === 'shown') return applyDrawingOverride(node, drawingType)

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
    }
  }

  return resolveControlledDimension(node, controller)
}

function resolveControlledDimension(
  node: ConstructionDimensionNode,
  controller: ConstructionDimensionNode,
): ConstructionDimensionNode {
  const overridden = applyDrawingOverride(node, 'floor-plan')
  return {
    ...overridden,
    metadata: lockedMetadata(overridden),
    anchors: controller.anchors,
    baseline: controller.baseline,
    chainMode: controller.chainMode,
    mode: controller.mode,
    showCenterMark: controller.showCenterMark,
  }
}

function applyDrawingOverride(
  node: ConstructionDimensionNode,
  drawingType: ConstructionDrawingType,
): ConstructionDimensionNode {
  const override = resolveConstructionDimensionDrawingOverride(node, drawingType)
  if (!override || override.suppressedSegmentIndexes.length === 0) return node
  return {
    ...node,
    metadata: {
      ...(typeof node.metadata === 'object' &&
      node.metadata !== null &&
      !Array.isArray(node.metadata)
        ? node.metadata
        : {}),
      suppressedDimensionSegmentIndexes: override.suppressedSegmentIndexes,
    },
  }
}

function lockedMetadata(node: ConstructionDimensionNode): ConstructionDimensionNode['metadata'] {
  const metadata =
    typeof node.metadata === 'object' && node.metadata !== null && !Array.isArray(node.metadata)
      ? node.metadata
      : {}
  return { ...metadata, drawingCoordinationLocked: true }
}
