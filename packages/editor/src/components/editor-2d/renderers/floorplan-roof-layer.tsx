'use client'

import type { Point2D, RoofNode, RoofSegmentNode } from '@pascal-app/core'
import { memo } from 'react'
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

type FloorplanRoofPalette = {
  roofFill: string
  roofActiveFill: string
  roofSelectedFill: string
  roofStroke: string
  roofActiveStroke: string
  roofSelectedStroke: string
  roofRidgeStroke: string
  roofSelectedRidgeStroke: string
}

type FloorplanRoofLayerProps = {
  highlightedIdSet: ReadonlySet<string>
  palette: FloorplanRoofPalette
  roofEntries: FloorplanRoofEntry[]
  selectedIdSet: ReadonlySet<string>
}

export const FloorplanRoofLayer = memo(function FloorplanRoofLayer({
  highlightedIdSet,
  palette,
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
                        ? palette.roofSelectedFill
                        : isRoofActive
                          ? palette.roofActiveFill
                          : palette.roofFill
                    }
                    points={points}
                    stroke={
                      isSegmentActive
                        ? palette.roofSelectedStroke
                        : isRoofActive
                          ? palette.roofActiveStroke
                          : palette.roofStroke
                    }
                    strokeWidth={isSegmentActive ? '2.25' : isRoofActive ? '1.75' : '1.1'}
                    vectorEffect="non-scaling-stroke"
                  />
                  {ridgeLine ? (
                    <line
                      fill="none"
                      stroke={
                        isSegmentActive ? palette.roofSelectedRidgeStroke : palette.roofRidgeStroke
                      }
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
