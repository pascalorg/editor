import type { ConstructionNoteNode, FloorplanPoint } from '@pascal-app/core'

const TEXT_GAP = 0.1
const MIN_CONTROL_FRACTION = 0.1
const MAX_CONTROL_FRACTION = 0.9

type ConstructionNoteLeaderInput = Pick<
  ConstructionNoteNode,
  'textPosition' | 'shoulderLength' | 'curveControl'
>

export type ResolvedConstructionNoteLeader = {
  side: 1 | -1
  shoulderEnd: FloorplanPoint
  elbow: FloorplanPoint
  curveHandlePoint: FloorplanPoint
  quadraticControlPoint: FloorplanPoint
}

export function resolveConstructionNoteLeader(
  note: ConstructionNoteLeaderInput,
  anchor: FloorplanPoint,
): ResolvedConstructionNoteLeader {
  const side = note.textPosition[0] >= anchor[0] ? 1 : -1
  const shoulderEnd: FloorplanPoint = [note.textPosition[0] - side * TEXT_GAP, note.textPosition[1]]
  const elbow: FloorplanPoint = [shoulderEnd[0] - side * note.shoulderLength, shoulderEnd[1]]
  const curveHandlePoint = constructionNoteCurveHandlePoint(anchor, elbow, note.curveControl)
  return {
    side,
    shoulderEnd,
    elbow,
    curveHandlePoint,
    quadraticControlPoint: quadraticControlPoint(
      anchor,
      elbow,
      curveHandlePoint,
      note.curveControl[0],
    ),
  }
}

export function constructionNoteCurveHandlePoint(
  anchor: FloorplanPoint,
  elbow: FloorplanPoint,
  curveControl: ConstructionNoteNode['curveControl'],
): FloorplanPoint {
  const frame = chordFrame(anchor, elbow)
  if (!frame) return anchor
  return [
    anchor[0] + frame.dirX * frame.length * curveControl[0] + frame.normalX * curveControl[1],
    anchor[1] + frame.dirY * frame.length * curveControl[0] + frame.normalY * curveControl[1],
  ]
}

function quadraticControlPoint(
  anchor: FloorplanPoint,
  elbow: FloorplanPoint,
  curveHandlePoint: FloorplanPoint,
  fraction: number,
): FloorplanPoint {
  const inverse = 1 - fraction
  const weight = 2 * inverse * fraction
  return [
    (curveHandlePoint[0] - inverse * inverse * anchor[0] - fraction * fraction * elbow[0]) / weight,
    (curveHandlePoint[1] - inverse * inverse * anchor[1] - fraction * fraction * elbow[1]) / weight,
  ]
}

export function constructionNoteCurveControlFromPoint(
  anchor: FloorplanPoint,
  elbow: FloorplanPoint,
  point: FloorplanPoint,
): [number, number] {
  const frame = chordFrame(anchor, elbow)
  if (!frame) return [0.5, 0]
  const dx = point[0] - anchor[0]
  const dy = point[1] - anchor[1]
  const fraction = clamp(
    (dx * frame.dirX + dy * frame.dirY) / frame.length,
    MIN_CONTROL_FRACTION,
    MAX_CONTROL_FRACTION,
  )
  const perpendicularOffset = dx * frame.normalX + dy * frame.normalY
  return [fraction, perpendicularOffset]
}

function chordFrame(anchor: FloorplanPoint, elbow: FloorplanPoint) {
  const dx = elbow[0] - anchor[0]
  const dy = elbow[1] - anchor[1]
  const length = Math.hypot(dx, dy)
  if (length < 1e-9) return null
  const dirX = dx / length
  const dirY = dy / length
  return { length, dirX, dirY, normalX: -dirY, normalY: dirX }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
