'use client'

import { memo } from 'react'

type SvgLine = {
  x1: number
  y1: number
  x2: number
  y2: number
}

type FloorplanDraftLayerProps = {
  draftPolygonPoints: string | null
  linearDraftSegment: SvgLine | null
  polygonDraftPolygonPoints: string | null
  polygonDraftPolylinePoints: string | null
  polygonDraftClosingSegment: SvgLine | null
  draftAnchorPoints: Array<{ x: number; y: number; isPrimary: boolean }>
  draftFill: string
  draftStroke: string
  anchorFill: string
}

export const FloorplanDraftLayer = memo(function FloorplanDraftLayer({
  draftPolygonPoints,
  linearDraftSegment,
  polygonDraftPolygonPoints,
  polygonDraftPolylinePoints,
  polygonDraftClosingSegment,
  draftAnchorPoints,
  draftFill,
  draftStroke,
  anchorFill,
}: FloorplanDraftLayerProps) {
  return (
    <>
      {draftPolygonPoints && (
        <polygon
          fill={draftFill}
          fillOpacity={0.35}
          points={draftPolygonPoints}
          stroke={draftStroke}
          strokeDasharray="0.24 0.12"
          strokeWidth="0.07"
          vectorEffect="non-scaling-stroke"
        />
      )}

      {linearDraftSegment && (
        <line
          stroke={draftStroke}
          strokeDasharray="0.2 0.12"
          strokeLinecap="round"
          strokeOpacity={0.95}
          strokeWidth="0.08"
          vectorEffect="non-scaling-stroke"
          x1={linearDraftSegment.x1}
          x2={linearDraftSegment.x2}
          y1={linearDraftSegment.y1}
          y2={linearDraftSegment.y2}
        />
      )}

      {polygonDraftPolygonPoints && (
        <polygon
          fill={draftFill}
          fillOpacity={0.2}
          points={polygonDraftPolygonPoints}
          stroke="none"
        />
      )}

      {polygonDraftPolylinePoints && (
        <polyline
          fill="none"
          points={polygonDraftPolylinePoints}
          stroke={draftStroke}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="0.08"
          vectorEffect="non-scaling-stroke"
        />
      )}

      {polygonDraftClosingSegment && (
        <line
          stroke={draftStroke}
          strokeDasharray="0.16 0.1"
          strokeLinecap="round"
          strokeOpacity={0.75}
          strokeWidth="0.05"
          vectorEffect="non-scaling-stroke"
          x1={polygonDraftClosingSegment.x1}
          x2={polygonDraftClosingSegment.x2}
          y1={polygonDraftClosingSegment.y1}
          y2={polygonDraftClosingSegment.y2}
        />
      )}

      {draftAnchorPoints.map((point, index) => (
        <circle
          cx={point.x}
          cy={point.y}
          fill={point.isPrimary ? anchorFill : draftStroke}
          fillOpacity={0.95}
          key={`polygon-draft-${index}`}
          pointerEvents="none"
          r={point.isPrimary ? 0.12 : 0.1}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </>
  )
})
