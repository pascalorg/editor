'use client'

import type { Point2D, StairNode, StairSegmentNode } from '@pascal-app/core'
import {
  memo,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  buildSvgAnnularSectorPath,
  buildSvgArcPath,
  buildSvgArrowHeadPoints,
  formatSvgPolygonPoints,
  getArcPlanPoint,
  toSvgX,
  toSvgY,
} from '../svg-paths'

type FloorplanPolygonEntry = {
  points: string
  polygon: Point2D[]
}

type FloorplanStairSegmentEntry = {
  segment: StairSegmentNode
  points: string
  treadBars: FloorplanPolygonEntry[]
}

type FloorplanStairArrowEntry = {
  head: Point2D[]
  polyline: Point2D[]
}

type FloorplanStairEntry = {
  arrow: FloorplanStairArrowEntry | null
  hitPolygons: Point2D[][]
  stair: StairNode
  segments: FloorplanStairSegmentEntry[]
}

type FloorplanPalette = {
  deleteFill: string
  deleteStroke: string
}

type FloorplanStairLayerProps = {
  canFocusStairs: boolean
  canSelectStairs: boolean
  cursor: string
  highlightedIdSet: ReadonlySet<string>
  hitStrokeWidth: number
  hoveredStairId: StairNode['id'] | null
  isDeleteMode: boolean
  onStairDoubleClick: (stair: StairNode, event: ReactMouseEvent<SVGElement>) => void
  onStairHoverChange: (stairId: StairNode['id'] | null) => void
  onStairHoverEnter: (stairId: StairNode['id']) => void
  onStairPointerDown: (stairId: StairNode['id'], event: ReactPointerEvent<SVGElement>) => void
  onStairSelect: (stairId: StairNode['id'], event: ReactMouseEvent<SVGElement>) => void
  palette: FloorplanPalette
  selectedIdSet: ReadonlySet<string>
  stairEntries: FloorplanStairEntry[]
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function getNormalizedFloorplanStairSweepAngle(stair: StairNode) {
  const stairType = stair.stairType ?? 'straight'
  const baseSweepAngle = stair.sweepAngle ?? (stairType === 'spiral' ? Math.PI * 2 : Math.PI / 2)

  if (Math.abs(baseSweepAngle) >= Math.PI * 2) {
    return Math.sign(baseSweepAngle || 1) * (Math.PI * 2 - 0.001)
  }

  return baseSweepAngle
}

export const FloorplanStairLayer = memo(function FloorplanStairLayer({
  canFocusStairs,
  canSelectStairs,
  cursor,
  highlightedIdSet,
  hitStrokeWidth,
  hoveredStairId,
  isDeleteMode,
  onStairDoubleClick,
  onStairHoverChange,
  onStairHoverEnter,
  onStairPointerDown,
  onStairSelect,
  palette,
  selectedIdSet,
  stairEntries,
}: FloorplanStairLayerProps) {
  if (stairEntries.length === 0) {
    return null
  }

  return (
    <>
      {stairEntries.map(({ arrow, hitPolygons, stair, segments }) => {
        const stairSelected = selectedIdSet.has(stair.id)
        const stairHighlighted = highlightedIdSet.has(stair.id)
        const segmentSelected = segments.some(({ segment }) => selectedIdSet.has(segment.id))
        const segmentHighlighted = segments.some(({ segment }) => highlightedIdSet.has(segment.id))
        const isHovered = hoveredStairId === stair.id
        const isDeleteHovered = isDeleteMode && isHovered
        const isSelectionActive =
          stairSelected || stairHighlighted || segmentSelected || segmentHighlighted
        const stairType = stair.stairType ?? 'straight'
        const normalizedSweepAngle = getNormalizedFloorplanStairSweepAngle(stair)
        const sectorStartAngle = stair.rotation - normalizedSweepAngle / 2
        const sectorEndAngle = sectorStartAngle + normalizedSweepAngle
        const stairCenter = {
          x: stair.position[0],
          y: stair.position[2],
        }
        const innerRadius = Math.max(
          stairType === 'spiral' ? 0.05 : 0.2,
          stair.innerRadius ?? (stairType === 'spiral' ? 0.2 : 0.9),
        )
        const outerRadius = innerRadius + stair.width
        const centerlineRadius = innerRadius + stair.width / 2
        const curvedStroke = isDeleteHovered
          ? palette.deleteStroke
          : isSelectionActive
            ? '#2563eb'
            : 'rgba(31, 41, 55, 0.9)'
        const curvedAccent = isDeleteHovered
          ? palette.deleteStroke
          : isSelectionActive
            ? '#1d4ed8'
            : 'rgba(23, 23, 23, 0.96)'
        const curvedFill = isDeleteHovered
          ? palette.deleteFill
          : isSelectionActive
            ? 'rgba(59, 130, 246, 0.16)'
            : '#ffffff'
        const straightAccent = isDeleteHovered
          ? palette.deleteStroke
          : isSelectionActive
            ? '#1d4ed8'
            : 'rgba(23, 23, 23, 0.96)'
        const straightStroke = isDeleteHovered
          ? palette.deleteStroke
          : isSelectionActive
            ? '#1d4ed8'
            : 'rgba(23, 23, 23, 0.88)'
        const straightTread = isDeleteHovered
          ? palette.deleteStroke
          : isSelectionActive
            ? 'rgba(37, 99, 235, 0.78)'
            : 'rgba(38, 38, 38, 0.62)'
        const straightFill = isDeleteHovered
          ? palette.deleteFill
          : isSelectionActive
            ? 'rgba(59, 130, 246, 0.08)'
            : 'rgba(255, 255, 255, 0.02)'
        const curvedOuterLineWidth = isSelectionActive ? '2' : '1.4'
        const curvedInnerLineWidth = isSelectionActive ? '1.7' : '1.2'
        const stairSymbol =
          stairType === 'spiral' ? (
            <>
              <path
                d={buildSvgAnnularSectorPath(
                  stairCenter,
                  innerRadius,
                  outerRadius,
                  sectorStartAngle,
                  sectorEndAngle,
                )}
                fill={curvedFill}
                pointerEvents="none"
              />
              <path
                d={buildSvgArcPath(stairCenter, outerRadius, sectorStartAngle, sectorEndAngle)}
                fill="none"
                pointerEvents="none"
                stroke={curvedStroke}
                strokeWidth={curvedOuterLineWidth}
                vectorEffect="non-scaling-stroke"
              />
              <path
                d={buildSvgArcPath(stairCenter, innerRadius, sectorStartAngle, sectorEndAngle)}
                fill="none"
                pointerEvents="none"
                stroke={curvedStroke}
                strokeWidth={curvedInnerLineWidth}
                vectorEffect="non-scaling-stroke"
              />
              {Array.from({ length: Math.max(6, stair.stepCount) }, (_, index) => {
                const stepCount = Math.max(6, stair.stepCount)
                const stepSweep = normalizedSweepAngle / stepCount
                const angle = sectorStartAngle + stepSweep * index
                const innerPoint = getArcPlanPoint(stairCenter, innerRadius, angle)
                const outerPoint = getArcPlanPoint(stairCenter, outerRadius, angle)
                const dashedFromIndex = Math.floor(stepCount * 0.68)

                return (
                  <line
                    key={`${stair.id}:spiral-step:${index}`}
                    pointerEvents="none"
                    stroke={index === stepCount - 1 ? curvedAccent : curvedStroke}
                    strokeDasharray={index >= dashedFromIndex ? '0.1 0.08' : undefined}
                    strokeWidth={index === stepCount - 1 ? '1.8' : '1.15'}
                    vectorEffect="non-scaling-stroke"
                    x1={toSvgX(innerPoint.x)}
                    x2={toSvgX(outerPoint.x)}
                    y1={toSvgY(innerPoint.y)}
                    y2={toSvgY(outerPoint.y)}
                  />
                )
              })}
              <circle
                cx={toSvgX(stairCenter.x)}
                cy={toSvgY(stairCenter.y)}
                fill="#ffffff"
                pointerEvents="none"
                r={Math.max(innerRadius * 0.18, 0.06)}
                stroke={curvedAccent}
                strokeWidth="1.2"
                vectorEffect="non-scaling-stroke"
              />
              {(() => {
                const directionAngle = sectorStartAngle + normalizedSweepAngle * 0.86
                const arrowPoint = getArcPlanPoint(stairCenter, centerlineRadius, directionAngle)
                const tangentAngle =
                  directionAngle + (normalizedSweepAngle >= 0 ? Math.PI / 2 : -Math.PI / 2)

                return (
                  <polygon
                    fill={curvedAccent}
                    key={`${stair.id}:spiral-arrow`}
                    pointerEvents="none"
                    points={buildSvgArrowHeadPoints(
                      arrowPoint,
                      tangentAngle,
                      clamp(stair.width * 0.18, 0.12, 0.18),
                    )}
                  />
                )
              })()}
            </>
          ) : stairType === 'curved' ? (
            <>
              <path
                d={buildSvgAnnularSectorPath(
                  stairCenter,
                  innerRadius,
                  outerRadius,
                  sectorStartAngle,
                  sectorEndAngle,
                )}
                fill={curvedFill}
                pointerEvents="none"
              />
              <path
                d={buildSvgArcPath(stairCenter, outerRadius, sectorStartAngle, sectorEndAngle)}
                fill="none"
                pointerEvents="none"
                stroke={curvedStroke}
                strokeWidth={curvedOuterLineWidth}
                vectorEffect="non-scaling-stroke"
              />
              <path
                d={buildSvgArcPath(stairCenter, innerRadius, sectorStartAngle, sectorEndAngle)}
                fill="none"
                pointerEvents="none"
                stroke={curvedStroke}
                strokeWidth={curvedInnerLineWidth}
                vectorEffect="non-scaling-stroke"
              />
              {Array.from({ length: Math.max(4, stair.stepCount) + 1 }, (_, index) => {
                const stepCount = Math.max(4, stair.stepCount)
                const stepSweep = normalizedSweepAngle / stepCount
                const angle = sectorStartAngle + stepSweep * index
                const innerPoint = getArcPlanPoint(stairCenter, innerRadius, angle)
                const outerPoint = getArcPlanPoint(stairCenter, outerRadius, angle)

                return (
                  <line
                    key={`${stair.id}:curved-step:${index}`}
                    pointerEvents="none"
                    stroke={curvedStroke}
                    strokeWidth={index === 0 || index === stepCount ? '1.5' : '1.1'}
                    vectorEffect="non-scaling-stroke"
                    x1={toSvgX(innerPoint.x)}
                    x2={toSvgX(outerPoint.x)}
                    y1={toSvgY(innerPoint.y)}
                    y2={toSvgY(outerPoint.y)}
                  />
                )
              })}
              <path
                d={buildSvgArcPath(
                  stairCenter,
                  centerlineRadius,
                  sectorStartAngle + (normalizedSweepAngle / Math.max(4, stair.stepCount)) * 0.55,
                  sectorEndAngle - (normalizedSweepAngle / Math.max(4, stair.stepCount)) * 0.55,
                )}
                fill="none"
                pointerEvents="none"
                stroke={curvedAccent}
                strokeDasharray="0.08 0.11"
                strokeWidth="1.1"
                vectorEffect="non-scaling-stroke"
              />
              {(() => {
                const stepCount = Math.max(4, stair.stepCount)
                const stepSweep = normalizedSweepAngle / stepCount
                const arrowAngle = sectorEndAngle - stepSweep * 0.8
                const arrowPoint = getArcPlanPoint(stairCenter, centerlineRadius, arrowAngle)
                const tangentAngle =
                  arrowAngle + (normalizedSweepAngle >= 0 ? Math.PI / 2 : -Math.PI / 2)

                return (
                  <polygon
                    fill={curvedAccent}
                    key={`${stair.id}:curved-arrow`}
                    pointerEvents="none"
                    points={buildSvgArrowHeadPoints(
                      arrowPoint,
                      tangentAngle,
                      clamp(stair.width * 0.16, 0.1, 0.16),
                    )}
                  />
                )
              })()}
            </>
          ) : (
            <>
              {segments.map(({ points, segment, treadBars }) => (
                <g key={segment.id}>
                  <polygon
                    fill={straightFill}
                    pointerEvents="none"
                    points={points}
                    stroke={straightStroke}
                    strokeWidth={isSelectionActive ? '2' : '1.35'}
                    vectorEffect="non-scaling-stroke"
                  />
                  {treadBars.map((treadBar, treadIndex) => (
                    <polygon
                      fill={straightTread}
                      key={`${segment.id}:tread:${treadIndex}`}
                      pointerEvents="none"
                      points={segment.segmentType === 'landing' ? '' : treadBar.points}
                    />
                  ))}
                </g>
              ))}
              {arrow?.polyline && arrow.polyline.length >= 2 ? (
                <>
                  <polyline
                    fill="none"
                    points={formatSvgPolygonPoints(arrow.polyline)}
                    pointerEvents="none"
                    stroke={straightAccent}
                    strokeWidth="1.15"
                    vectorEffect="non-scaling-stroke"
                  />
                  <circle
                    cx={toSvgX(arrow.polyline[0]!.x)}
                    cy={toSvgY(arrow.polyline[0]!.y)}
                    fill={straightAccent}
                    pointerEvents="none"
                    r="0.045"
                  />
                  <polygon
                    fill={straightAccent}
                    points={formatSvgPolygonPoints(arrow.head)}
                    pointerEvents="none"
                  />
                </>
              ) : null}
            </>
          )

        return (
          <g
            key={stair.id}
            onClick={
              canSelectStairs
                ? (event) => {
                    event.stopPropagation()
                    onStairSelect(stair.id, event)
                  }
                : undefined
            }
            onDoubleClick={
              canFocusStairs
                ? (event) => {
                    event.stopPropagation()
                    onStairDoubleClick(stair, event)
                  }
                : undefined
            }
            onPointerEnter={canSelectStairs ? () => onStairHoverEnter(stair.id) : undefined}
            onPointerLeave={canSelectStairs ? () => onStairHoverChange(null) : undefined}
            onPointerDown={
              canFocusStairs && stairSelected
                ? (event) => {
                    if (event.button === 0) {
                      onStairPointerDown(stair.id, event)
                    }
                  }
                : undefined
            }
            pointerEvents={canSelectStairs ? undefined : 'none'}
            style={canSelectStairs ? { cursor } : undefined}
          >
            {hitPolygons.map((polygon, polygonIndex) => (
              <polygon
                fill="transparent"
                key={`${stair.id}:hit:${polygonIndex}`}
                points={formatSvgPolygonPoints(polygon)}
                pointerEvents={canSelectStairs ? 'all' : 'none'}
                stroke="transparent"
                strokeLinejoin="round"
                strokeWidth={hitStrokeWidth}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            <title>{stair.name || 'Staircase'}</title>
            {stairSymbol}
          </g>
        )
      })}
    </>
  )
})
