'use client'

import { useAlignmentGuides } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { memo } from 'react'
import { formatMeasurement } from '../editor/measurement-pill'

/**
 * Figma-style alignment guides for the 2D floor plan.
 *
 * Subscribes to `useAlignmentGuides` — populated in WORLD coords by both
 * 2D paths (`applyFloorplanAlignment`, registry move overlay) and 3D
 * tools (wall draft, item placement, stair, roof). A single shared frame
 * means whichever side is dragging, both layers (this one and
 * `Alignment3DGuideLayer`) read the same store and stay consistent.
 *
 * **Mounted OUTSIDE the rotated `<g data-floorplan-scene>`.** This layer
 * converts world XZ → SVG per endpoint using the floor-plan view's
 * fixed transform — which turns out to be independent of building
 * rotation: the scene <g>'s `rotate(FVR − buildingRot)` combined with
 * the `local → world` rotation collapses to a constant 90° rotation
 * around the building's world position. So:
 *     SVG_x = bldgPos.z − world.z
 *     SVG_y = world.x − bldgPos.x
 * Guide lines parallel to a world axis come out parallel to an SVG axis
 * (and therefore parallel to the world-axis-aligned grid).
 *
 * `unitsPerPixel` and `buildingWorldPos` are passed as props because the
 * layer sits outside `FloorplanRenderProvider` (which lives inside the
 * rotated group).
 */
export const FloorplanAlignmentGuideLayer = memo(function FloorplanAlignmentGuideLayer({
  unitsPerPixel,
  buildingWorldPos,
}: {
  unitsPerPixel: number
  buildingWorldPos: readonly [number, number, number]
}) {
  const guides = useAlignmentGuides((s) => s.guides)
  const unit = useViewer((s) => s.unit)

  if (guides.length === 0) return null

  const upp = unitsPerPixel > 0 ? unitsPerPixel : 0.01
  const bx = buildingWorldPos[0]
  const bz = buildingWorldPos[2]
  const toSvg = (worldX: number, worldZ: number) => ({
    x: bz - worldZ,
    y: worldX - bx,
  })

  // Pixel-budgeted sizes converted to world meters so visuals stay
  // constant across zoom. Numbers picked to mirror Figma's snap chrome.
  const stroke = 1 * upp
  const xCapSize = 4 * upp
  const pillFontSize = 11 * upp
  const pillPadX = 5 * upp
  const pillPadY = 3 * upp
  const pillRadius = 3 * upp
  const pillOffset = 8 * upp

  const color = '#ef4444' // tailwind red-500 — matches Figma's snap red

  return (
    <g pointerEvents="none">
      {guides.map((guide, i) => {
        // Each guide endpoint is in WORLD XZ; project to SVG.
        const fromSvg = toSvg(guide.from.x, guide.from.z)
        const toEndSvg = toSvg(guide.to.x, guide.to.z)
        const midSvgX = (fromSvg.x + toEndSvg.x) / 2
        const midSvgY = (fromSvg.y + toEndSvg.y) / 2
        const distMeters = guide.distance

        // Pill offset perpendicular to the line in SVG space. The
        // resolver's `axis === 'x'` (constant world X) maps to a
        // horizontal SVG line after the world → SVG 90° flip; `axis
        // === 'z'` maps to a vertical SVG line. Offset the pill along
        // the perpendicular SVG axis in each case.
        const horizontalInSvg = guide.axis === 'x'
        const pillX = horizontalInSvg ? midSvgX : midSvgX + pillOffset
        const pillY = horizontalInSvg ? midSvgY + pillOffset : midSvgY
        const distLabel = formatMeasurement(distMeters, unit)
        const charWidth = pillFontSize * 0.55
        const pillWidth = distLabel.length * charWidth + pillPadX * 2
        const pillHeight = pillFontSize + pillPadY * 2

        return (
          <g key={i}>
            <line
              stroke={color}
              strokeWidth={stroke}
              x1={fromSvg.x}
              x2={toEndSvg.x}
              y1={fromSvg.y}
              y2={toEndSvg.y}
            />
            <XCap color={color} size={xCapSize} stroke={stroke} x={fromSvg.x} y={fromSvg.y} />
            <XCap color={color} size={xCapSize} stroke={stroke} x={toEndSvg.x} y={toEndSvg.y} />
            {distMeters > 1e-4 && (
              // No counter-rotation: layer is outside the rotated scene
              // group, so the pill is already upright in SVG.
              <g>
                <rect
                  fill={color}
                  height={pillHeight}
                  rx={pillRadius}
                  ry={pillRadius}
                  width={pillWidth}
                  x={pillX - pillWidth / 2}
                  y={pillY - pillHeight / 2}
                />
                <text
                  fill="#ffffff"
                  fontFamily="-apple-system, system-ui, sans-serif"
                  fontSize={pillFontSize}
                  fontWeight={500}
                  textAnchor="middle"
                  x={pillX}
                  y={pillY + pillFontSize * 0.35}
                >
                  {distLabel}
                </text>
              </g>
            )}
          </g>
        )
      })}
    </g>
  )
})

function XCap({
  color,
  size,
  stroke,
  x,
  y,
}: {
  color: string
  size: number
  stroke: number
  x: number
  y: number
}) {
  return (
    <g>
      <line
        stroke={color}
        strokeWidth={stroke}
        x1={x - size}
        x2={x + size}
        y1={y - size}
        y2={y + size}
      />
      <line
        stroke={color}
        strokeWidth={stroke}
        x1={x - size}
        x2={x + size}
        y1={y + size}
        y2={y - size}
      />
    </g>
  )
}
