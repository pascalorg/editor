'use client'

import {
  polygonEdgeLengths,
  readSiteBuildable,
  SETBACK_ROLE_PRESETS,
  type SetbackRule,
  type SiteNode,
  setbackRuleForEdge,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo } from 'react'
import { formatAreaLabel, formatLinearMeasurement } from '../../../../../lib/measurements'
import { cn } from '../../../../../lib/utils'
import useSetbackEdgeFocus from '../../../../../store/use-setback-edge-focus'
import { ActionButton, ActionGroup } from '../../../controls/action-button'
import { MetricControl } from '../../../controls/metric-control'
import { PanelSection } from '../../../controls/panel-section'
import { SegmentedControl } from '../../../controls/segmented-control'

const ROLE_OPTIONS: Array<{ label: string; value: SetbackRule['role'] }> = [
  { label: 'Road', value: 'road' },
  { label: 'Neighbour', value: 'side' },
  { label: 'Rear', value: 'rear' },
]

function ParcelFacts({
  parcel,
  computedArea,
  unit,
}: {
  parcel: NonNullable<SiteNode['parcel']>
  computedArea: string
  unit: import('../../../../../lib/measurements').LinearUnit
}) {
  const rows: Array<[string, string]> = [
    ['Location', [parcel.il, parcel.ilce, parcel.mahalle].filter(Boolean).join(' / ')],
    ['Block / parcel', `${parcel.ada} / ${parcel.parsel}`],
  ]
  if (parcel.nitelik) rows.push(['Quality', parcel.nitelik])
  if (parcel.pafta) rows.push(['Sheet', parcel.pafta])
  if (parcel.registeredArea !== undefined) {
    rows.push(['Registered area', formatAreaLabel(parcel.registeredArea, unit, 2)])
  }
  rows.push(['Measured area', computedArea])

  return (
    <div className="flex flex-col gap-1">
      {rows.map(([label, value]) => (
        <div className="flex items-baseline gap-2 text-xs" key={label}>
          <span className="text-muted-foreground">{label}</span>
          <span className="ml-auto text-right font-medium text-foreground">{value}</span>
        </div>
      ))}
    </div>
  )
}

export function ParcelSetbackSection() {
  const unit = useViewer((state) => state.unit)
  const metricNotation = useViewer((state) => state.metricNotation)
  const nodes = useScene((state) => state.nodes)
  const rootNodeIds = useScene((state) => state.rootNodeIds)
  const updateNode = useScene((state) => state.updateNode)

  const siteNode = rootNodeIds[0] ? nodes[rootNodeIds[0]] : undefined
  const site = siteNode?.type === 'site' ? (siteNode as SiteNode) : undefined
  const siteId = site?.id

  // The same live polygon the two overlays read, so a boundary drag moves the
  // edge lengths and the buildable reading in step with the drawing.
  const livePolygon = useLiveNodeOverrides((state) =>
    siteId ? (state.overrides.get(siteId)?.polygon as SiteNode['polygon'] | undefined) : undefined,
  )
  const points = livePolygon?.points ?? site?.polygon?.points

  const hoveredEdge = useSetbackEdgeFocus((state) => state.hoveredEdge)
  const selectedEdge = useSetbackEdgeFocus((state) => state.selectedEdge)
  const setHoveredEdge = useSetbackEdgeFocus((state) => state.setHoveredEdge)
  const setSelectedEdge = useSetbackEdgeFocus((state) => state.setSelectedEdge)
  const clearFocus = useSetbackEdgeFocus((state) => state.clear)

  // A highlight left pointing at an edge of a polygon that no longer has one
  // would sit on whichever edge inherited the index.
  useEffect(() => clearFocus, [clearFocus])

  const edgeLengths = useMemo(() => polygonEdgeLengths(points), [points])
  const reading = useMemo(() => readSiteBuildable(points, site), [points, site])

  if (!(site && points && points.length >= 3)) return null

  const setSetback = (edgeIndex: number, patch: Partial<SetbackRule>) => {
    const current = setbackRuleForEdge(site, edgeIndex)
    updateNode(site.id, {
      setbacks: { ...site.setbacks, [String(edgeIndex)]: { ...current, ...patch } },
    })
  }

  // One `updateNode`, so one history entry — the drag itself is already a
  // single step because `MetricControl` pauses and replays the temporal store
  // around it.
  const applyToAll = (distance: number) => {
    const setbacks: Record<string, SetbackRule> = {}
    for (let index = 0; index < points.length; index += 1) {
      setbacks[String(index)] = { ...setbackRuleForEdge(site, index), distance }
    }
    updateNode(site.id, { setbacks, defaultSetback: distance })
  }

  const measuredArea = formatAreaLabel(reading.parcelArea, unit, 2)
  const buildableShare =
    reading.parcelArea > 0 ? Math.round((reading.buildableArea / reading.parcelArea) * 100) : 0
  const noBuildableGround = reading.hasSetback && reading.rings.length === 0

  return (
    <>
      {site.parcel && (
        <PanelSection title="Parcel">
          <ParcelFacts computedArea={measuredArea} parcel={site.parcel} unit={unit} />
          <div
            className={cn(
              'rounded-md border px-2 py-1.5 text-[10px] leading-relaxed',
              site.parcel.edited
                ? 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300'
                : 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
            )}
          >
            {site.parcel.edited
              ? 'Edited by hand — no longer the registry outline.'
              : 'Land registry reference data — not a surveyed site plan.'}
          </div>
        </PanelSection>
      )}

      <PanelSection title="Setbacks">
        <div className="flex flex-col gap-1">
          {points.map((_, edgeIndex) => {
            const rule = setbackRuleForEdge(site, edgeIndex)
            const isFocused = (hoveredEdge ?? selectedEdge) === edgeIndex
            return (
              <div
                className={cn(
                  'rounded-md border px-2 py-1.5 transition-colors',
                  isFocused ? 'border-cyan-500/60 bg-cyan-500/10' : 'border-border/50',
                )}
                key={edgeIndex}
                onPointerEnter={() => setHoveredEdge(edgeIndex)}
                onPointerLeave={() => setHoveredEdge(null)}
              >
                <button
                  className="flex w-full items-baseline gap-2 text-left"
                  onClick={() => setSelectedEdge(selectedEdge === edgeIndex ? null : edgeIndex)}
                  type="button"
                >
                  {/* The word and the number are separate children on purpose:
                      the dictionary is keyed by exact English source strings, so
                      an interpolated "Edge 3" could never match an entry. */}
                  <span className="font-medium text-foreground text-xs">Edge</span>
                  <span className="font-mono text-foreground text-xs">{edgeIndex + 1}</span>
                  <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                    {formatLinearMeasurement(edgeLengths[edgeIndex] ?? 0, unit, metricNotation)}
                  </span>
                </button>
                <SegmentedControl
                  className="mt-1.5 h-7"
                  onChange={(role) =>
                    setSetback(edgeIndex, { role, distance: SETBACK_ROLE_PRESETS[role] })
                  }
                  options={ROLE_OPTIONS}
                  value={rule.role}
                />
                <MetricControl
                  label="Distance"
                  min={0}
                  onChange={(distance) => setSetback(edgeIndex, { distance })}
                  precision={2}
                  step={0.25}
                  unit="m"
                  value={rule.distance}
                />
              </div>
            )
          })}
        </div>

        <ActionGroup>
          <ActionButton
            label="Apply to all edges"
            onClick={() =>
              applyToAll(setbackRuleForEdge(site, selectedEdge ?? hoveredEdge ?? 0).distance)
            }
          />
        </ActionGroup>

        <div className="flex flex-col gap-1 border-border/50 border-t pt-2">
          <div className="flex items-baseline gap-2 text-xs">
            <span className="text-muted-foreground">Parcel area</span>
            <span className="ml-auto font-medium text-foreground">{measuredArea}</span>
          </div>
          {noBuildableGround ? (
            <div className="rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-700 dark:text-red-300">
              No buildable ground is left after these setbacks.
            </div>
          ) : (
            <div className="flex items-baseline gap-2 text-xs">
              <span className="text-muted-foreground">Buildable area</span>
              <span className="ml-auto font-medium text-foreground">
                {formatAreaLabel(reading.buildableArea, unit, 2)}
              </span>
              <span className="font-mono text-[10px] text-muted-foreground">{buildableShare}%</span>
            </div>
          )}
        </div>

        <p className="text-[10px] text-muted-foreground leading-relaxed">
          The presets are common values. The binding distances are the ones on your municipality's
          zoning certificate.
        </p>
      </PanelSection>
    </>
  )
}
