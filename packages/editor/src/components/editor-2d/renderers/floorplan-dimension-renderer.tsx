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
const PDF_LINE_STROKE_WIDTH_PT = 0.5
const PDF_TICK_STROKE_WIDTH_PT = 0.75
const SQRT_ONE_HALF = Math.SQRT1_2

type FloorplanDimensionRenderMode = 'screen' | 'pdf'

type DimensionGeometry = Extract<FloorplanGeometry, { kind: 'dimension' }>
type DimensionStringGeometry = Extract<FloorplanGeometry, { kind: 'dimension-string' }>
type DimensionTerminator = NonNullable<DimensionGeometry['terminator']>

export type ArchitecturalDimensionLayout = {
  dimensionStart: FloorplanPoint
  dimensionEnd: FloorplanPoint
  dimensionLineStart: FloorplanPoint
  dimensionLineEnd: FloorplanPoint
  extensionStart: FloorplanPoint
  extensionEnd: FloorplanPoint
  extensionStartTip: FloorplanPoint
  extensionEndTip: FloorplanPoint
  tickHalfVector: FloorplanPoint
  labelPoint: FloorplanPoint
  labelAngleDeg: number
  labelPlacement: 'inside' | 'outside-end'
  outsideStartLabelPoint?: FloorplanPoint
  outsideStartDimensionLineStart?: FloorplanPoint
}

export function floorplanDimensionAnnotationPriority(offsetDistance: number): number {
  return 100 + Math.round(Math.abs(offsetDistance) * 100)
}

export function computeArchitecturalDimensionLayout(
  geometry: DimensionGeometry,
  sceneRotationDeg: number,
  annotationUnitsPerPoint?: number,
): ArchitecturalDimensionLayout | null {
  const extensionStartGap = annotationUnitsPerPoint
    ? DOCUMENT_EXTENSION_START_GAP_PT * annotationUnitsPerPoint
    : (geometry.extensionStartGap ?? EXTENSION_START_GAP)
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
  const outsideStartLabelPoint =
    labelPlacement === 'outside-end'
      ? addScaled(dimensionStart, direction, -(labelEndGap + labelWidth / 2))
      : undefined
  const outsideStartDimensionLineStart =
    labelPlacement === 'outside-end'
      ? addScaled(dimensionStart, direction, -(labelEndGap * 2 + labelWidth))
      : undefined

  return {
    dimensionStart,
    dimensionEnd,
    dimensionLineStart: dimensionStart,
    dimensionLineEnd,
    extensionStart: addScaled(geometry.start, geometry.offsetNormal, startExtensionGap),
    extensionEnd: addScaled(geometry.end, geometry.offsetNormal, endExtensionGap),
    extensionStartTip: addScaled(dimensionStart, geometry.offsetNormal, extensionOvershoot),
    extensionEndTip: addScaled(dimensionEnd, geometry.offsetNormal, extensionOvershoot),
    tickHalfVector,
    labelPoint,
    labelAngleDeg: resolveFloorplanLabelAngle(Math.atan2(dy, dx), sceneRotationDeg),
    labelPlacement,
    outsideStartLabelPoint,
    outsideStartDimensionLineStart,
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
  renderMode = 'screen',
}: {
  geometry: DimensionGeometry
  sceneRotationDeg?: number
  stroke?: string
  annotationUnitsPerPoint?: number
  renderMode?: FloorplanDimensionRenderMode
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
  const labelY = geometry.textPosition === 'centered' ? labelFontSize * 0.35 : -labelBaselineOffset

  const lineProps = {
    stroke,
    strokeLinecap: 'butt' as const,
    strokeWidth: renderMode === 'pdf' ? PDF_LINE_STROKE_WIDTH_PT : LINE_STROKE_WIDTH_PX,
    vectorEffect: 'non-scaling-stroke' as const,
  }
  const tickStrokeWidth = renderMode === 'pdf' ? PDF_TICK_STROKE_WIDTH_PT : TICK_STROKE_WIDTH_PX
  const terminator = geometry.terminator ?? 'architectural-tick'
  const labelTransform = `translate(${layout.labelPoint[0]} ${layout.labelPoint[1]}) rotate(${layout.labelAngleDeg})`
  const outsideStartLocalShift = layout.outsideStartLabelPoint
    ? rotateVector(
        subtract(layout.outsideStartLabelPoint, layout.labelPoint),
        (-layout.labelAngleDeg * Math.PI) / 180,
      )
    : undefined

  return (
    <g data-floorplan-dimension="" pointerEvents="none">
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
        data-floorplan-dimension-default-x1={layout.dimensionLineStart[0]}
        data-floorplan-dimension-default-x2={layout.dimensionLineEnd[0]}
        data-floorplan-dimension-default-y1={layout.dimensionLineStart[1]}
        data-floorplan-dimension-default-y2={layout.dimensionLineEnd[1]}
        data-floorplan-dimension-line=""
        data-floorplan-dimension-outside-start-x1={layout.outsideStartDimensionLineStart?.[0]}
        data-floorplan-dimension-outside-start-x2={layout.dimensionEnd[0]}
        data-floorplan-dimension-outside-start-y1={layout.outsideStartDimensionLineStart?.[1]}
        data-floorplan-dimension-outside-start-y2={layout.dimensionEnd[1]}
        x1={layout.dimensionLineStart[0]}
        x2={layout.dimensionLineEnd[0]}
        y1={layout.dimensionLineStart[1]}
        y2={layout.dimensionLineEnd[1]}
      />
      {renderTerminator(
        terminator,
        layout.dimensionStart,
        layout.dimensionEnd,
        layout,
        lineProps,
        tickStrokeWidth,
      )}
      {renderTerminator(
        terminator,
        layout.dimensionEnd,
        layout.dimensionStart,
        layout,
        lineProps,
        tickStrokeWidth,
      )}
      {layout.labelPlacement === 'outside-end' && annotationUnitsPerPoint !== undefined ? (
        <line
          {...lineProps}
          data-floorplan-dimension-leader=""
          visibility="hidden"
          x1={layout.dimensionEnd[0]}
          x2={layout.labelPoint[0]}
          y1={layout.dimensionEnd[1]}
          y2={layout.labelPoint[1]}
        />
      ) : null}
      <g
        data-floorplan-annotation-default-transform={labelTransform}
        data-floorplan-annotation-label=""
        data-floorplan-annotation-priority={floorplanDimensionAnnotationPriority(
          geometry.offsetDistance,
        )}
        data-floorplan-dimension-label-placement={layout.labelPlacement}
        data-floorplan-dimension-outside-start-local-x={outsideStartLocalShift?.[0]}
        data-floorplan-dimension-outside-start-local-y={outsideStartLocalShift?.[1]}
        data-floorplan-dimension-start-x={layout.dimensionStart[0]}
        data-floorplan-dimension-start-y={layout.dimensionStart[1]}
        data-floorplan-dimension-end-x={layout.dimensionEnd[0]}
        data-floorplan-dimension-end-y={layout.dimensionEnd[1]}
        transform={labelTransform}
      >
        <DimensionLabel
          fontSize={labelFontSize}
          renderMode={renderMode}
          stroke={stroke}
          text={geometry.text}
          y={labelY}
        />
      </g>
    </g>
  )
}

export function FloorplanDimensionStringRenderer({
  geometry,
  sceneRotationDeg = 0,
  stroke = geometry.stroke ?? '#334155',
  annotationUnitsPerPoint,
  renderMode = 'screen',
}: {
  geometry: DimensionStringGeometry
  sceneRotationDeg?: number
  stroke?: string
  annotationUnitsPerPoint?: number
  renderMode?: FloorplanDimensionRenderMode
}): React.ReactElement | null {
  const segmentLayouts = geometry.segments.flatMap((segment, index) => {
    const segmentGeometry: DimensionGeometry = {
      kind: 'dimension',
      start: segment.start,
      end: segment.end,
      dimensionStart: segment.dimensionStart,
      dimensionEnd: segment.dimensionEnd,
      offsetNormal: geometry.offsetNormal,
      offsetDistance: geometry.offsetDistance,
      extensionOvershoot: geometry.extensionOvershoot,
      extensionStartGap: geometry.extensionStartGap,
      terminator: geometry.terminator,
      textPosition: geometry.textPosition,
      text: segment.text,
      stroke: geometry.stroke,
    }
    const layout = computeArchitecturalDimensionLayout(
      segmentGeometry,
      sceneRotationDeg,
      annotationUnitsPerPoint,
    )
    return layout ? [{ index, layout, segment: segmentGeometry }] : []
  })
  if (segmentLayouts.length === 0) return null

  const labelFontSize = annotationUnitsPerPoint
    ? DOCUMENT_LABEL_FONT_SIZE_PT * annotationUnitsPerPoint
    : LABEL_FONT_SIZE
  const labelBaselineOffset = annotationUnitsPerPoint
    ? DOCUMENT_LABEL_BASELINE_OFFSET_PT * annotationUnitsPerPoint
    : LABEL_BASELINE_OFFSET
  const labelY = geometry.textPosition === 'centered' ? labelFontSize * 0.35 : -labelBaselineOffset
  const lineProps = {
    stroke,
    strokeLinecap: 'butt' as const,
    strokeWidth: renderMode === 'pdf' ? PDF_LINE_STROKE_WIDTH_PT : LINE_STROKE_WIDTH_PX,
    vectorEffect: 'non-scaling-stroke' as const,
  }
  const tickStrokeWidth = renderMode === 'pdf' ? PDF_TICK_STROKE_WIDTH_PT : TICK_STROKE_WIDTH_PX

  const extensionLines = new Map<string, { start: FloorplanPoint; tip: FloorplanPoint }>()
  const ticks = new Map<
    string,
    { point: FloorplanPoint; toward: FloorplanPoint; tickHalfVector: FloorplanPoint }
  >()
  for (const { layout } of segmentLayouts) {
    extensionLines.set(pointKey(layout.dimensionStart), {
      start: layout.extensionStart,
      tip: layout.extensionStartTip,
    })
    extensionLines.set(pointKey(layout.dimensionEnd), {
      start: layout.extensionEnd,
      tip: layout.extensionEndTip,
    })
    ticks.set(pointKey(layout.dimensionStart), {
      point: layout.dimensionStart,
      toward: layout.dimensionEnd,
      tickHalfVector: layout.tickHalfVector,
    })
    ticks.set(pointKey(layout.dimensionEnd), {
      point: layout.dimensionEnd,
      toward: layout.dimensionStart,
      tickHalfVector: layout.tickHalfVector,
    })
  }
  const terminator = geometry.terminator ?? 'architectural-tick'

  return (
    <g data-floorplan-dimension-string="" pointerEvents="none">
      {[...extensionLines.values()].map((line, index) => (
        <line
          {...lineProps}
          key={`extension-${index}`}
          x1={line.start[0]}
          x2={line.tip[0]}
          y1={line.start[1]}
          y2={line.tip[1]}
        />
      ))}
      {segmentLayouts.map(({ index, layout }) => (
        <line
          {...lineProps}
          data-floorplan-dimension-default-x1={layout.dimensionLineStart[0]}
          data-floorplan-dimension-default-x2={layout.dimensionLineEnd[0]}
          data-floorplan-dimension-default-y1={layout.dimensionLineStart[1]}
          data-floorplan-dimension-default-y2={layout.dimensionLineEnd[1]}
          data-floorplan-dimension-line=""
          data-floorplan-dimension-outside-start-x1={layout.outsideStartDimensionLineStart?.[0]}
          data-floorplan-dimension-outside-start-x2={layout.dimensionEnd[0]}
          data-floorplan-dimension-outside-start-y1={layout.outsideStartDimensionLineStart?.[1]}
          data-floorplan-dimension-outside-start-y2={layout.dimensionEnd[1]}
          key={`dimension-line-${index}`}
          x1={layout.dimensionLineStart[0]}
          x2={layout.dimensionLineEnd[0]}
          y1={layout.dimensionLineStart[1]}
          y2={layout.dimensionLineEnd[1]}
        />
      ))}
      {[...ticks.values()].map(({ point, toward, tickHalfVector }, index) =>
        renderTerminator(
          terminator,
          point,
          toward,
          { tickHalfVector },
          lineProps,
          tickStrokeWidth,
          `tick-${index}`,
        ),
      )}
      {segmentLayouts.map(({ index, layout, segment }) => {
        const labelTransform = `translate(${layout.labelPoint[0]} ${layout.labelPoint[1]}) rotate(${layout.labelAngleDeg})`
        const outsideStartLocalShift = layout.outsideStartLabelPoint
          ? rotateVector(
              subtract(layout.outsideStartLabelPoint, layout.labelPoint),
              (-layout.labelAngleDeg * Math.PI) / 180,
            )
          : undefined
        return (
          <g key={`label-${index}`}>
            {layout.labelPlacement === 'outside-end' && annotationUnitsPerPoint !== undefined ? (
              <line
                {...lineProps}
                data-floorplan-dimension-leader=""
                visibility="hidden"
                x1={layout.dimensionEnd[0]}
                x2={layout.labelPoint[0]}
                y1={layout.dimensionEnd[1]}
                y2={layout.labelPoint[1]}
              />
            ) : null}
            <g
              data-floorplan-annotation-default-transform={labelTransform}
              data-floorplan-annotation-label=""
              data-floorplan-annotation-priority={floorplanDimensionAnnotationPriority(
                geometry.offsetDistance,
              )}
              data-floorplan-dimension-label-placement={layout.labelPlacement}
              data-floorplan-dimension-outside-start-local-x={outsideStartLocalShift?.[0]}
              data-floorplan-dimension-outside-start-local-y={outsideStartLocalShift?.[1]}
              data-floorplan-dimension-start-x={layout.dimensionStart[0]}
              data-floorplan-dimension-start-y={layout.dimensionStart[1]}
              data-floorplan-dimension-end-x={layout.dimensionEnd[0]}
              data-floorplan-dimension-end-y={layout.dimensionEnd[1]}
              transform={labelTransform}
            >
              <DimensionLabel
                fontSize={labelFontSize}
                renderMode={renderMode}
                stroke={stroke}
                text={segment.text}
                y={labelY}
              />
            </g>
          </g>
        )
      })}
    </g>
  )
}

function rotateVector(vector: FloorplanPoint, radians: number): FloorplanPoint {
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  return [vector[0] * cosine - vector[1] * sine, vector[0] * sine + vector[1] * cosine]
}

function DimensionLabel({
  text,
  y,
  fontSize,
  stroke,
  renderMode,
}: {
  text: string
  y: number
  fontSize: number
  stroke: string
  renderMode: FloorplanDimensionRenderMode
}) {
  const width = Math.max(fontSize, text.length * fontSize * LABEL_CHARACTER_WIDTH_RATIO)
  const plateWidth = width + fontSize * 0.5
  const plateHeight = fontSize * 1.2
  const plateY = y - fontSize * 0.82

  return (
    <>
      {renderMode === 'pdf' ? (
        <rect
          data-floorplan-dimension-label-plate=""
          fill="#ffffff"
          height={plateHeight}
          rx={fontSize * 0.12}
          ry={fontSize * 0.12}
          width={plateWidth}
          x={-plateWidth / 2}
          y={plateY}
        />
      ) : null}
      <text
        fill={stroke}
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
        fontSize={fontSize}
        fontWeight={500}
        paintOrder={renderMode === 'pdf' ? undefined : 'stroke'}
        stroke={renderMode === 'pdf' ? undefined : '#ffffff'}
        strokeLinejoin={renderMode === 'pdf' ? undefined : 'round'}
        strokeWidth={renderMode === 'pdf' ? undefined : 3}
        textAnchor="middle"
        vectorEffect={renderMode === 'pdf' ? undefined : 'non-scaling-stroke'}
        x={0}
        y={y}
      >
        {text}
      </text>
    </>
  )
}

function renderTerminator(
  terminator: DimensionTerminator,
  point: FloorplanPoint,
  toward: FloorplanPoint,
  layout: Pick<ArchitecturalDimensionLayout, 'tickHalfVector'>,
  lineProps: {
    stroke: string
    strokeLinecap: 'butt'
    strokeWidth: number
    vectorEffect: 'non-scaling-stroke'
  },
  tickStrokeWidth: number,
  key?: string,
): React.ReactElement | null {
  const direction = normalized(point, toward)
  if (!direction) return null
  const tickHalfLength = Math.hypot(layout.tickHalfVector[0], layout.tickHalfVector[1])
  if (terminator === 'dot') {
    return (
      <circle
        fill={lineProps.stroke}
        key={key}
        r={tickHalfLength * 0.45}
        vectorEffect="non-scaling-stroke"
        cx={point[0]}
        cy={point[1]}
      />
    )
  }
  if (terminator === 'filled-arrow' || terminator === 'open-arrow') {
    const base = addScaled(point, direction, tickHalfLength * 1.7)
    const normal: FloorplanPoint = [-direction[1], direction[0]]
    const wing = tickHalfLength * 0.65
    const left: FloorplanPoint = [base[0] + normal[0] * wing, base[1] + normal[1] * wing]
    const right: FloorplanPoint = [base[0] - normal[0] * wing, base[1] - normal[1] * wing]
    if (terminator === 'filled-arrow') {
      return (
        <polygon
          fill={lineProps.stroke}
          key={key}
          points={`${point[0]},${point[1]} ${left[0]},${left[1]} ${right[0]},${right[1]}`}
          vectorEffect="non-scaling-stroke"
        />
      )
    }
    return (
      <g key={key}>
        <line
          {...lineProps}
          strokeWidth={tickStrokeWidth}
          x1={point[0]}
          x2={left[0]}
          y1={point[1]}
          y2={left[1]}
        />
        <line
          {...lineProps}
          strokeWidth={tickStrokeWidth}
          x1={point[0]}
          x2={right[0]}
          y1={point[1]}
          y2={right[1]}
        />
      </g>
    )
  }
  const [tickX, tickY] = layout.tickHalfVector
  return (
    <line
      {...lineProps}
      key={key}
      strokeWidth={tickStrokeWidth}
      x1={point[0] - tickX}
      x2={point[0] + tickX}
      y1={point[1] - tickY}
      y2={point[1] + tickY}
    />
  )
}

function normalized(start: FloorplanPoint, end: FloorplanPoint): FloorplanPoint | null {
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  const magnitude = Math.hypot(dx, dy)
  return magnitude <= 1e-6 ? null : [dx / magnitude, dy / magnitude]
}

function pointKey(point: FloorplanPoint): string {
  return `${point[0].toFixed(6)},${point[1].toFixed(6)}`
}
