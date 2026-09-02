import type { AnyNode, AnyNodeId, ColumnNode, LeanToExtensionNode } from '@pascal-app/core'
import type { LeanToPostSide } from '../lean-to-extension/assembly'
import { resolveLeanToLayout } from '../lean-to-extension/layout'

function managedPostSlot(column: ColumnNode): { side: LeanToPostSide; index: number } | null {
  const metadata = column.metadata
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  if (metadata.leanToRole !== 'post' || typeof metadata.managedByLeanTo !== 'string') return null
  if (typeof metadata.leanToPostIndex !== 'number' || !Number.isInteger(metadata.leanToPostIndex)) {
    return null
  }
  return {
    side: metadata.leanToPostSide === 'high' ? 'high' : 'low',
    index: metadata.leanToPostIndex,
  }
}

export function isLeanToPostOmitted(
  leanTo: LeanToExtensionNode,
  side: LeanToPostSide,
  index: number,
): boolean {
  const currentCount = resolveLeanToLayout(leanTo).postXs.length
  return (leanTo.omittedPostSlots ?? []).some((slot) => {
    if (slot.side !== side) return false
    if (slot.index < 0 || index < 0) return slot.index === index
    if (leanTo.hostKind === 'conical-roof') {
      const normalized = slot.index / Math.max(1, slot.layoutCount)
      return Math.round(normalized * currentCount) % currentCount === index
    }
    const normalized = slot.index / Math.max(1, slot.layoutCount - 1)
    return Math.round(normalized * Math.max(1, currentCount - 1)) === index
  })
}

export function leanToPostOmissionPatchesOnDelete(
  column: ColumnNode,
  nodes: Record<AnyNodeId, AnyNode>,
): Array<{ id: AnyNodeId; data: Partial<AnyNode> }> {
  const slot = managedPostSlot(column)
  if (!slot) return []
  const metadata = column.metadata as Record<string, unknown>
  const leanTo = nodes[metadata.managedByLeanTo as AnyNodeId]
  if (leanTo?.type !== 'lean-to-extension' || isLeanToPostOmitted(leanTo, slot.side, slot.index)) {
    return []
  }
  return [
    {
      id: leanTo.id as AnyNodeId,
      data: {
        omittedPostSlots: [
          ...(leanTo.omittedPostSlots ?? []),
          { ...slot, layoutCount: resolveLeanToLayout(leanTo).postXs.length },
        ],
      },
    },
  ]
}
