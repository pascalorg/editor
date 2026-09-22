import { ensureRenderableGeometryAttributes } from '@pascal-app/viewer'
import { BufferGeometry, Float32BufferAttribute } from 'three'
import type { CurtainWallPiece } from './curtain-wall-layout'

// Adjacent fragments of one pane share a boundary, not a second glass surface.
export function buildStraightCurtainPieces(
  pieces: readonly CurtainWallPiece[],
  base: number,
  cullSharedFaces = true,
) {
  const positions: number[] = []
  const normals: number[] = []
  const quad = (a: number[], b: number[], c: number[], d: number[], normal: number[]) => {
    positions.push(...a, ...b, ...c, ...a, ...c, ...d)
    for (let index = 0; index < 6; index++) normals.push(...normal)
  }
  const sides = ['left', 'right', 'bottom', 'top'] as const
  const key = (piece: CurtainWallPiece, side: (typeof sides)[number], coordinate = piece[side]) =>
    `${side}:${coordinate.toFixed(7)}:${piece.front.toFixed(7)}:${piece.back.toFixed(7)}`
  const edges = new Map<string, CurtainWallPiece[]>()
  if (cullSharedFaces) {
    for (const piece of pieces) {
      for (const side of sides) {
        const id = key(piece, side)
        const neighbors = edges.get(id) ?? []
        neighbors.push(piece)
        edges.set(id, neighbors)
      }
    }
  }
  for (const piece of pieces) {
    const { left: l, right: r, bottom, top, front: f, back: k } = piece
    const b = bottom + base
    const t = top + base
    quad([l, b, f], [r, b, f], [r, t, f], [l, t, f], [0, 0, 1])
    quad([r, b, k], [l, b, k], [l, t, k], [r, t, k], [0, 0, -1])
    for (const side of sides) {
      const vertical = side === 'left' || side === 'right'
      let runs: [number, number][] = vertical ? [[bottom, top]] : [[l, r]]
      const opposite =
        side === 'left' ? 'right' : side === 'right' ? 'left' : side === 'bottom' ? 'top' : 'bottom'
      if (cullSharedFaces) {
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
      }
      for (const [start, end] of runs) {
        if (vertical) {
          const y0 = start + base,
            y1 = end + base
          if (side === 'left') quad([l, y0, k], [l, y0, f], [l, y1, f], [l, y1, k], [-1, 0, 0])
          else quad([r, y0, f], [r, y0, k], [r, y1, k], [r, y1, f], [1, 0, 0])
        } else if (side === 'bottom')
          quad([start, b, k], [end, b, k], [end, b, f], [start, b, f], [0, -1, 0])
        else quad([start, t, f], [end, t, f], [end, t, k], [start, t, k], [0, 1, 0])
      }
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3))
  ensureRenderableGeometryAttributes(geometry)
  return geometry
}
