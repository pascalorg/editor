'use client'

import { memo, type PointerEvent } from 'react'
import { useFloorplanRender } from '../floorplan-render-context'

const FLOORPLAN_MEASUREMENT_LINE_WIDTH = 1.35
const FLOORPLAN_MEASUREMENT_LINE_OPACITY = 0.95
const FLOORPLAN_MEASUREMENT_LABEL_FONT_SIZE_PX = 10
const FLOORPLAN_MEASUREMENT_LABEL_OPACITY = 0.98
const FLOORPLAN_MEASUREMENT_EXTENSION_DASH = '0.08 0.12'
const FLOORPLAN_MEASUREMENT_END_TICK = 0.18
const FLOORPLAN_MEASUREMENT_LABEL_MIN_FONT_SIZE = 0.08

export function getFloorplanMeasurementPillMetrics(label: string, unitsPerPixel: number) {
  const fontSize = Math.max(
    unitsPerPixel * FLOORPLAN_MEASUREMENT_LABEL_FONT_SIZE_PX,
    FLOORPLAN_MEASUREMENT_LABEL_MIN_FONT_SIZE,
  )
  const padX = unitsPerPixel * 6
  const padY = unitsPerPixel * 3

  return {
    fontSize,
    height: fontSize + padY * 2,
    padX,
    padY,
    radius: unitsPerPixel * 3,
    strokeWidth: unitsPerPixel * 0.5,
    width: label.length * fontSize * 0.62 + padX * 2,
  }
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
          const labelOpacity = measurement.isSelected
            ? FLOORPLAN_MEASUREMENT_LABEL_OPACITY
            : FLOORPLAN_MEASUREMENT_LABEL_OPACITY * 0.4
          const labelMetrics = getFloorplanMeasurementPillMetrics(measurement.label, unitsPerPixel)

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
              <g
                opacity={labelOpacity}
                transform={`translate(${measurement.labelX} ${measurement.labelY}) rotate(${localLabelAngleDeg})`}
              >
                <rect
                  fill={palette.measurementLabelBackground ?? '#ffffff'}
                  height={labelMetrics.height}
                  opacity={0.92}
                  rx={labelMetrics.radius}
                  ry={labelMetrics.radius}
                  stroke={measurement.stroke ?? palette.measurementStroke}
                  strokeWidth={labelMetrics.strokeWidth}
                  vectorEffect="non-scaling-stroke"
                  width={labelMetrics.width}
                  x={-labelMetrics.width / 2}
                  y={-labelMetrics.height / 2}
                />
                <text
                  dominantBaseline="middle"
                  fill={
                    measurement.labelFill ??
                    palette.measurementLabelText ??
                    palette.measurementStroke
                  }
                  fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
                  fontSize={labelMetrics.fontSize}
                  fontWeight="600"
                  textAnchor="middle"
                  x={0}
                  y={0}
                >
                  {measurement.label}
                </text>
              </g>
            </g>
          )
        })(),
      )}
    </>
  )
})
