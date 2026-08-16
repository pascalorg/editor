'use client'

import { readSiteZoning, type SiteNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useMemo } from 'react'
import { formatAreaLabel, formatLinearMeasurement } from '../../../../../lib/measurements'
import { MetricControl } from '../../../controls/metric-control'
import { PanelSection } from '../../../controls/panel-section'
import { cn } from '../../../../../lib/utils'
import { AlertCircle, CheckCircle2 } from 'lucide-react'

export function ZoningSection() {
  const unit = useViewer((state) => state.unit)
  const metricNotation = useViewer((state) => state.metricNotation)
  const nodes = useScene((state) => state.nodes)
  const rootNodeIds = useScene((state) => state.rootNodeIds)
  const updateNode = useScene((state) => state.updateNode)

  const siteNode = rootNodeIds[0] ? nodes[rootNodeIds[0]] : undefined
  const site = siteNode?.type === 'site' ? (siteNode as SiteNode) : undefined
  const siteId = site?.id

  const reading = useMemo(() => readSiteZoning(nodes), [nodes])
  const zoning = site?.zoning

  if (!site) return null

  const updateZoning = (patch: Partial<NonNullable<SiteNode['zoning']>>) => {
    updateNode(site.id, {
      zoning: { ...site.zoning, ...patch },
    })
  }

  // Evaluate limits
  const parcelArea = site.parcel?.registeredArea ?? 0 // Note: Maybe we should use measured area? The user said registeredArea doesn't need to be converted. Let's use computed area if registeredArea is absent.
  // Actually, let's calculate parcelArea from site polygon.
  // Wait, I can use readSiteBuildable to get parcelArea, or just polygonArea(site.polygon.points).
  const polygonArea = (points: [number, number][]) => {
    if (points.length < 3) return 0
    let area = 0
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length
      area += points[i]![0] * points[j]![1] - points[j]![0] * points[i]![1]
    }
    return Math.abs(area) / 2
  }
  const siteArea = site.polygon?.points ? polygonArea(site.polygon.points) : 0
  const referenceArea = site.parcel?.registeredArea ?? siteArea

  const taksLimit = zoning?.taks ? referenceArea * zoning.taks : undefined
  const kaksLimit = zoning?.kaks ? referenceArea * zoning.kaks : undefined

  const taksExceeded = taksLimit !== undefined && reading.footprintArea > taksLimit
  const kaksExceeded = kaksLimit !== undefined && reading.totalFloorArea > kaksLimit
  const heightExceeded = zoning?.maxHeight !== undefined && reading.maxHeight > zoning.maxHeight
  const floorsExceeded = zoning?.maxFloors !== undefined && reading.maxFloors > zoning.maxFloors

  return (
    <PanelSection title="Zoning Limits">
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2">
          <MetricControl
            label="TAKS"
            min={0}
            max={1}
            onChange={(taks) => updateZoning({ taks })}
            precision={2}
            step={0.05}
            unit=""
            value={zoning?.taks ?? 0}
          />
          <MetricControl
            label="KAKS (Emsal)"
            min={0}
            onChange={(kaks) => updateZoning({ kaks })}
            precision={2}
            step={0.1}
            unit=""
            value={zoning?.kaks ?? 0}
          />
          <MetricControl
            label="Hmax"
            min={0}
            onChange={(maxHeight) => updateZoning({ maxHeight })}
            precision={2}
            step={0.5}
            unit="m"
            value={zoning?.maxHeight ?? 0}
          />
          <MetricControl
            label="Floors"
            min={1}
            onChange={(maxFloors) => updateZoning({ maxFloors })}
            precision={0}
            step={1}
            unit=""
            value={zoning?.maxFloors ?? 0}
          />
        </div>

        <div className="flex flex-col gap-2 rounded-md border border-border/50 bg-accent/30 p-2 text-xs">
          <div className="font-medium text-foreground mb-1">Building Status</div>
          
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground flex items-center gap-1.5">
              Footprint (TAKS)
            </span>
            <div className="flex items-center gap-2">
              <span className={cn(taksExceeded ? "text-red-500 font-medium" : "text-foreground")}>
                {formatAreaLabel(reading.footprintArea, unit, 2)}
              </span>
              {zoning?.taks !== undefined && (
                <>
                  <span className="text-muted-foreground">/</span>
                  <span className="text-muted-foreground">{formatAreaLabel(taksLimit ?? 0, unit, 2)}</span>
                  {taksExceeded ? <AlertCircle className="h-3.5 w-3.5 text-red-500" /> : <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
                </>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-muted-foreground flex items-center gap-1.5">
              Total Area (KAKS)
            </span>
            <div className="flex items-center gap-2">
              <span className={cn(kaksExceeded ? "text-red-500 font-medium" : "text-foreground")}>
                {formatAreaLabel(reading.totalFloorArea, unit, 2)}
              </span>
              {zoning?.kaks !== undefined && (
                <>
                  <span className="text-muted-foreground">/</span>
                  <span className="text-muted-foreground">{formatAreaLabel(kaksLimit ?? 0, unit, 2)}</span>
                  {kaksExceeded ? <AlertCircle className="h-3.5 w-3.5 text-red-500" /> : <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
                </>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-muted-foreground flex items-center gap-1.5">
              Height
            </span>
            <div className="flex items-center gap-2">
              <span className={cn(heightExceeded ? "text-red-500 font-medium" : "text-foreground")}>
                {formatLinearMeasurement(reading.maxHeight, unit, metricNotation)}
              </span>
              {zoning?.maxHeight !== undefined && (
                <>
                  <span className="text-muted-foreground">/</span>
                  <span className="text-muted-foreground">{formatLinearMeasurement(zoning.maxHeight, unit, metricNotation)}</span>
                  {heightExceeded ? <AlertCircle className="h-3.5 w-3.5 text-red-500" /> : <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
                </>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-muted-foreground flex items-center gap-1.5">
              Floors
            </span>
            <div className="flex items-center gap-2">
              <span className={cn(floorsExceeded ? "text-red-500 font-medium" : "text-foreground")}>
                {reading.maxFloors}
              </span>
              {zoning?.maxFloors !== undefined && (
                <>
                  <span className="text-muted-foreground">/</span>
                  <span className="text-muted-foreground">{zoning.maxFloors}</span>
                  {floorsExceeded ? <AlertCircle className="h-3.5 w-3.5 text-red-500" /> : <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
                </>
              )}
            </div>
          </div>
        </div>

        {(taksExceeded || kaksExceeded || heightExceeded || floorsExceeded) && (
          <div className="rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-700 dark:text-red-300">
            Current design exceeds zoning limits.
          </div>
        )}
      </div>
    </PanelSection>
  )
}
