import type { WindowNode } from '@pascal-app/core'

type HingedWindow = Pick<WindowNode, 'windowType' | 'casementStyle' | 'hingesSide'> &
  Partial<Pick<WindowNode, 'openingKind' | 'source'>>

/**
 * Whether a window hangs one sash from a side jamb, so its hinge side can be swapped: a single
 * casement. A French casement hinges on both jambs; awning and hopper sashes hinge on the head
 * or the sill, and every other type slides, pivots or stays fixed. A window has no inward or
 * outward setting, so there is no swing side to swap.
 */
export function canSwapWindowHinge(node: HingedWindow): boolean {
  return (
    !node.source &&
    node.openingKind !== 'opening' &&
    node.windowType === 'casement' &&
    (node.casementStyle ?? 'single') === 'single'
  )
}

/** The sash hung from the other jamb. */
export function swapWindowHingePatch(node: HingedWindow): Partial<WindowNode> {
  return { hingesSide: node.hingesSide === 'right' ? 'left' : 'right' }
}
