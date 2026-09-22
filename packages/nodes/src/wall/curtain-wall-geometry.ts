import {
  type AnyNode,
  getCurtainWallConfig,
  getWallCurveFrameAt,
  getWallCurveLength,
  getWallThickness,
  isCurvedWall,
  type WallNode,
} from '@pascal-app/core'
import {
  Brush,
  Evaluator,
  ensureRenderableGeometryAttributes,
  INTERSECTION,
  prepareBrushForCSG,
  SUBTRACTION,
} from '@pascal-app/viewer'
import { BufferGeometry, ExtrudeGeometry, Shape } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { buildCurtainOpeningFrame } from './curtain-opening-frame'
import {
  buildCurtainWallLayout,
  type CurtainWallPiece,
  curtainGridPositions,
} from './curtain-wall-layout'
import { buildStraightCurtainPieces } from './curtain-wall-piece-geometry'

function pieceGeometry(wall: WallNode, piece: CurtainWallPiece, length: number, base: number) {
  const angle = Math.atan2(wall.end[1] - wall.start[1], wall.end[0] - wall.start[0])
  const cos = Math.cos(angle),
    sin = Math.sin(angle)
  const samples = isCurvedWall(wall)
    ? Math.max(1, Math.ceil(((piece.right - piece.left) / length) * 48))
    : 1
  const points: [number, number][] = []
  for (const offset of [piece.front, piece.back]) {
    const side: [number, number][] = []
    for (let i = 0; i <= samples; i++) {
      const along = piece.left + ((piece.right - piece.left) * i) / samples
      if (!isCurvedWall(wall)) {
        side.push([along, -offset])
        continue
      }
      const frame = getWallCurveFrameAt(wall, along / length)
      const x = frame.point.x + frame.normal.x * offset - wall.start[0]
      const z = frame.point.y + frame.normal.y * offset - wall.start[1]
      side.push([x * cos + z * sin, -(-x * sin + z * cos)])
    }
    points.push(...(offset === piece.front ? side : side.reverse()))
  }
  const shape = new Shape()
  shape.moveTo(...points[0]!)
  for (const point of points.slice(1)) shape.lineTo(...point)
  shape.closePath()
  const geometry = new ExtrudeGeometry(shape, {
    depth: piece.top - piece.bottom,
    bevelEnabled: false,
  })
  geometry.rotateX(-Math.PI / 2)
  geometry.translate(0, base + piece.bottom, 0)
  ensureRenderableGeometryAttributes(geometry)
  return geometry
}

export function buildCurtainWallGeometry(
  wall: WallNode,
  envelope: BufferGeometry,
  children: readonly AnyNode[] = [],
): BufferGeometry {
  const length = getWallCurveLength(wall)
  envelope.computeBoundingBox()
  const bounds = envelope.boundingBox
  if (!bounds || bounds.isEmpty() || length <= 1e-6) return envelope
  const pieces = buildCurtainWallLayout(
    length,
    bounds.max.y - bounds.min.y,
    getWallThickness(wall),
    getCurtainWallConfig(wall),
    children.filter((child) => child.type === 'door' || child.type === 'window'),
    bounds.min.y,
  )
  const shapedFrames = children
    .filter(
      (child) =>
        (child.type === 'window' || child.type === 'door') && child.openingShape !== 'rectangle',
    )
    .map((opening) =>
      buildCurtainOpeningFrame(
        opening as Extract<AnyNode, { type: 'door' | 'window' }>,
        getCurtainWallConfig(wall).perimeterWidth,
        getWallThickness(wall),
      ),
    )
  const hasRectangularOpenings = children.some(
    (child) =>
      (child.type === 'window' || child.type === 'door') && child.openingShape === 'rectangle',
  )
  const evaluator = new Evaluator()
  evaluator.attributes = ['position', 'normal', 'uv', 'uv2']
  evaluator.useGroups = false
  const shell = new Brush(envelope)
  const position = envelope.getAttribute('position')
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-6
  const halfDepth = getWallThickness(wall) / 2
  const rectangular =
    !isCurvedWall(wall) &&
    Array.from({ length: position.count }, (_, i) => i).every(
      (i) =>
        (near(position.getX(i), 0) || near(position.getX(i), length)) &&
        (near(position.getY(i), bounds.min.y) || near(position.getY(i), bounds.max.y)) &&
        (near(position.getZ(i), -halfDepth) || near(position.getZ(i), halfDepth)),
    )
  if (rectangular) {
    for (const { frame } of shapedFrames) {
      const framePosition = frame.getAttribute('position')
      for (let index = 0; index < framePosition.count; index++) {
        framePosition.setX(
          index,
          Math.max(bounds.min.x, Math.min(bounds.max.x, framePosition.getX(index))),
        )
        framePosition.setY(
          index,
          Math.max(bounds.min.y, Math.min(bounds.max.y, framePosition.getY(index))),
        )
      }
      framePosition.needsUpdate = true
      frame.computeVertexNormals()
    }
  }
  if (!rectangular) prepareBrushForCSG(shell)
  const leftEnvelopeXs: number[] = []
  const rightEnvelopeXs: number[] = []
  if (!rectangular && !isCurvedWall(wall)) {
    for (let index = 0; index < position.count; index++) {
      const x = position.getX(index)
      ;(x < length / 2 ? leftEnvelopeXs : rightEnvelopeXs).push(x)
    }
  }
  const safeLeft = leftEnvelopeXs.length ? Math.max(...leftEnvelopeXs) : 0
  const safeRight = rightEnvelopeXs.length ? Math.min(...rightEnvelopeXs) : length
  const xs = curtainGridPositions(length, getCurtainWallConfig(wall).columns)
  const ys = curtainGridPositions(bounds.max.y - bounds.min.y, getCurtainWallConfig(wall).rows)
  const cutRegions = shapedFrames.map(({ cutter }) => {
    cutter.computeBoundingBox()
    const box = cutter.boundingBox!
    // Keep every fragment of a pane in the same partition to avoid new glass seams.
    const lower = (positions: number[], value: number) =>
      [...positions].reverse().find((p) => p <= value) ?? positions[0]!
    const upper = (positions: number[], value: number) =>
      positions.find((p) => p >= value) ?? positions.at(-1)!
    return {
      left: lower(xs, box.min.x),
      right: upper(xs, box.max.x),
      bottom: lower(ys, box.min.y - bounds.min.y),
      top: upper(ys, box.max.y - bounds.min.y),
    }
  })
  const results: BufferGeometry[] = []
  const roles = ['frame', 'glass', 'solid'] as const
  try {
    for (const [materialIndex, role] of roles.entries()) {
      const allRolePieces = pieces.filter((piece) => piece.role === role)
      const nearCut = (piece: CurtainWallPiece) =>
        isCurvedWall(wall) ||
        (!rectangular && (piece.left < safeLeft - 1e-6 || piece.right > safeRight + 1e-6)) ||
        cutRegions.some(
          (region) =>
            piece.left < region.right &&
            piece.right > region.left &&
            piece.bottom < region.top &&
            piece.top > region.bottom,
        )
      const partitionPieces = !rectangular || cutRegions.length > 0
      const rolePieces = allRolePieces.filter(nearCut)
      const untouchedPieces = partitionPieces
        ? allRolePieces.filter((piece) => !nearCut(piece))
        : []
      const builtPieces = partitionPieces ? rolePieces : allRolePieces
      if (!allRolePieces.length && !(role === 'frame' && shapedFrames.length)) continue
      let merged: BufferGeometry | null = null
      if (!isCurvedWall(wall) && builtPieces.length) {
        merged = buildStraightCurtainPieces(
          builtPieces.map((piece) => ({
            ...piece,
            left: piece.left === 0 ? Math.min(0, bounds.min.x) : piece.left,
            right: piece.right === length ? Math.max(length, bounds.max.x) : piece.right,
          })),
          bounds.min.y,
          hasRectangularOpenings || shapedFrames.length > 0,
        )
      } else if (builtPieces.length) {
        const sources = rolePieces.map((piece) => pieceGeometry(wall, piece, length, bounds.min.y))
        merged = mergeGeometries(sources, false)
        for (const source of sources) source.dispose()
      }
      if (merged) {
        for (const opening of shapedFrames) {
          if (!merged.getAttribute('position').count) break
          const brush: Brush = new Brush(merged)
          const cutter = new Brush(opening.cutter)
          prepareBrushForCSG(brush)
          prepareBrushForCSG(cutter)
          const cut: BufferGeometry = evaluator.evaluate(brush, cutter, SUBTRACTION).geometry
          merged.dispose()
          merged = cut.index ? cut.toNonIndexed() : cut
          if (merged !== cut) cut.dispose()
        }
      }
      if (role === 'frame' && shapedFrames.length) {
        const frames = shapedFrames.map(({ frame }) => frame)
        const combined = mergeGeometries(merged ? [merged, ...frames] : frames, false)
        merged?.dispose()
        if (!combined) continue
        merged = combined
      }
      if (merged && !rectangular) {
        const brush = new Brush(merged)
        prepareBrushForCSG(brush)
        try {
          // The existing wall envelope owns miter joins, support profiles, and all hosted cuts.
          const clipped = evaluator.evaluate(brush, shell, INTERSECTION).geometry
          const geometry = clipped.index ? clipped.toNonIndexed() : clipped
          if (geometry !== clipped) clipped.dispose()
          merged.dispose()
          merged = geometry
        } catch (error) {
          merged.dispose()
          throw error
        }
      }
      if (untouchedPieces.length) {
        const untouched = buildStraightCurtainPieces(untouchedPieces, bounds.min.y, false)
        if (merged) {
          const combined = mergeGeometries([merged, untouched], false)
          untouched.dispose()
          merged.dispose()
          if (!combined) continue
          merged = combined
        } else {
          merged = untouched
        }
      }
      if (!merged) continue
      merged.clearGroups()
      merged.addGroup(0, merged.getAttribute('position').count, materialIndex)
      results.push(merged)
    }
    if (!results.length) return new BufferGeometry()
    const combined = mergeGeometries(results, false) ?? new BufferGeometry()
    let start = 0
    for (const result of results) {
      const count = result.getAttribute('position').count
      combined.addGroup(start, count, result.groups[0]!.materialIndex)
      start += count
    }
    return combined
  } finally {
    for (const opening of shapedFrames) {
      opening.frame.dispose()
      opening.cutter.dispose()
    }
    envelope.dispose()
    for (const result of results) result.dispose()
  }
}
