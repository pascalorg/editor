import { subtractPolygonsFromPolygon } from '@pascal-app/core'
import { ensureRenderableGeometryAttributes } from '@pascal-app/viewer'
import { BufferGeometry, Float32BufferAttribute, ShapeUtils, Vector2 } from 'three'
import type { CurtainWallPiece } from './curtain-wall-layout'

type PolygonPoint = [number, number]

export function buildStraightCurtainPiecesWithCutouts(
  pieces: readonly CurtainWallPiece[],
  base: number,
  cutouts: readonly (readonly Vector2[])[],
) {
  const positions: number[] = []
  const normals: number[] = []
  const preparedCutouts = cutouts.map((cutout) => {
    const points = cutout.map((point): PolygonPoint => [point.x, point.y])
    const xs = points.map(([x]) => x)
    const ys = points.map(([, y]) => y)
    return {
      points,
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
    }
  })
  const vertex = (point: readonly number[], normal: readonly number[]) => {
    positions.push(point[0]!, point[1]!, point[2]!)
    normals.push(normal[0]!, normal[1]!, normal[2]!)
  }
  const contains = (ring: readonly PolygonPoint[], point: PolygonPoint) => {
    let inside = false
    for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
      const a = ring[index]!
      const b = ring[previous]!
      if (
        a[1] > point[1] !== b[1] > point[1] &&
        point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
      ) {
        inside = !inside
      }
    }
    return inside
  }
  const area = (ring: readonly PolygonPoint[]) =>
    Math.abs(
      ring.reduce((sum, point, index) => {
        const next = ring[(index + 1) % ring.length]!
        return sum + point[0] * next[1] - next[0] * point[1]
      }, 0) / 2,
    )
  for (const piece of pieces) {
    const bottom = piece.bottom + base
    const top = piece.top + base
    const overlapping = preparedCutouts.filter(
      (cutout) =>
        cutout.maxX > piece.left &&
        cutout.minX < piece.right &&
        cutout.maxY > bottom &&
        cutout.minY < top,
    )
    const subject: PolygonPoint[] = [
      [piece.left, bottom],
      [piece.right, bottom],
      [piece.right, top],
      [piece.left, top],
    ]
    const rings = subtractPolygonsFromPolygon(
      subject,
      overlapping.map(({ points }) => points),
    ).sort((a, b) => area(b) - area(a))
    const groups: Array<{ contour: PolygonPoint[]; holes: PolygonPoint[][] }> = []
    for (const ring of rings) {
      const parent = groups.find(({ contour }) => contains(contour, ring[0]!))
      if (parent) parent.holes.push([...ring].reverse())
      else groups.push({ contour: ring, holes: [] })
    }
    for (const { contour, holes } of groups) {
      const flattened = [contour, ...holes].flat()
      const triangles = ShapeUtils.triangulateShape(
        contour.map(([x, y]) => new Vector2(x, y)),
        holes.map((hole) => hole.map(([x, y]) => new Vector2(x, y))),
      )
      for (const triangle of triangles) {
        const aIndex = triangle[0]!
        const bIndex = triangle[1]!
        const cIndex = triangle[2]!
        const a = flattened[aIndex]!
        const b = flattened[bIndex]!
        const c = flattened[cIndex]!
        vertex([a[0], a[1], piece.front], [0, 0, 1])
        vertex([b[0], b[1], piece.front], [0, 0, 1])
        vertex([c[0], c[1], piece.front], [0, 0, 1])
        vertex([c[0], c[1], piece.back], [0, 0, -1])
        vertex([b[0], b[1], piece.back], [0, 0, -1])
        vertex([a[0], a[1], piece.back], [0, 0, -1])
      }
      for (const ring of [contour, ...holes]) {
        for (let index = 0; index < ring.length; index++) {
          const a = ring[index]!
          const b = ring[(index + 1) % ring.length]!
          const dx = b[0] - a[0]
          const dy = b[1] - a[1]
          const length = Math.hypot(dx, dy)
          if (length <= 1e-6) continue
          const normal = [dy / length, -dx / length, 0]
          vertex([a[0], a[1], piece.back], normal)
          vertex([b[0], b[1], piece.back], normal)
          vertex([b[0], b[1], piece.front], normal)
          vertex([a[0], a[1], piece.back], normal)
          vertex([b[0], b[1], piece.front], normal)
          vertex([a[0], a[1], piece.front], normal)
        }
      }
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3))
  ensureRenderableGeometryAttributes(geometry)
  return geometry
}

// Adjacent fragments of one pane share a boundary, not a second glass surface.
export function buildStraightCurtainPieces(
  pieces: readonly CurtainWallPiece[],
  base: number,
  cullSharedFaces = true,
) {
  if (!cullSharedFaces) {
    const valuesPerPiece = 6 * 6 * 3
    const positions = new Float32Array(pieces.length * valuesPerPiece)
    const normals = new Float32Array(pieces.length * valuesPerPiece)
    let offset = 0
    const vertex = (point: readonly number[], normal: readonly number[]) => {
      positions[offset] = point[0]!
      normals[offset++] = normal[0]!
      positions[offset] = point[1]!
      normals[offset++] = normal[1]!
      positions[offset] = point[2]!
      normals[offset++] = normal[2]!
    }
    const quad = (
      a: readonly number[],
      b: readonly number[],
      c: readonly number[],
      d: readonly number[],
      normal: readonly number[],
    ) => {
      vertex(a, normal)
      vertex(b, normal)
      vertex(c, normal)
      vertex(a, normal)
      vertex(c, normal)
      vertex(d, normal)
    }
    for (const piece of pieces) {
      const { left: l, right: r, bottom, top, front: f, back: k } = piece
      const b = bottom + base
      const t = top + base
      quad([l, b, f], [r, b, f], [r, t, f], [l, t, f], [0, 0, 1])
      quad([r, b, k], [l, b, k], [l, t, k], [r, t, k], [0, 0, -1])
      quad([l, b, k], [l, b, f], [l, t, f], [l, t, k], [-1, 0, 0])
      quad([r, b, f], [r, b, k], [r, t, k], [r, t, f], [1, 0, 0])
      quad([l, b, k], [r, b, k], [r, b, f], [l, b, f], [0, -1, 0])
      quad([l, t, f], [r, t, f], [r, t, k], [l, t, k], [0, 1, 0])
    }
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
    geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3))
    ensureRenderableGeometryAttributes(geometry)
    return geometry
  }
  const positions = new Float32Array(pieces.length * 6 * 6 * 3)
  const normals = new Float32Array(positions.length)
  let offset = 0
  const vertex = (point: readonly number[], normal: readonly number[]) => {
    positions[offset] = point[0]!
    normals[offset++] = normal[0]!
    positions[offset] = point[1]!
    normals[offset++] = normal[1]!
    positions[offset] = point[2]!
    normals[offset++] = normal[2]!
  }
  const quad = (a: number[], b: number[], c: number[], d: number[], normal: number[]) => {
    vertex(a, normal)
    vertex(b, normal)
    vertex(c, normal)
    vertex(a, normal)
    vertex(c, normal)
    vertex(d, normal)
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
  geometry.setAttribute('position', new Float32BufferAttribute(positions.subarray(0, offset), 3))
  geometry.setAttribute('normal', new Float32BufferAttribute(normals.subarray(0, offset), 3))
  ensureRenderableGeometryAttributes(geometry)
  return geometry
}
