'use client'

import { memo } from 'react'

const FLOORPLAN_MEASUREMENT_LINE_WIDTH = 1.35
const FLOORPLAN_MEASUREMENT_LINE_OPACITY = 0.95
const FLOORPLAN_MEASUREMENT_LABEL_FONT_SIZE = 0.15
const FLOORPLAN_MEASUREMENT_LABEL_OPACITY = 0.98
const FLOORPLAN_MEASUREMENT_EXTENSION_DASH = '0.08 0.12'
const FLOORPLAN_MEASUREMENT_END_TICK = 0.18

export type LinearMeasurementOverlay = {
  id: string
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
  stroke?: string
}

type FloorplanMeasurementPalette = {
  measurementStroke: string
}

type FloorplanMeasurementLineProps = {
  palette: FloorplanMeasurementPalette
  segment: { x1: number; y1: number; x2: number; y2: number }
  isSelected?: boolean
  dashed?: boolean
  stroke?: string
}

function FloorplanMeasurementLine({
  palette,
  segment,
  isSelected,
  dashed = false,
  stroke,
}: FloorplanMeasurementLineProps) {
  const lineOpacity = isSelected
    ? FLOORPLAN_MEASUREMENT_LINE_OPACITY
    : FLOORPLAN_MEASUREMENT_LINE_OPACITY * 0.4

  return (
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
  palette: FloorplanMeasurementPalette
}

export const FloorplanMeasurementsLayer = memo(function FloorplanMeasurementsLayer({
  className,
  measurements,
  palette,
}: FloorplanMeasurementsLayerProps) {
  if (measurements.length === 0) {
    return null
  }

  return (
    <>
      {measurements.map((measurement) => (
        <g className={className} key={measurement.id} pointerEvents="none" style={{ userSelect: 'none' }}>
          <FloorplanMeasurementLine
            dashed
            isSelected={measurement.isSelected}
            palette={palette}
            segment={measurement.extensionStart}
            stroke={measurement.extensionStroke}
          />
          <FloorplanMeasurementLine
            isSelected={measurement.isSelected}
            palette={palette}
            segment={measurement.dimensionLineStart}
            stroke={measurement.stroke}
          />
          <FloorplanMeasurementLine
            isSelected={measurement.isSelected}
            palette={palette}
            segment={measurement.dimensionLineEnd}
            stroke={measurement.stroke}
          />
          <FloorplanMeasurementLine
            dashed
            isSelected={measurement.isSelected}
            palette={palette}
            segment={measurement.extensionEnd}
            stroke={measurement.extensionStroke}
          />
          <FloorplanMeasurementTick
            angleDeg={measurement.labelAngleDeg}
            isSelected={measurement.isSelected}
            palette={palette}
            stroke={measurement.stroke}
            x={measurement.dimensionLineStart.x1}
            y={measurement.dimensionLineStart.y1}
          />
          <FloorplanMeasurementTick
            angleDeg={measurement.labelAngleDeg}
            isSelected={measurement.isSelected}
            palette={palette}
            stroke={measurement.stroke}
            x={measurement.dimensionLineEnd.x2}
            y={measurement.dimensionLineEnd.y2}
          />
          <text
            dominantBaseline="central"
            fill={measurement.labelFill ?? palette.measurementStroke}
            fillOpacity={
              measurement.isSelected
                ? FLOORPLAN_MEASUREMENT_LABEL_OPACITY
                : FLOORPLAN_MEASUREMENT_LABEL_OPACITY * 0.4
            }
            fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
            fontSize={FLOORPLAN_MEASUREMENT_LABEL_FONT_SIZE}
            fontWeight="600"
            textAnchor="middle"
            transform={`rotate(${measurement.labelAngleDeg} ${measurement.labelX} ${measurement.labelY}) translate(0, -0.04)`}
            x={measurement.labelX}
            y={measurement.labelY}
          >
            {measurement.label}
          </text>
        </g>
      ))}
    </>
  )
})
