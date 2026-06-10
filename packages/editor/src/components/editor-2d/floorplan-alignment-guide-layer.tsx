'use client'

import { useViewer } from '@pascal-app/viewer'
import { memo } from 'react'
import useAlignmentGuides from '../../store/use-alignment-guides'
import { formatMeasurement } from '../editor/measurement-pill'
import { useFloorplanRender } from './floorplan-render-context'

/**
 * Figma-style alignment guides for the 2D floor plan.
 *
 * Subscribes to the editor-local `useAlignmentGuides` store (separate
 * from the core store the 3D layer reads). Guides come in
 * building-local meters, so the layer is mounted INSIDE the rotated
 * `<g data-floorplan-scene>` — the SVG transform that takes the rest
 * of the floor-plan geometry from local → screen carries the guide
 * lines too. Pill labels are counter-rotated by `sceneRotationDeg`
 * (from `FloorplanRenderProvider`) so they stay upright even when the
 * scene `<g>` is rotated by building rotation.
 *
 * Each guide renders as a red line between the moving and matched
 * candidate anchors with small `×` end-caps. A distance pill is drawn
 * at the midpoint when the perpendicular gap is non-zero.
 *
 * Stroke widths and handle radii are scaled by `unitsPerPixel` so they
 * stay a constant size on screen no matter the zoom.
 */
export const FloorplanAlignmentGuideLayer = memo(function FloorplanAlignmentGuideLayer() {
  const guides = useAlignmentGuides((s) => s.guides)
  const unit = useViewer((s) => s.unit)
  const ctx = useFloorplanRender()

  if (guides.length === 0) return null

  const upp = ctx?.unitsPerPixel ?? 0.01
  const sceneRot = ctx?.sceneRotationDeg ?? 0

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
        const { from, to, axis } = guide
        const midX = (from.x + to.x) / 2
        const midZ = (from.z + to.z) / 2
        const distMeters = guide.distance

        // Pill placed offset perpendicular to the guide's axis so it
        // doesn't sit on top of the line itself. For an X-axis guide
        // (vertical line) we offset along Z; for a Z-axis guide we
        // offset along X.
        const pillX = axis === 'x' ? midX + pillOffset : midX
        const pillZ = axis === 'z' ? midZ + pillOffset : midZ
        const distLabel = formatMeasurement(distMeters, unit)
        const charWidth = pillFontSize * 0.55
        const pillWidth = distLabel.length * charWidth + pillPadX * 2
        const pillHeight = pillFontSize + pillPadY * 2

        return (
          <g key={i}>
            <line stroke={color} strokeWidth={stroke} x1={from.x} x2={to.x} y1={from.z} y2={to.z} />
            <XCap color={color} size={xCapSize} stroke={stroke} x={from.x} y={from.z} />
            <XCap color={color} size={xCapSize} stroke={stroke} x={to.x} y={to.z} />
            {distMeters > 1e-4 && (
              // Counter-rotate the pill so it stays upright when the
              // scene `<g>` is rotated by building rotation. SVG's
              // `transform` runs in the local coord system, so the
              // rotation pivots around the pill's center.
              <g transform={`rotate(${-sceneRot} ${pillX} ${pillZ})`}>
                <rect
                  fill={color}
                  height={pillHeight}
                  rx={pillRadius}
                  ry={pillRadius}
                  width={pillWidth}
                  x={pillX - pillWidth / 2}
                  y={pillZ - pillHeight / 2}
                />
                <text
                  fill="#ffffff"
                  fontFamily="-apple-system, system-ui, sans-serif"
                  fontSize={pillFontSize}
                  fontWeight={500}
                  textAnchor="middle"
                  x={pillX}
                  y={pillZ + pillFontSize * 0.35}
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
