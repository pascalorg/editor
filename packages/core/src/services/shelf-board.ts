import type { ShelfNode } from '../schema/nodes/shelf'

// Recess coplanar board/frame faces by 1 mm to avoid z-fighting.
export const SHELF_BOARD_INSET = 0.001

export function shelfBoardDimensions(
  width: number,
  thickness: number,
  depth: number,
  insetWidth = false,
): [number, number, number] {
  return [
    insetWidth ? Math.max(width - 2 * SHELF_BOARD_INSET, 0.001) : width,
    thickness,
    Math.max(depth - 2 * SHELF_BOARD_INSET, 0.001),
  ]
}

export function shelfRowBoardDimensions(host: ShelfNode, rowY: number) {
  const sides = host.style === 'cubby' || (host.style === 'bookshelf' && host.withSides)
  const bottom = host.withBottom && host.style === 'bookshelf' && rowY === host.thickness
  const insetWidth = host.style === 'open-rack' || (host.style === 'bookshelf' && !sides && !bottom)
  return shelfBoardDimensions(
    host.width - (sides ? 2 * host.thickness : 0),
    host.thickness,
    host.depth,
    insetWidth,
  )
}
