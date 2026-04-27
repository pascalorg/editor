'use client'

import { memo } from 'react'

type SvgSelectionBounds = {
  x: number
  y: number
  width: number
  height: number
}

type FloorplanMarqueeLayerProps = {
  bounds: SvgSelectionBounds | null
  cursorColor: string
  outlineWidth: number
  glowWidth: number
}

export const FloorplanMarqueeLayer = memo(function FloorplanMarqueeLayer({
  bounds,
  cursorColor,
  outlineWidth,
  glowWidth,
}: FloorplanMarqueeLayerProps) {
  if (!bounds) {
    return null
  }

  return (
    <>
      <rect
        fill={cursorColor}
        fillOpacity={0.12}
        height={bounds.height}
        pointerEvents="none"
        stroke={cursorColor}
        strokeOpacity={0.26}
        strokeWidth={glowWidth}
        vectorEffect="non-scaling-stroke"
        width={bounds.width}
        x={bounds.x}
        y={bounds.y}
      />
      <rect
        fill="none"
        height={bounds.height}
        pointerEvents="none"
        stroke={cursorColor}
        strokeOpacity={0.96}
        strokeWidth={outlineWidth}
        vectorEffect="non-scaling-stroke"
        width={bounds.width}
        x={bounds.x}
        y={bounds.y}
      />
    </>
  )
})
