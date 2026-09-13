'use client'

/**
 * The Lot rail panel: address or preset → the real parcel, the streets, the
 * front edge and the setbacks land on the site node. Generate then places
 * the house on the envelope facing the street.
 */
import { MapPinned } from 'lucide-react'
import { LotAddressBox } from './address-box'
import { useLot } from './store'

const row = 'flex items-center justify-between gap-3 text-xs'
const muted = 'text-sidebar-foreground/60'

export default function LotPanel() {
  const last = useLot((s) => s.last)
  const summary = last?.ok ? last.summary : null
  return (
    <div className="flex flex-col text-sidebar-foreground">
      <div className="p-3">
        <div className="mb-1 flex items-center gap-2 font-semibold text-sm">
          <MapPinned className="h-4 w-4" /> Lot
        </div>
        <p className="text-[11px] text-sidebar-foreground/60">
          Type an address or pick a preset lot: the recorded parcel ring, APN and zoning come from
          the public GIS layer, the streets around it from OpenStreetMap, and the street-facing
          edge, north and the planning-default setbacks are set for you.
        </p>
      </div>
      <div className="px-3 pb-3">
        <LotAddressBox />
      </div>
      {summary ? (
        <div className="border-sidebar-border/50 border-t p-3">
          <div className="mb-2 font-mono text-[10px] text-sidebar-foreground/60 uppercase tracking-wider">
            Parcel
          </div>
          <div className="flex flex-col gap-1">
            <div className={row}>
              <span className={muted}>APN</span>
              <span className="truncate font-medium">{summary.apn || '—'}</span>
            </div>
            <div className={row}>
              <span className={muted}>County</span>
              <span className="truncate font-medium">
                {[summary.county, summary.state].filter(Boolean).join(', ') || '—'}
              </span>
            </div>
            <div className={row}>
              <span className={muted}>Lot area</span>
              <span className="font-medium">
                {summary.lotAreaSqFt
                  ? `${Math.round(summary.lotAreaSqFt).toLocaleString('en-US')} sq ft`
                  : '—'}
              </span>
            </div>
            <div className={row}>
              <span className={muted}>Front edge</span>
              <span className="truncate font-medium">
                {summary.frontEdge !== null
                  ? `edge ${summary.frontEdge + 1} — ${summary.frontStreet ?? 'unnamed street'}`
                  : 'most north-facing'}
              </span>
            </div>
            <div className={row}>
              <span className={muted}>Streets mapped</span>
              <span className="font-medium">{summary.roadsFound}</span>
            </div>
            <div className={row}>
              <span className={muted}>Setbacks</span>
              <span className="font-medium">
                {summary.setbacksDefaulted ? 'default 20 / 5 / 15 ft' : 'as set on the site'}
              </span>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-sidebar-foreground/60 leading-snug">
            {summary.notes.join(' ')}
          </p>
        </div>
      ) : null}
      <div className="border-sidebar-border/50 border-t p-3 text-[11px] text-sidebar-foreground/50">
        Next: Generate → Generate house places a house on the buildable envelope, square to the
        street. Setbacks, the zone and the street side can be changed in the Site panel; the site
        plan sheet draws all of it. Parcel geometry from a public GIS service is not a survey.
      </div>
    </div>
  )
}
