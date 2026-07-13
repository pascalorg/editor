'use client'

import { memo, type PointerEvent } from 'react'
import {
  DIMENSION_PILL_PRIMARY_CLASS_NAME,
  DimensionPillShell,
} from '../../editor/measurement-pill'
import { useFloorplanRender } from '../floorplan-render-context'

const FLOORPLAN_MEASUREMENT_LINE_WIDTH = 1.2
const FLOORPLAN_MEASUREMENT_LINE_OPACITY = 0.95
const FLOORPLAN_MEASUREMENT_LABEL_FONT_SIZE_PX = 12
const FLOORPLAN_MEASUREMENT_LABEL_LINE_HEIGHT_PX = 16
const FLOORPLAN_MEASUREMENT_LABEL_OPACITY = 0.98
const FLOORPLAN_MEASUREMENT_EXTENSION_DASH = '0.08 0.12'
const FLOORPLAN_MEASUREMENT_END_TICK = 0.18
const FLOORPLAN_MEASUREMENT_LABEL_MIN_FONT_SIZE = 0.08
const FLOORPLAN_MEASUREMENT_LABEL_PAD_X_PX = 16
const FLOORPLAN_MEASUREMENT_LABEL_PAD_Y_PX = 6

export function getFloorplanMeasurementPillMetrics(label: string, unitsPerPixel: number) {
  const pixelWidth =
    label.length * FLOORPLAN_MEASUREMENT_LABEL_FONT_SIZE_PX * 0.56 +
    FLOORPLAN_MEASUREMENT_LABEL_PAD_X_PX * 2
  const pixelHeight =
    FLOORPLAN_MEASUREMENT_LABEL_LINE_HEIGHT_PX + FLOORPLAN_MEASUREMENT_LABEL_PAD_Y_PX * 2
  const fontSize = Math.max(
    unitsPerPixel * FLOORPLAN_MEASUREMENT_LABEL_FONT_SIZE_PX,
    FLOORPLAN_MEASUREMENT_LABEL_MIN_FONT_SIZE,
  )
  const height = pixelHeight * unitsPerPixel
  const padX = unitsPerPixel * FLOORPLAN_MEASUREMENT_LABEL_PAD_X_PX
  const padY = unitsPerPixel * FLOORPLAN_MEASUREMENT_LABEL_PAD_Y_PX
  const width = pixelWidth * unitsPerPixel

  return {
    fontSize,
    height,
    padX,
    padY,
    pixelHeight,
    pixelWidth,
    radius: height / 2,
    strokeWidth: unitsPerPixel,
    width,
  }
}

export function FloorplanMeasurementPillLabel({
  isSelected,
  label,
  rotationDeg,
  unitsPerPixel,
  x,
  y,
}: {
  isSelected: boolean
  label: string
  rotationDeg: number
  unitsPerPixel: number
  x: number
  y: number
}) {
  const metrics = getFloorplanMeasurementPillMetrics(label, unitsPerPixel)

  return (
    <g opacity={isSelected ? FLOORPLAN_MEASUREMENT_LABEL_OPACITY : 0.42}>
      <g transform={`translate(${x} ${y}) rotate(${rotationDeg})`}>
        <foreignObject
          height={metrics.height}
          requiredExtensions="http://www.w3.org/1999/xhtml"
          transform={`translate(${-metrics.width / 2} ${-metrics.height / 2})`}
          width={metrics.width}
          x={0}
          y={0}
        >
          <div
            style={{
              alignItems: 'center',
              display: 'flex',
              height: metrics.pixelHeight,
              justifyContent: 'center',
              transform: `scale(${unitsPerPixel})`,
              transformOrigin: '0 0',
              width: metrics.pixelWidth,
            }}
          >
            <DimensionPillShell
              style={{
                boxSizing: 'border-box',
                height: '100%',
                justifyContent: 'center',
                width: '100%',
              }}
            >
              <span className={DIMENSION_PILL_PRIMARY_CLASS_NAME}>{label}</span>
            </DimensionPillShell>
          </div>
        </foreignObject>
      </g>
    </g>
  )
}

export type LinearMeasurementOverlay = {
  dashedExtensions?: boolean
  id: string
  dimensionPathEnd?: string | null
  dimensionPathStart?: string | null
  dimensionLineEnd: { x1: number; y1: number; x2: number; y2: number }
  dimensionLineStart: { x1: number; y1: number; x2: number; y2: number }
  extensionStart: { x1: number; y1: number; x2: number; y2: number }
  extensionEnd: { x1: number; y1: number; x2: number; y2: number }
  label: string
  labelX: number
  labelY: number
  labelAngleDeg: number
  extensionStroke?: string
  isSelected?: boolean
  labelFill?: string
  showTicks?: boolean
  stroke?: string
}

type FloorplanMeasurementPalette = {
  measurementLabelBackground?: string
  measurementLabelText?: string
  measurementStroke: string
}

type FloorplanMeasurementLineProps = {
  palette: FloorplanMeasurementPalette
  segment: { x1: number; y1: number; x2: number; y2: number }
  path?: string | null
  isSelected?: boolean
  dashed?: boolean
  stroke?: string
}

function FloorplanMeasurementLine({
  palette,
  segment,
  path,
  isSelected,
  dashed = false,
  stroke,
}: FloorplanMeasurementLineProps) {
  const lineOpacity = isSelected
    ? FLOORPLAN_MEASUREMENT_LINE_OPACITY
    : FLOORPLAN_MEASUREMENT_LINE_OPACITY * 0.4

  return path ? (
    <path
      d={path}
      fill="none"
      shapeRendering="geometricPrecision"
      stroke={stroke ?? palette.measurementStroke}
      strokeDasharray={dashed ? FLOORPLAN_MEASUREMENT_EXTENSION_DASH : undefined}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeOpacity={lineOpacity}
      strokeWidth={FLOORPLAN_MEASUREMENT_LINE_WIDTH}
      vectorEffect="non-scaling-stroke"
    />
  ) : (
    <line
      shapeRendering="geometricPrecision"
      stroke={stroke ?? palette.measurementStroke}
      strokeDasharray={dashed ? FLOORPLAN_MEASUREMENT_EXTENSION_DASH : undefined}
      strokeLinecap="round"
      strokeOpacity={lineOpacity}
      strokeWidth={FLOORPLAN_MEASUREMENT_LINE_WIDTH}
      vectorEffect="non-scaling-stroke"
      x1={segment.x1}
      x2={segment.x2}
      y1={segment.y1}
      y2={segment.y2}
    />
  )
}

type FloorplanMeasurementTickProps = {
  palette: FloorplanMeasurementPalette
  x: number
  y: number
  angleDeg: number
  isSelected?: boolean
  stroke?: string
}

function FloorplanMeasurementTick({
  palette,
  x,
  y,
  angleDeg,
  isSelected,
  stroke,
}: FloorplanMeasurementTickProps) {
  const radians = (angleDeg * Math.PI) / 180
  const nx = -Math.sin(radians)
  const ny = Math.cos(radians)
  const half = FLOORPLAN_MEASUREMENT_END_TICK / 2

  return (
    <line
      shapeRendering="geometricPrecision"
      stroke={stroke ?? palette.measurementStroke}
      strokeLinecap="round"
      strokeOpacity={
        isSelected ? FLOORPLAN_MEASUREMENT_LINE_OPACITY : FLOORPLAN_MEASUREMENT_LINE_OPACITY * 0.4
      }
      strokeWidth={FLOORPLAN_MEASUREMENT_LINE_WIDTH}
      vectorEffect="non-scaling-stroke"
      x1={x - nx * half}
      x2={x + nx * half}
      y1={y - ny * half}
      y2={y + ny * half}
    />
  )
}

type FloorplanMeasurementsLayerProps = {
  className: string
  measurements: LinearMeasurementOverlay[]
  onMeasurementPointerDown?: (id: string, event: PointerEvent<SVGGElement>) => void
  palette: FloorplanMeasurementPalette
  sceneRotationDeg?: number
}

function normalizeReadableScreenAngle(angleDeg: number) {
  let normalized = ((((angleDeg + 180) % 360) + 360) % 360) - 180

  if (normalized > 90) {
    normalized -= 180
  } else if (normalized <= -90) {
    normalized += 180
  }

  return normalized
}

export const FloorplanMeasurementsLayer = memo(function FloorplanMeasurementsLayer({
  className,
  measurements,
  onMeasurementPointerDown,
  palette,
  sceneRotationDeg = 0,
}: FloorplanMeasurementsLayerProps) {
  const renderContext = useFloorplanRender()

  if (measurements.length === 0) {
    return null
  }

  const unitsPerPixel = renderContext?.unitsPerPixel ?? 0.01
  return (
    <>
      {measurements.map((measurement) =>
        (() => {
          const screenLabelAngleDeg = normalizeReadableScreenAngle(
            measurement.labelAngleDeg + sceneRotationDeg,
          )
          const localLabelAngleDeg = screenLabelAngleDeg - sceneRotationDeg
          return (
            <g
              className={className}
              key={measurement.id}
              onPointerDown={
                onMeasurementPointerDown
                  ? (event) => onMeasurementPointerDown(measurement.id, event)
                  : undefined
              }
              pointerEvents={onMeasurementPointerDown ? 'auto' : 'none'}
              style={{
                cursor: onMeasurementPointerDown ? 'pointer' : undefined,
                userSelect: 'none',
              }}
            >
              <FloorplanMeasurementLine
                dashed={measurement.dashedExtensions ?? true}
                isSelected={measurement.isSelected}
                palette={palette}
                segment={measurement.extensionStart}
                stroke={measurement.extensionStroke}
              />
              <FloorplanMeasurementLine
                isSelected={measurement.isSelected}
                palette={palette}
                path={measurement.dimensionPathStart}
                segment={measurement.dimensionLineStart}
                stroke={measurement.stroke}
              />
              <FloorplanMeasurementLine
                isSelected={measurement.isSelected}
                palette={palette}
                path={measurement.dimensionPathEnd}
                segment={measurement.dimensionLineEnd}
                stroke={measurement.stroke}
              />
              <FloorplanMeasurementLine
                dashed={measurement.dashedExtensions ?? true}
                isSelected={measurement.isSelected}
                palette={palette}
                segment={measurement.extensionEnd}
                stroke={measurement.extensionStroke}
              />
              {measurement.showTicks !== false ? (
                <>
                  <FloorplanMeasurementTick
                    angleDeg={localLabelAngleDeg}
                    isSelected={measurement.isSelected}
                    palette={palette}
                    stroke={measurement.stroke}
                    x={measurement.dimensionLineStart.x1}
                    y={measurement.dimensionLineStart.y1}
                  />
                  <FloorplanMeasurementTick
                    angleDeg={localLabelAngleDeg}
                    isSelected={measurement.isSelected}
                    palette={palette}
                    stroke={measurement.stroke}
                    x={measurement.dimensionLineEnd.x2}
                    y={measurement.dimensionLineEnd.y2}
                  />
                </>
              ) : null}
              <FloorplanMeasurementPillLabel
                isSelected={measurement.isSelected ?? true}
                label={measurement.label}
                rotationDeg={localLabelAngleDeg}
                unitsPerPixel={unitsPerPixel}
                x={measurement.labelX}
                y={measurement.labelY}
              />
            </g>
          )
        })(),
      )}
    </>
  )
})
