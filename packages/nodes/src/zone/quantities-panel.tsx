'use client'

import {
  deriveZoneQuantityReport,
  resolveAutoZonePolygon,
  useLiveNodeOverrides,
  useRegistryVersion,
  useScene,
  type ZoneNode,
  type ZoneQuantityValue,
  type ZoneTakeoffReport,
} from '@pascal-app/core'
import {
  collectZoneObjectLabels,
  formatAreaLabel,
  formatLinearMeasurement,
  formatVolumeLabel,
  MetricControl,
  PanelSection,
  resolveNodeDisplayName,
  resolveZoneTakeoffReports,
  ToggleControl,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'

type Point2D = readonly [number, number]

function ZonePlanSketch({
  edgeLengths,
  metricNotation,
  polygon,
  unit,
}: {
  edgeLengths: readonly number[]
  metricNotation: 'meters' | 'millimeters'
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
        const label = formatLinearMeasurement(edgeLengths[index] ?? 0, unit, metricNotation)
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

function RoomTextField({
  label,
  onCommit,
  value,
}: {
  label: string
  onCommit: (value: string) => void
  value: string
}) {
  const [draft, setDraft] = useState(value)
  const cancelRef = useRef(false)

  useEffect(() => setDraft(value), [value])

  const commit = () => {
    if (cancelRef.current) {
      cancelRef.current = false
      setDraft(value)
      return
    }
    const next = draft.trim()
    if (next !== value) onCommit(next)
    else setDraft(value)
  }

  return (
    <label className="flex h-10 items-center gap-3 rounded-lg border border-border/50 bg-[#2C2C2E] px-3 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <input
        className="min-w-0 flex-1 bg-transparent text-right text-foreground outline-none selection:bg-primary/30"
        onBlur={commit}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            cancelRef.current = true
            event.currentTarget.blur()
          }
        }}
        type="text"
        value={draft}
      />
    </label>
  )
}

function RoomSelect({
  label,
  onChange,
  options,
  value,
}: {
  label: string
  onChange: (value: string) => void
  options: ReadonlyArray<{ label: string; value: string }>
  value: string
}) {
  return (
    <label className="flex h-10 items-center justify-between gap-3 rounded-lg border border-border/50 bg-[#2C2C2E] px-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <select
        className="min-w-0 rounded-md border border-border/50 bg-[#232325] px-2 py-1 text-foreground text-xs outline-none"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function RoomDocumentationPanel({ zone }: { zone: ZoneNode }) {
  const updateNode = useScene((state) => state.updateNode)
  const update = (patch: Partial<ZoneNode>) => updateNode(zone.id, patch)
  const isRoom = zone.spaceRole === 'room'

  return (
    <PanelSection title="Room documentation">
      <ToggleControl
        checked={isRoom}
        label="Architectural room"
        onChange={(checked) => update({ spaceRole: checked ? 'room' : 'generic' })}
      />
      {isRoom ? (
        <>
          <RoomTextField
            label="Room name"
            onCommit={(name) => update({ name })}
            value={zone.name}
          />
          <RoomTextField
            label="Room number"
            onCommit={(roomNumber) => update({ roomNumber })}
            value={zone.roomNumber}
          />
          <RoomSelect
            label="Enclosure"
            onChange={(enclosureStatus) =>
              update({ enclosureStatus: enclosureStatus as ZoneNode['enclosureStatus'] })
            }
            options={[
              { label: 'Auto-detect', value: 'auto' },
              { label: 'Enclosed', value: 'enclosed' },
              { label: 'Open', value: 'open' },
            ]}
            value={zone.enclosureStatus}
          />
          <RoomTextField
            label="Occupancy / use"
            onCommit={(occupancy) => update({ occupancy })}
            value={zone.occupancy}
          />
          <RoomTextField
            label="Floor finish"
            onCommit={(floorFinish) => update({ floorFinish })}
            value={zone.floorFinish}
          />
          <RoomTextField
            label="Wall finish"
            onCommit={(wallFinish) => update({ wallFinish })}
            value={zone.wallFinish}
          />
          <RoomTextField
            label="Ceiling finish"
            onCommit={(ceilingFinish) => update({ ceilingFinish })}
            value={zone.ceilingFinish}
          />
          <MetricControl
            label="Ceiling height"
            max={20}
            min={0.1}
            onChange={(ceilingHeight) => update({ ceilingHeight })}
            precision={2}
            step={0.05}
            unit="m"
            value={zone.ceilingHeight}
          />
          <RoomSelect
            label="Clear dimensions"
            onChange={(clearDimensionPolicy) =>
              update({
                clearDimensionPolicy: clearDimensionPolicy as ZoneNode['clearDimensionPolicy'],
              })
            }
            options={[
              { label: 'None', value: 'none' },
              { label: 'Inside faces', value: 'inside-faces' },
              { label: 'Finish faces', value: 'finish-faces' },
            ]}
            value={zone.clearDimensionPolicy}
          />
        </>
      ) : null}
    </PanelSection>
  )
}

export default function ZoneQuantitiesPanel() {
  const selectedZoneId = useViewer((state) => state.selection.zoneId)
  const unit = useViewer((state) => state.unit)
  const metricNotation = useViewer((state) => state.metricNotation)
  const nodes = useScene((state) => state.nodes)
  const registryVersion = useRegistryVersion()
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
  const takeoffReports = useMemo(() => {
    if (!effectiveZone) return []
    // Track registry version to re-derive takeoff reports when plugins load asynchronously
    void registryVersion
    return resolveZoneTakeoffReports(effectiveNodes, effectiveZone)
  }, [effectiveNodes, effectiveZone, registryVersion])

  if (!effectiveZone || !report) return null

  return (
    <>
      <RoomDocumentationPanel zone={effectiveZone} />
      {takeoffReports.map((takeoff) => (
        <ZoneTakeoffSection key={takeoff.id} report={takeoff} />
      ))}
      <PanelSection
        title={effectiveZone.spaceRole === 'room' ? 'Room quantities' : 'Zone quantities'}
      >
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
            <span>{formatLinearMeasurement(report.perimeter, unit, metricNotation)}</span>
          </div>
        </div>

        <ZonePlanSketch
          edgeLengths={report.edgeLengths}
          metricNotation={metricNotation}
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

      <ZoneContentsSection zone={effectiveZone} />
    </>
  )
}

function ZoneTakeoffSection({ report }: { report: ZoneTakeoffReport }) {
  return (
    <PanelSection title={report.title}>
      {report.metrics.length > 0 && (
        <div className="grid grid-cols-2 gap-1.5">
          {report.metrics.map((metric) => (
            <div
              key={metric.key}
              className="flex flex-col justify-between rounded-md border border-cyan-950/20 bg-[#f8faf7] p-2 text-slate-950 dark:border-border/60 dark:bg-card dark:text-card-foreground shadow-2xs"
            >
              <div className="flex items-center justify-between gap-1 text-muted-foreground text-[10px]">
                <span className="truncate">{metric.label}</span>
                {metric.abbreviation && (
                  <span className="font-mono text-[9px] text-cyan-800 dark:text-cyan-400 font-semibold">
                    {metric.abbreviation}
                  </span>
                )}
              </div>
              <div className="mt-1 flex items-baseline gap-1">
                <span className="font-semibold font-mono text-base tracking-tight text-foreground tabular-nums">
                  {typeof metric.value === 'number' ? metric.value.toLocaleString() : metric.value}
                </span>
              </div>
              {metric.sublabel && (
                <span className="mt-0.5 truncate text-[9px] text-muted-foreground">
                  {metric.sublabel}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {report.breakdown && report.breakdown.length > 0 && (
        <div className="flex flex-col gap-1.5 pt-1">
          <div className="font-medium text-[11px] text-muted-foreground">Detailed breakdown</div>
          {report.breakdown.map((item) => (
            <div
              key={item.id}
              className="flex flex-col rounded-md border border-border/50 bg-muted/20 px-2.5 py-1.5 text-xs"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium text-foreground">{item.label}</span>
                <span className="shrink-0 font-mono text-muted-foreground tabular-nums">
                  {typeof item.count === 'number' ? item.count.toLocaleString() : item.count}
                </span>
              </div>
              {item.details && (
                <div className="mt-0.5 text-[10px] text-muted-foreground">{item.details}</div>
              )}
              {item.submetrics && item.submetrics.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 border-border/40 border-t pt-1 font-mono text-[10px] text-muted-foreground">
                  {item.submetrics.map((sub, sIdx) => (
                    <span key={sIdx}>
                      <span className="text-muted-foreground/70">{sub.label}: </span>
                      <span className="text-foreground">
                        {typeof sub.value === 'number' ? sub.value.toLocaleString() : sub.value}
                      </span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </PanelSection>
  )
}

/**
 * What is standing in this zone, grouped by kind.
 *
 * Grouped rather than listed one row per node: a zone of racking is a hundred
 * identical entries, and "Pallet Rack x 96" is the answer to "what is in here",
 * where ninety-six rows of the same words is not.
 */
function ZoneContentsSection({ zone }: { zone: ZoneNode | undefined }) {
  /**
   * The selector returns STRINGS, and the grouping happens outside it.
   *
   * `useShallow` compares array elements with `Object.is`, so a selector that
   * builds fresh `{ label, count }` objects is never equal to its own previous
   * result. The snapshot then counts as changed on every render, which is an
   * infinite render loop — React 185, and the panel took the whole editor down
   * with it. Every other `useShallow` in this codebase maps ids to nodes that
   * already exist; none constructs a new object, and that is the reason.
   *
   * `effectiveZone` rather than the stored zone, so the count tracks the
   * polygon actually on screen while a zone is dragged or is derived from its
   * boundary walls.
   */
  const labels = useScene(
    useShallow((state) =>
      zone ? collectZoneObjectLabels(state.nodes, zone, resolveNodeDisplayName) : [],
    ),
  )

  const groups = useMemo(() => {
    const counts = new Map<string, number>()
    for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1)
    return [...counts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
  }, [labels])

  const total = labels.length

  return (
    <PanelSection title="Zone contents">
      {groups.length === 0 ? (
        <p className="text-muted-foreground text-xs">Nothing standing in this zone.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {groups.map((group) => (
            <div className="flex items-baseline justify-between gap-3 text-xs" key={group.label}>
              <span className="min-w-0 truncate text-foreground">{group.label}</span>
              <span className="shrink-0 font-mono text-muted-foreground tabular-nums">
                {group.count}
              </span>
            </div>
          ))}
          <div className="mt-1 flex items-baseline justify-between gap-3 border-border/50 border-t pt-1.5 text-xs">
            <span className="text-muted-foreground">Total</span>
            <span className="shrink-0 font-mono text-foreground tabular-nums">{total}</span>
          </div>
        </div>
      )}
    </PanelSection>
  )
}
