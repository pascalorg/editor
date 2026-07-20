import type { FloorplanGeometry, FloorplanPoint } from '@pascal-app/core'
import { resolveFloorplanLabelAngle } from './floorplan-label-angle'

const EXTENSION_START_GAP = 0.075
const TICK_HALF_LENGTH = 0.09
const LABEL_FONT_SIZE = 0.15
const LABEL_BASELINE_OFFSET = 0.12
const LINE_STROKE_WIDTH_PX = 0.9
const TICK_STROKE_WIDTH_PX = 1.35
const SQRT_ONE_HALF = Math.SQRT1_2

type DimensionGeometry = Extract<FloorplanGeometry, { kind: 'dimension' }>

export type ArchitecturalDimensionLayout = {
  dimensionStart: FloorplanPoint
  dimensionEnd: FloorplanPoint
  extensionStart: FloorplanPoint
  extensionEnd: FloorplanPoint
  extensionStartTip: FloorplanPoint
  extensionEndTip: FloorplanPoint
  tickHalfVector: FloorplanPoint
  labelPoint: FloorplanPoint
  labelAngleDeg: number
}

export function computeArchitecturalDimensionLayout(
  geometry: DimensionGeometry,
  sceneRotationDeg: number,
): ArchitecturalDimensionLayout | null {
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
  const startExtensionGap = Math.min(EXTENSION_START_GAP, Math.max(0, startOffsetDistance - 0.01))
  const endExtensionGap = Math.min(EXTENSION_START_GAP, Math.max(0, endOffsetDistance - 0.01))

  // A 45-degree architectural slash. Every terminator within one string uses
  // this same vector instead of rotating independently around its endpoint.
  const tickHalfVector: FloorplanPoint = [
    (dirX + dirY) * TICK_HALF_LENGTH * SQRT_ONE_HALF,
    (dirY - dirX) * TICK_HALF_LENGTH * SQRT_ONE_HALF,
  ]

  return {
    dimensionStart,
    dimensionEnd,
    extensionStart: addScaled(geometry.start, geometry.offsetNormal, startExtensionGap),
    extensionEnd: addScaled(geometry.end, geometry.offsetNormal, endExtensionGap),
    extensionStartTip: addScaled(
      dimensionStart,
      geometry.offsetNormal,
      geometry.extensionOvershoot,
    ),
    extensionEndTip: addScaled(dimensionEnd, geometry.offsetNormal, geometry.extensionOvershoot),
    tickHalfVector,
    labelPoint: [
      (dimensionStart[0] + dimensionEnd[0]) / 2,
      (dimensionStart[1] + dimensionEnd[1]) / 2,
    ],
    labelAngleDeg: resolveFloorplanLabelAngle(Math.atan2(dy, dx), sceneRotationDeg),
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
}: {
  geometry: DimensionGeometry
  sceneRotationDeg?: number
  stroke?: string
}): React.ReactElement | null {
  const layout = computeArchitecturalDimensionLayout(geometry, sceneRotationDeg)
  if (!layout) return null

  const lineProps = {
    stroke,
    strokeLinecap: 'butt' as const,
    strokeWidth: LINE_STROKE_WIDTH_PX,
    vectorEffect: 'non-scaling-stroke' as const,
  }
  const [tickX, tickY] = layout.tickHalfVector

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
        x2={layout.dimensionEnd[0]}
        y1={layout.dimensionStart[1]}
        y2={layout.dimensionEnd[1]}
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
        transform={`translate(${layout.labelPoint[0]} ${layout.labelPoint[1]}) rotate(${layout.labelAngleDeg})`}
      >
        <text
          fill={stroke}
          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
          fontSize={LABEL_FONT_SIZE}
          fontWeight={500}
          textAnchor="middle"
          x={0}
          y={-LABEL_BASELINE_OFFSET}
        >
          {geometry.text}
        </text>
      </g>
    </g>
  )
}
