'use client'

import type { WallPlanPoint } from '@pascal-app/core'

/** Length plate + angle arcs for a drafted wall segment, in plan space. */
export type DraftWallMeasurement = {
  lengthLabel: string
  midpoint: WallPlanPoint
  direction: WallPlanPoint
  angleLabels: {
    id: string
    label: string
    center: WallPlanPoint
    radius: number
    startAngle: number
    endAngle: number
    midAngle: number
  }[]
}

export function FloorplanDraftWallMeasurement({
  measurement,
  measurementStroke,
  labelBackground,
  labelText,
  sceneRotationDeg,
  unitsPerPixel,
}: {
  measurement: DraftWallMeasurement
  measurementStroke: string
  labelBackground: string
  labelText: string
  sceneRotationDeg: number
  unitsPerPixel: number
}) {
  const stroke = measurementStroke
  const labelBg = labelBackground

  const upx = unitsPerPixel
  const fontSize = Math.max(upx * 10, 0.08)
  const padX = upx * 6
  const padY = upx * 3

  // Length plate: rotates to follow the wall direction, but flips 180°
  // when its on-screen orientation would read upside-down (same trick as
  // `floorplan-registry-layer.tsx` for dimension labels).
  const wallAngleDeg =
    (Math.atan2(measurement.direction[1], measurement.direction[0]) * 180) / Math.PI
  let labelAngleDeg = wallAngleDeg
  let screenDeg = wallAngleDeg + sceneRotationDeg
  screenDeg = ((((screenDeg + 180) % 360) + 360) % 360) - 180
  if (screenDeg > 90) labelAngleDeg -= 180
  else if (screenDeg <= -90) labelAngleDeg += 180

  // Push the plate perpendicular to the wall so the dashed footprint
  // stays visible underneath.
  const perpX = -measurement.direction[1]
  const perpY = measurement.direction[0]
  const offset = upx * 18
  const cx = measurement.midpoint[0] + perpX * offset
  const cy = measurement.midpoint[1] + perpY * offset

  const lengthTextWidth = measurement.lengthLabel.length * upx * 6.2
  const lengthPlateW = lengthTextWidth + padX * 2
  const lengthPlateH = fontSize + padY * 2

  const arcSampleCount = 32

  return (
    <g pointerEvents="none">
      <g transform={`translate(${cx} ${cy}) rotate(${labelAngleDeg})`}>
        <rect
          fill={labelBg}
          height={lengthPlateH}
          opacity={0.92}
          rx={upx * 3}
          ry={upx * 3}
          stroke={stroke}
          strokeWidth={upx * 0.5}
          vectorEffect="non-scaling-stroke"
          width={lengthPlateW}
          x={-lengthPlateW / 2}
          y={-lengthPlateH / 2}
        />
        <text
          dominantBaseline="middle"
          fill={labelText}
          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
          fontSize={fontSize}
          fontWeight={600}
          textAnchor="middle"
          x={0}
          y={0}
        >
          {measurement.lengthLabel}
        </text>
      </g>

      {measurement.angleLabels.map((arc) => {
        // Sample the arc as a polyline — avoids the SVG arc command's
        // sweep-flag direction quirks across negative/positive sweeps.
        const points: string[] = []
        for (let i = 0; i <= arcSampleCount; i += 1) {
          const t = i / arcSampleCount
          const a = arc.startAngle + (arc.endAngle - arc.startAngle) * t
          const px = arc.center[0] + Math.cos(a) * arc.radius
          const py = arc.center[1] + Math.sin(a) * arc.radius
          points.push(`${px},${py}`)
        }

        const aFontSize = Math.max(upx * 9, 0.075)
        const aPadX = upx * 5
        const aPadY = upx * 2.5
        const aTextWidth = arc.label.length * upx * 6.2
        const aPlateW = aTextWidth + aPadX * 2
        const aPlateH = aFontSize + aPadY * 2

        const labelDist = arc.radius + upx * 16
        const lx = arc.center[0] + Math.cos(arc.midAngle) * labelDist
        const ly = arc.center[1] + Math.sin(arc.midAngle) * labelDist

        return (
          <g key={`draft-angle-${arc.id}`}>
            <polyline
              fill="none"
              points={points.join(' ')}
              stroke={stroke}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeOpacity={0.95}
              strokeWidth={upx * 1.2}
              vectorEffect="non-scaling-stroke"
            />
            <g transform={`translate(${lx} ${ly})`}>
              <rect
                fill={labelBg}
                height={aPlateH}
                opacity={0.92}
                rx={upx * 3}
                ry={upx * 3}
                stroke={stroke}
                strokeWidth={upx * 0.5}
                vectorEffect="non-scaling-stroke"
                width={aPlateW}
                x={-aPlateW / 2}
                y={-aPlateH / 2}
              />
              <text
                dominantBaseline="middle"
                fill={labelText}
                fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                fontSize={aFontSize}
                fontWeight={600}
                textAnchor="middle"
                x={0}
                y={0}
              >
                {arc.label}
              </text>
            </g>
          </g>
        )
      })}
    </g>
  )
}
