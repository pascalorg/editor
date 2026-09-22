import type { CurtainWallPiece } from '@pascal-app/core'
import { BufferGeometry, Float32BufferAttribute } from 'three'
import { ensureRenderableGeometryAttributes } from '../../lib/csg-utils'

// Adjacent fragments of one pane share a boundary, not a second glass surface.
export function buildStraightCurtainPieces(pieces: readonly CurtainWallPiece[], base: number) {
  const positions: number[] = []
  const quad = (a: number[], b: number[], c: number[], d: number[]) => {
    positions.push(...a, ...b, ...c, ...a, ...c, ...d)
  }
  const sides = ['left', 'right', 'bottom', 'top'] as const
  const key = (piece: CurtainWallPiece, side: (typeof sides)[number], coordinate = piece[side]) =>
    `${side}:${coordinate.toFixed(7)}:${piece.front.toFixed(7)}:${piece.back.toFixed(7)}`
  const edges = new Map<string, CurtainWallPiece[]>()
  for (const piece of pieces) {
    for (const side of sides) {
      const id = key(piece, side)
      const neighbors = edges.get(id) ?? []
      neighbors.push(piece)
      edges.set(id, neighbors)
    }
  }
  for (const piece of pieces) {
    const { left: l, right: r, bottom, top, front: f, back: k } = piece
    const b = bottom + base
    const t = top + base
    quad([l, b, f], [r, b, f], [r, t, f], [l, t, f])
    quad([r, b, k], [l, b, k], [l, t, k], [r, t, k])
    for (const side of sides) {
      const vertical = side === 'left' || side === 'right'
      let runs: [number, number][] = vertical ? [[bottom, top]] : [[l, r]]
      const opposite =
        side === 'left' ? 'right' : side === 'right' ? 'left' : side === 'bottom' ? 'top' : 'bottom'
      for (const other of edges.get(key(piece, opposite, piece[side])) ?? []) {
        if (other === piece) continue
        const low = vertical ? other.bottom : other.left
        const high = vertical ? other.top : other.right
        runs = runs.flatMap(([start, end]) =>
          high <= start || low >= end
            ? [[start, end]]
            : [
                ...(low > start ? [[start, low] as [number, number]] : []),
                ...(high < end ? [[high, end] as [number, number]] : []),
              ],
        )
      }
      for (const [start, end] of runs) {
        if (vertical) {
          const y0 = start + base,
            y1 = end + base
          if (side === 'left') quad([l, y0, k], [l, y0, f], [l, y1, f], [l, y1, k])
          else quad([r, y0, f], [r, y0, k], [r, y1, k], [r, y1, f])
        } else if (side === 'bottom') quad([start, b, k], [end, b, k], [end, b, f], [start, b, f])
        else quad([start, t, f], [end, t, f], [end, t, k], [start, t, k])
      }
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  ensureRenderableGeometryAttributes(geometry)
  return geometry
}
