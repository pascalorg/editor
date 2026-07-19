'use client'

import {
  deriveZoneQuantityReport,
  resolveAutoZonePolygon,
  useLiveNodeOverrides,
  useScene,
  type ZoneNode,
  type ZoneQuantityValue,
} from '@pascal-app/core'
import {
  formatAreaLabel,
  formatLinearMeasurement,
  formatVolumeLabel,
  PanelSection,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'

type Point2D = readonly [number, number]

function ZonePlanSketch({
  edgeLengths,
  polygon,
  unit,
}: {
  edgeLengths: readonly number[]
  polygon: readonly Point2D[]
  unit: 'metric' | 'imperial'
}) {
  if (polygon.length < 3) {
    return (
      <div className="flex h-28 items-center justify-center rounded-md border border-border/50 text-muted-foreground text-xs">
        Zone boundary unavailable
      </div>
    )
  }

  const viewWidth = 276
  const viewHeight = 176
  const padding = 34
  const xs = polygon.map((point) => point[0])
  const ys = polygon.map((point) => point[1])
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const width = Math.max(maxX - minX, 1e-6)
  const height = Math.max(maxY - minY, 1e-6)
  const scale = Math.min((viewWidth - padding * 2) / width, (viewHeight - padding * 2) / height)
  const offsetX = (viewWidth - width * scale) / 2
  const offsetY = (viewHeight - height * scale) / 2
  const projected = polygon.map(
    ([x, y]) => [offsetX + (x - minX) * scale, offsetY + (maxY - y) * scale] as Point2D,
  )
  const center = projected.reduce(
    (sum, point) => [sum[0] + point[0] / projected.length, sum[1] + point[1] / projected.length],
    [0, 0] as [number, number],
  )

  return (
    <svg
      aria-label="Top view with zone edge dimensions"
      className="h-auto w-full rounded-md border border-cyan-950/20 bg-[#f8faf7]"
      role="img"
      viewBox={`0 0 ${viewWidth} ${viewHeight}`}
    >
      <defs>
        <pattern height="12" id="zone-quantity-grid" patternUnits="userSpaceOnUse" width="12">
          <path d="M 12 0 L 0 0 0 12" fill="none" stroke="#0891b2" strokeOpacity="0.08" />
        </pattern>
      </defs>
      <rect fill="url(#zone-quantity-grid)" height={viewHeight} width={viewWidth} />
      <polygon
        fill="#67e8f9"
        fillOpacity="0.12"
        points={projected.map((point) => point.join(',')).join(' ')}
        stroke="#0e7490"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
      {projected.map((start, index) => {
        const end = projected[(index + 1) % projected.length]
        if (!end) return null
        const midpoint: Point2D = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2]
        const fromCenter = [midpoint[0] - center[0], midpoint[1] - center[1]] as const
        const directionLength = Math.hypot(fromCenter[0], fromCenter[1]) || 1
        const labelPoint: Point2D = [
          midpoint[0] + (fromCenter[0] / directionLength) * 15,
          midpoint[1] + (fromCenter[1] / directionLength) * 15,
        ]
        const label = formatLinearMeasurement(edgeLengths[index] ?? 0, unit)
        const labelWidth = Math.max(24, label.length * 5.5 + 8)

        return (
          <g key={`${start[0]}-${start[1]}-${index}`}>
            <circle cx={start[0]} cy={start[1]} fill="#f8faf7" r="2.5" stroke="#0e7490" />
            <rect
              fill="#f8faf7"
              height="13"
              rx="2"
              stroke="#0e7490"
              strokeOpacity="0.25"
              width={labelWidth}
              x={labelPoint[0] - labelWidth / 2}
              y={labelPoint[1] - 7}
            />
            <text
              dominantBaseline="middle"
              fill="#164e63"
              fontFamily="ui-monospace, SFMono-Regular, monospace"
              fontSize="7.5"
              textAnchor="middle"
              x={labelPoint[0]}
              y={labelPoint[1]}
            >
              {label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function QuantityRow({
  abbreviation,
  format,
  label,
  quantity,
}: {
  abbreviation: string
  format: (value: number) => string
  label: string
  quantity: ZoneQuantityValue
}) {
  return (
    <div className="rounded-md border border-border/50 bg-background/35 px-2.5 py-2">
      <div className="flex items-baseline gap-2">
        <span className="font-mono font-semibold text-cyan-600 text-[10px]">{abbreviation}</span>
        <span className="text-muted-foreground text-xs">{label}</span>
        <span className="ml-auto font-mono font-medium text-foreground text-xs tabular-nums">
          {quantity.status === 'available' ? format(quantity.value) : 'Not proven'}
        </span>
      </div>
      <div className="mt-1 text-[10px] text-muted-foreground leading-snug">
        {quantity.status === 'available' ? quantity.note : quantity.reason}
      </div>
    </div>
  )
}

export default function ZoneQuantitiesPanel() {
  const selectedZoneId = useViewer((state) => state.selection.zoneId)
  const unit = useViewer((state) => state.unit)
  const nodes = useScene((state) => state.nodes)
  const zone = selectedZoneId ? (nodes[selectedZoneId] as ZoneNode | undefined) : undefined
  const livePolygon = useLiveNodeOverrides((state) =>
    selectedZoneId ? state.overrides.get(selectedZoneId)?.polygon : undefined,
  ) as ZoneNode['polygon'] | undefined
  const boundaryWallIds = zone?.autoFromWalls ? zone.boundaryWallIds : []
  const boundaryOverrides = useLiveNodeOverrides(
    useShallow((state) => boundaryWallIds.map((id) => state.overrides.get(id))),
  )
  const proceduralPolygon = zone
    ? resolveAutoZonePolygon(zone, (id) => {
        const dependency = nodes[id]
        if (!dependency) return undefined
        const override =
          boundaryOverrides[boundaryWallIds.indexOf(id as (typeof boundaryWallIds)[number])]
        return override ? { ...dependency, ...override } : dependency
      })
    : undefined
  const effectiveZone = zone
    ? { ...zone, polygon: livePolygon ?? proceduralPolygon ?? zone.polygon }
    : undefined
  const effectiveNodes = useMemo(() => {
    if (boundaryOverrides.every((override) => !override)) return nodes
    const merged = { ...nodes }
    boundaryWallIds.forEach((id, index) => {
      const dependency = nodes[id]
      const override = boundaryOverrides[index]
      if (dependency && override) merged[id] = { ...dependency, ...override }
    })
    return merged
  }, [boundaryOverrides, boundaryWallIds, nodes])
  const report = useMemo(
    () => (effectiveZone ? deriveZoneQuantityReport(effectiveZone, effectiveNodes) : null),
    [effectiveNodes, effectiveZone],
  )

  if (!effectiveZone || !report) return null

  return (
    <PanelSection title="Zone quantities">
      <div className="overflow-hidden rounded-md border border-cyan-950/20 bg-[#f8faf7] text-slate-950">
        <div className="flex items-center border-cyan-950/15 border-b px-2.5 py-2">
          <span className="font-semibold text-[11px]">{effectiveZone.name}</span>
          <span className="ml-auto rounded-full border border-cyan-800/25 bg-cyan-50 px-2 py-0.5 text-cyan-900 text-[9px]">
            {report.classification === 'enclosed-room' ? 'Enclosed room' : 'Footprint only'}
          </span>
        </div>
        <div className="flex items-baseline gap-2 px-2.5 py-2 font-mono text-[10px]">
          <span className="text-cyan-800">A</span>
          <span>{formatAreaLabel(report.footprintArea, unit, 2)}</span>
          <span className="ml-auto text-slate-600">P</span>
          <span>{formatLinearMeasurement(report.perimeter, unit)}</span>
        </div>
      </div>

      <ZonePlanSketch
        edgeLengths={report.edgeLengths}
        polygon={effectiveZone.polygon}
        unit={unit}
      />

      <div className="flex flex-col gap-1.5">
        <QuantityRow
          abbreviation="Aw"
          format={(value) => formatAreaLabel(value, unit, 2)}
          label="Wall surface"
          quantity={report.wallSurface}
        />
        <QuantityRow
          abbreviation="Af"
          format={(value) => formatAreaLabel(value, unit, 2)}
          label="Floor surface"
          quantity={report.floorSurface}
        />
        <QuantityRow
          abbreviation="V"
          format={(value) => formatVolumeLabel(value, unit, 2)}
          label="Volume"
          quantity={report.volume}
        />
      </div>
    </PanelSection>
  )
}
