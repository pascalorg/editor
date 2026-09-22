import {
  type AnyNode,
  type FloorplanGeometry,
  getCurtainWallConfig,
  getWallCurveFrameAt,
  getWallCurveLength,
  getWallThickness,
  type WallNode,
} from '@pascal-app/core'
import { curtainOpeningProfile, curtainProfileSpan } from './curtain-opening-frame'
import { buildCurtainWallLayout, type CurtainWallPiece } from './curtain-wall-layout'

export function buildCurtainWallFloorplan(
  wall: WallNode,
  height: number,
  stroke: string,
  children: readonly AnyNode[] = [],
): FloorplanGeometry[] {
  const length = getWallCurveLength(wall)
  if (length <= 1e-6) return []
  const config = getCurtainWallConfig(wall)
  const cutHeight = Math.min(1.2, height * 0.5)
  const openings = children
    .filter((child) => child.type === 'door' || child.type === 'window')
    .map((opening) => ({
      opening,
      profile: curtainOpeningProfile(opening, config.perimeterWidth),
      framed: opening.openingShape !== 'rectangle',
    }))
  const pieces = buildCurtainWallLayout(
    length,
    height,
    getWallThickness(wall),
    config,
    children.filter((child) => child.type === 'door' || child.type === 'window'),
  )
    .filter((piece) => piece.bottom <= cutHeight && piece.top > cutHeight)
    .flatMap((piece) => {
      let runs = [piece]
      for (const { profile, framed } of openings) {
        const span = curtainProfileSpan(framed ? profile.outer : profile.inner, cutHeight)
        if (!span) continue
        const [left, right] = span
        runs = runs.flatMap((run) => {
          if (right <= run.left || left >= run.right) return [run]
          return [
            ...(left > run.left ? [{ ...run, right: left }] : []),
            ...(right < run.right ? [{ ...run, left: right }] : []),
          ]
        })
      }
      return runs
    })
  for (const { profile, framed } of openings) {
    if (!framed) continue
    const outer = curtainProfileSpan(profile.outer, cutHeight)
    const inner = curtainProfileSpan(profile.inner, cutHeight)
    if (!outer) continue
    const spans = inner
      ? [
          [outer[0], inner[0]],
          [inner[1], outer[1]],
        ]
      : [outer]
    for (const [left, right] of spans) {
      if (right! - left! <= 1e-6) continue
      pieces.push({
        left: Math.max(0, left!),
        right: Math.min(length, right!),
        bottom: 0,
        top: height,
        front: getWallThickness(wall) / 2,
        back: -getWallThickness(wall) / 2,
        role: 'frame',
      } satisfies CurtainWallPiece)
    }
  }
  return pieces.map((piece): FloorplanGeometry => {
    const points: [number, number][] = []
    for (const offset of [piece.front, piece.back]) {
      const side: [number, number][] = []
      for (let i = 0; i <= 8; i++) {
        const along = piece.left + ((piece.right - piece.left) * i) / 8
        const frame = getWallCurveFrameAt(wall, along / length)
        side.push([
          frame.point.x + frame.normal.x * offset,
          frame.point.y + frame.normal.y * offset,
        ])
      }
      points.push(...(offset === piece.front ? side : side.reverse()))
    }
    return {
      kind: 'polygon',
      points,
      fill:
        piece.role === 'glass'
          ? config.glassColor
          : piece.role === 'frame'
            ? config.frameColor
            : config.solidColor,
      stroke,
      strokeWidth: 0.008,
      pointerEvents: 'none',
    }
  })
}
