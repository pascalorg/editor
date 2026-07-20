import type { FloorplanGeometry, FloorplanPoint } from '@pascal-app/core'
import { resolveFloorplanLabelAngle } from './floorplan-label-angle'

const EXTENSION_START_GAP = 0.075
const TICK_HALF_LENGTH = 0.09
const LABEL_FONT_SIZE = 0.15
const LABEL_BASELINE_OFFSET = 0.12
const LABEL_CHARACTER_WIDTH_RATIO = 0.62
const LABEL_END_GAP = 0.075
const DOCUMENT_EXTENSION_START_GAP_PT = 3
const DOCUMENT_EXTENSION_OVERSHOOT_PT = 4
const DOCUMENT_TICK_HALF_LENGTH_PT = 4.5
const DOCUMENT_LABEL_FONT_SIZE_PT = 8
const DOCUMENT_LABEL_BASELINE_OFFSET_PT = 5
const DOCUMENT_LABEL_END_GAP_PT = 3
const LINE_STROKE_WIDTH_PX = 0.9
const TICK_STROKE_WIDTH_PX = 1.35
const SQRT_ONE_HALF = Math.SQRT1_2

type DimensionGeometry = Extract<FloorplanGeometry, { kind: 'dimension' }>

export type ArchitecturalDimensionLayout = {
  dimensionStart: FloorplanPoint
  dimensionEnd: FloorplanPoint
  dimensionLineEnd: FloorplanPoint
  extensionStart: FloorplanPoint
  extensionEnd: FloorplanPoint
  extensionStartTip: FloorplanPoint
  extensionEndTip: FloorplanPoint
  tickHalfVector: FloorplanPoint
  labelPoint: FloorplanPoint
  labelAngleDeg: number
  labelPlacement: 'inside' | 'outside-end'
}

export function computeArchitecturalDimensionLayout(
  geometry: DimensionGeometry,
  sceneRotationDeg: number,
  annotationUnitsPerPoint?: number,
): ArchitecturalDimensionLayout | null {
  const extensionStartGap = annotationUnitsPerPoint
    ? DOCUMENT_EXTENSION_START_GAP_PT * annotationUnitsPerPoint
    : EXTENSION_START_GAP
  const extensionOvershoot = annotationUnitsPerPoint
    ? DOCUMENT_EXTENSION_OVERSHOOT_PT * annotationUnitsPerPoint
    : geometry.extensionOvershoot
  const tickHalfLength = annotationUnitsPerPoint
    ? DOCUMENT_TICK_HALF_LENGTH_PT * annotationUnitsPerPoint
    : TICK_HALF_LENGTH
  const labelFontSize = annotationUnitsPerPoint
    ? DOCUMENT_LABEL_FONT_SIZE_PT * annotationUnitsPerPoint
    : LABEL_FONT_SIZE
  const labelEndGap = annotationUnitsPerPoint
    ? DOCUMENT_LABEL_END_GAP_PT * annotationUnitsPerPoint
    : LABEL_END_GAP
  const offsetX = geometry.offsetNormal[0] * geometry.offsetDistance
  const offsetY = geometry.offsetNormal[1] * geometry.offsetDistance
  const dimensionStart: FloorplanPoint = geometry.dimensionStart ?? [
    geometry.start[0] + offsetX,
    geometry.start[1] + offsetY,
  ]
  const dimensionEnd: FloorplanPoint = geometry.dimensionEnd ?? [
    geometry.end[0] + offsetX,
    geometry.end[1] + offsetY,
  ]
  const dx = dimensionEnd[0] - dimensionStart[0]
  const dy = dimensionEnd[1] - dimensionStart[1]
  const length = Math.hypot(dx, dy)
  if (length < 1e-6) return null

  const dirX = dx / length
  const dirY = dy / length
  const startOffsetDistance = dot(subtract(dimensionStart, geometry.start), geometry.offsetNormal)
  const endOffsetDistance = dot(subtract(dimensionEnd, geometry.end), geometry.offsetNormal)
  const startExtensionGap = Math.min(extensionStartGap, Math.max(0, startOffsetDistance - 0.01))
  const endExtensionGap = Math.min(extensionStartGap, Math.max(0, endOffsetDistance - 0.01))

  // A 45-degree architectural slash. Every terminator within one string uses
  // this same vector instead of rotating independently around its endpoint.
  const tickHalfVector: FloorplanPoint = [
    (dirX + dirY) * tickHalfLength * SQRT_ONE_HALF,
    (dirY - dirX) * tickHalfLength * SQRT_ONE_HALF,
  ]
  const labelWidth = Math.max(
    labelFontSize,
    geometry.text.length * labelFontSize * LABEL_CHARACTER_WIDTH_RATIO,
  )
  const labelPlacement =
    length >= labelWidth + labelEndGap * 2 ? ('inside' as const) : ('outside-end' as const)
  const direction: FloorplanPoint = [dirX, dirY]
  const labelPoint =
    labelPlacement === 'inside'
      ? ([
          (dimensionStart[0] + dimensionEnd[0]) / 2,
          (dimensionStart[1] + dimensionEnd[1]) / 2,
        ] as FloorplanPoint)
      : addScaled(dimensionEnd, direction, labelEndGap + labelWidth / 2)
  const dimensionLineEnd =
    labelPlacement === 'inside'
      ? dimensionEnd
      : addScaled(dimensionEnd, direction, labelEndGap * 2 + labelWidth)

  return {
    dimensionStart,
    dimensionEnd,
    dimensionLineEnd,
    extensionStart: addScaled(geometry.start, geometry.offsetNormal, startExtensionGap),
    extensionEnd: addScaled(geometry.end, geometry.offsetNormal, endExtensionGap),
    extensionStartTip: addScaled(dimensionStart, geometry.offsetNormal, extensionOvershoot),
    extensionEndTip: addScaled(dimensionEnd, geometry.offsetNormal, extensionOvershoot),
    tickHalfVector,
    labelPoint,
    labelAngleDeg: resolveFloorplanLabelAngle(Math.atan2(dy, dx), sceneRotationDeg),
    labelPlacement,
  }
}

function subtract(left: FloorplanPoint, right: FloorplanPoint): FloorplanPoint {
  return [left[0] - right[0], left[1] - right[1]]
}

function dot(left: FloorplanPoint, right: FloorplanPoint): number {
  return left[0] * right[0] + left[1] * right[1]
}

function addScaled(
  point: FloorplanPoint,
  direction: FloorplanPoint,
  distance: number,
): FloorplanPoint {
  return [point[0] + direction[0] * distance, point[1] + direction[1] * distance]
}

export function FloorplanDimensionRenderer({
  geometry,
  sceneRotationDeg = 0,
  stroke = geometry.stroke ?? '#334155',
  annotationUnitsPerPoint,
}: {
  geometry: DimensionGeometry
  sceneRotationDeg?: number
  stroke?: string
  annotationUnitsPerPoint?: number
}): React.ReactElement | null {
  const layout = computeArchitecturalDimensionLayout(
    geometry,
    sceneRotationDeg,
    annotationUnitsPerPoint,
  )
  if (!layout) return null

  const labelFontSize = annotationUnitsPerPoint
    ? DOCUMENT_LABEL_FONT_SIZE_PT * annotationUnitsPerPoint
    : LABEL_FONT_SIZE
  const labelBaselineOffset = annotationUnitsPerPoint
    ? DOCUMENT_LABEL_BASELINE_OFFSET_PT * annotationUnitsPerPoint
    : LABEL_BASELINE_OFFSET

  const lineProps = {
    stroke,
    strokeLinecap: 'butt' as const,
    strokeWidth: LINE_STROKE_WIDTH_PX,
    vectorEffect: 'non-scaling-stroke' as const,
  }
  const [tickX, tickY] = layout.tickHalfVector
  const labelTransform = `translate(${layout.labelPoint[0]} ${layout.labelPoint[1]}) rotate(${layout.labelAngleDeg})`

  return (
    <g pointerEvents="none">
      <line
        {...lineProps}
        x1={layout.extensionStart[0]}
        x2={layout.extensionStartTip[0]}
        y1={layout.extensionStart[1]}
        y2={layout.extensionStartTip[1]}
      />
      <line
        {...lineProps}
        x1={layout.extensionEnd[0]}
        x2={layout.extensionEndTip[0]}
        y1={layout.extensionEnd[1]}
        y2={layout.extensionEndTip[1]}
      />
      <line
        {...lineProps}
        x1={layout.dimensionStart[0]}
        x2={layout.dimensionLineEnd[0]}
        y1={layout.dimensionStart[1]}
        y2={layout.dimensionLineEnd[1]}
      />
      <line
        {...lineProps}
        strokeWidth={TICK_STROKE_WIDTH_PX}
        x1={layout.dimensionStart[0] - tickX}
        x2={layout.dimensionStart[0] + tickX}
        y1={layout.dimensionStart[1] - tickY}
        y2={layout.dimensionStart[1] + tickY}
      />
      <line
        {...lineProps}
        strokeWidth={TICK_STROKE_WIDTH_PX}
        x1={layout.dimensionEnd[0] - tickX}
        x2={layout.dimensionEnd[0] + tickX}
        y1={layout.dimensionEnd[1] - tickY}
        y2={layout.dimensionEnd[1] + tickY}
      />
      <g
        data-floorplan-annotation-default-transform={labelTransform}
        data-floorplan-annotation-label=""
        data-floorplan-annotation-priority="100"
        data-floorplan-dimension-label-placement={layout.labelPlacement}
        transform={labelTransform}
      >
        <text
          fill={stroke}
          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
          fontSize={labelFontSize}
          fontWeight={500}
          paintOrder="stroke"
          stroke="#ffffff"
          strokeLinejoin="round"
          strokeWidth={3}
          textAnchor="middle"
          vectorEffect="non-scaling-stroke"
          x={0}
          y={-labelBaselineOffset}
        >
          {geometry.text}
        </text>
      </g>
    </g>
  )
}
