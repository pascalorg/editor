'use client'

import { memo } from 'react'
import type { Point2D, RoofNode, RoofSegmentNode } from '@pascal-app/core'
import { toSvgX, toSvgY } from '../svg-paths'

type FloorplanLineSegment = {
  start: Point2D
  end: Point2D
}

type FloorplanRoofSegmentEntry = {
  segment: RoofSegmentNode
  points: string
  ridgeLine: FloorplanLineSegment | null
}

type FloorplanRoofEntry = {
  roof: RoofNode
  segments: FloorplanRoofSegmentEntry[]
}

type FloorplanRoofLayerProps = {
  highlightedIdSet: ReadonlySet<string>
  roofEntries: FloorplanRoofEntry[]
  selectedIdSet: ReadonlySet<string>
}

export const FloorplanRoofLayer = memo(function FloorplanRoofLayer({
  highlightedIdSet,
  roofEntries,
  selectedIdSet,
}: FloorplanRoofLayerProps) {
  if (roofEntries.length === 0) {
    return null
  }

  return (
    <>
      {roofEntries.map(({ roof, segments }) => {
        const roofSelected = selectedIdSet.has(roof.id)
        const roofHighlighted = highlightedIdSet.has(roof.id)
        const hasSelectedSegment = segments.some(({ segment }) => selectedIdSet.has(segment.id))
        const hasHighlightedSegment = segments.some(({ segment }) =>
          highlightedIdSet.has(segment.id),
        )
        const isRoofActive =
          roofSelected || roofHighlighted || hasSelectedSegment || hasHighlightedSegment

        return (
          <g key={roof.id} pointerEvents="none">
            {segments.map(({ points, ridgeLine, segment }) => {
              const isSegmentSelected = selectedIdSet.has(segment.id)
              const isSegmentHighlighted = highlightedIdSet.has(segment.id)
              const isSegmentActive = isSegmentSelected || isSegmentHighlighted

              return (
                <g key={segment.id}>
                  <polygon
                    fill={
                      isSegmentActive
                        ? 'rgba(14, 165, 233, 0.2)'
                        : isRoofActive
                          ? 'rgba(14, 165, 233, 0.14)'
                          : 'rgba(14, 165, 233, 0.08)'
                    }
                    points={points}
                    stroke={
                      isSegmentActive
                        ? '#0369a1'
                        : isRoofActive
                          ? '#0ea5e9'
                          : 'rgba(14, 165, 233, 0.65)'
                    }
                    strokeWidth={isSegmentActive ? '2.25' : isRoofActive ? '1.75' : '1.1'}
                    vectorEffect="non-scaling-stroke"
                  />
                  {ridgeLine ? (
                    <line
                      fill="none"
                      stroke={isSegmentActive ? '#0f172a' : 'rgba(3, 105, 161, 0.75)'}
                      strokeWidth={isSegmentActive ? '2' : '1.4'}
                      vectorEffect="non-scaling-stroke"
                      x1={toSvgX(ridgeLine.start.x)}
                      x2={toSvgX(ridgeLine.end.x)}
                      y1={toSvgY(ridgeLine.start.y)}
                      y2={toSvgY(ridgeLine.end.y)}
                    />
                  ) : null}
                </g>
              )
            })}
          </g>
        )
      })}
    </>
  )
})
