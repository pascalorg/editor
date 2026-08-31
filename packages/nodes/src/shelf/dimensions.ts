import type { ShelfNode } from './schema'

function clampShelfDim(value: unknown, lo: number, hi: number, fallback: number): number {
  const v = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.min(Math.max(v, lo), hi)
}

export function sanitizeShelfDimensions(node: ShelfNode): ShelfNode {
  return {
    ...node,
    width: clampShelfDim(node.width, 0.3, 3.0, 1.2),
    depth: clampShelfDim(node.depth, 0.1, 1.0, 0.3),
    thickness: clampShelfDim(node.thickness, 0.01, 0.1, 0.04),
    height: clampShelfDim(node.height, 0.05, 2.5, 0.9),
    rows: Math.round(clampShelfDim(node.rows, 1, 8, 1)),
    columns: Math.round(clampShelfDim(node.columns, 1, 6, 1)),
  }
}
