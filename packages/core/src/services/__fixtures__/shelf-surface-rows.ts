import type { ShelfNode } from '../../schema/nodes/shelf'

// Captured from production shelf geometry; checked against it in the nodes suite.
export const shelfSurfaceRows: Record<string, number[]> = {
  'wall-shelf,false,1.8,3,0.04': [0.64, 1.24, 1.8399999999999999],
  'wall-shelf,true,1.8,3,0.04': [0.64, 1.24, 1.8399999999999999],
  'bookshelf,false,1.8,3,0.04': [0.64, 1.24, 1.8399999999999999],
  'bookshelf,true,1.8,3,0.04': [0.04, 0.64, 1.24, 1.8399999999999999],
  'open-rack,false,1.8,3,0.04': [0.64, 1.24, 1.8399999999999999],
  'open-rack,true,1.8,3,0.04': [0.64, 1.24, 1.8399999999999999],
  'cubby,false,1.8,3,0.04': [0.64, 1.24, 1.8399999999999999],
  'cubby,true,1.8,3,0.04': [0.04, 0.64, 1.24, 1.8399999999999999],
}

export function shelfRowSurfaceYs(node: ShelfNode): number[] {
  const key = [node.style, node.withBottom, node.height, node.rows, node.thickness].join(',')
  const rows = shelfSurfaceRows[key]
  if (!rows) throw new Error(`Missing shelf row fixture: ${key}`)
  return rows
}
