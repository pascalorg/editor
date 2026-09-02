'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type BuildingNode,
  type SiteNode,
  useScene,
} from '@pascal-app/core'
import {
  ActionButton,
  ActionGroup,
  buildingRecentreOffset,
  buildSitePlanDrawing,
  describeSiteEdges,
  PanelSection,
  PanelWrapper,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { MapPin, Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const METRES_PER_FOOT = 0.3048

interface Suggestion {
  label?: string
  line1?: string
  line2?: string
  city?: string
  state?: string
  postcode?: string
  lat?: number
  lng?: number
}

interface ResolveResponse {
  ok: boolean
  error?: string
  apn?: string
  county?: string
  state?: string
  zip?: string
  zoning?: string
  lotAreaSqFt?: number
  originLngLat?: [number, number]
  geocodedBy?: string
  matchPrecision?: string
  notes?: string[]
  polygonM?: [number, number][]
}

/**
 * Site inspector — address → real parcel, plus the zoning inputs the site
 * plan draws from. Mounted through `siteParametrics.customPanel`.
 *
 * The parcel lookup runs entirely inside this app (`/api/parcel/*`, backed by
 * the vendored `server-parcel.cjs`); no key is required for the Census / Esri
 * / ArcGIS paths that serve US lots.
 */
export function SiteNodePanel() {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  // The selected site node, else THE site node: the sidebar's Site header
  // mounts this panel directly, where nothing may be selected.
  const node = useScene((s) => {
    const selected = selectedId ? (s.nodes[selectedId as AnyNode['id']] as AnyNode | undefined) : undefined
    if (selected?.type === 'site') return selected as SiteNode
    for (const id of s.rootNodeIds) {
      const n = s.nodes[id as AnyNode['id']] as AnyNode | undefined
      if (n?.type === 'site') return n as SiteNode
    }
    return undefined
  })

  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [picked, setPicked] = useState<Suggestion | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const requestSeq = useRef(0)

  const update = useCallback(
    (patch: Partial<SiteNode>) => {
      if (!node) return
      useScene.getState().updateNode(node.id, patch)
    },
    [node],
  )

  // Seed the address box from the node so reopening the panel shows what the
  // lot was resolved from.
  useEffect(() => {
    if (!node?.address) return
    const parts = [node.address.street, node.address.city, node.address.state, node.address.zip]
    setQuery((current) => current || parts.filter(Boolean).join(', '))
  }, [node?.address])

  // Debounced autocomplete. `seq` guards against an earlier response landing
  // after a later one.
  useEffect(() => {
    const q = query.trim()
    if (q.length < 4 || picked) {
      setSuggestions([])
      return
    }
    const seq = ++requestSeq.current
    const timer = setTimeout(() => {
      fetch(`/api/parcel/autocomplete?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((data: { suggestions?: Suggestion[] }) => {
          if (seq !== requestSeq.current) return
          setSuggestions(Array.isArray(data.suggestions) ? data.suggestions : [])
        })
        .catch(() => {
          if (seq === requestSeq.current) setSuggestions([])
        })
    }, 300)
    return () => clearTimeout(timer)
  }, [query, picked])

  const edges = useMemo(() => describeSiteEdges(node ?? null), [node])

  const findParcel = useCallback(async () => {
    if (!node) return
    const address = query.trim()
    if (!address) {
      setStatus('Type an address first.')
      return
    }
    setBusy(true)
    setStatus('Looking up the parcel…')
    try {
      const response = await fetch('/api/parcel/resolve', {
        body: JSON.stringify({
          address,
          ...(picked?.lat != null && picked?.lng != null
            ? { latitude: picked.lat, longitude: picked.lng, state: picked.state }
            : {}),
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      })
      const data = (await response.json()) as ResolveResponse
      if (!data.ok || !data.polygonM || data.polygonM.length < 3) {
        setStatus(data.error ? `No parcel: ${data.error}` : 'No parcel found for that address.')
        return
      }

      update({
        address: {
          street: picked?.line1 ?? address,
          city: picked?.city,
          state: data.state || picked?.state,
          zip: data.zip || picked?.postcode,
        },
        parcel: {
          apn: data.apn,
          county: data.county,
          layer: data.geocodedBy,
          lotAreaSqFt: data.lotAreaSqFt,
          notes: data.notes,
          originLngLat: data.originLngLat,
          resolvedAt: new Date().toISOString(),
          source: 'gis-parcel',
          state: data.state,
        },
        polygon: { points: data.polygonM, type: 'polygon' },
        ...(data.zoning && !node.zone ? { zone: data.zoning } : {}),
        // A new lot invalidates a front-edge index picked on the old ring.
        frontEdge: undefined,
      })

      // Centre the building on the lot when its footprint fell outside the new
      // ring. Writes `building.position` — never the walls.
      const scene = useScene.getState()
      const drawing = buildSitePlanDrawing({
        collections: scene.collections,
        installedPlugins: scene.installedPlugins,
        materials: scene.materials,
        nodes: scene.nodes,
        rootNodeIds: scene.rootNodeIds,
      })
      const offset = buildingRecentreOffset(drawing.meta.lot, drawing.meta.footprintBounds)
      let centred = false
      if (offset && drawing.meta.buildingId) {
        const building = scene.nodes[drawing.meta.buildingId as AnyNodeId] as
          | BuildingNode
          | undefined
        if (building) {
          scene.updateNode(building.id, {
            position: [
              building.position[0] + offset[0],
              building.position[1],
              building.position[2] + offset[1],
            ],
          })
          centred = true
        }
      }

      const area = data.lotAreaSqFt ? `${Math.round(data.lotAreaSqFt).toLocaleString()} sq ft` : ''
      setStatus(
        `Lot set — ${[data.apn ? `APN ${data.apn}` : '', area, data.county].filter(Boolean).join(' · ')}${
          centred ? ' · building re-centred' : ''
        }`,
      )
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Parcel lookup failed.')
    } finally {
      setBusy(false)
    }
  }, [node, picked, query, update])

  if (!node) return null

  const setbacks = node.setbacks
  const setbackField = (
    key: 'front' | 'side' | 'rear' | 'left' | 'right',
    label: string,
    optional = false,
  ) => (
    <label className="flex items-center justify-between gap-3 text-sm" key={key}>
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1">
        <input
          className="w-20 rounded-md border border-border/70 bg-background px-2 py-1 text-right text-foreground"
          defaultValue={
            setbacks?.[key] != null ? String(Math.round((setbacks[key] / METRES_PER_FOOT) * 10) / 10) : ''
          }
          inputMode="decimal"
          key={`${key}-${setbacks?.[key] ?? 'none'}`}
          onBlur={(event) => {
            const raw = event.target.value.trim()
            if (raw === '' && optional) {
              const next = { ...(setbacks ?? { front: 0, rear: 0, side: 0 }) }
              delete (next as Record<string, unknown>)[key]
              update({ setbacks: next })
              return
            }
            const feet = Number(raw)
            if (!Number.isFinite(feet) || feet < 0) return
            update({
              setbacks: {
                ...(setbacks ?? { front: 0, rear: 0, side: 0 }),
                [key]: feet * METRES_PER_FOOT,
              },
            })
          }}
          placeholder={optional ? 'side' : '0'}
        />
        <span className="text-muted-foreground text-xs">ft</span>
      </span>
    </label>
  )

  return (
    <PanelWrapper title="Site">
      <PanelSection title="Address">
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">Street address</span>
          <input
            className="w-full rounded-md border border-border/70 bg-background px-2 py-1.5 text-foreground"
            onChange={(event) => {
              setQuery(event.target.value)
              setPicked(null)
            }}
            placeholder="1200 W Cass St, Tampa, FL"
            value={query}
          />
        </label>
        {suggestions.length > 0 ? (
          <ul className="max-h-44 space-y-0.5 overflow-y-auto rounded-md border border-border/70 bg-card p-1">
            {suggestions.map((s) => (
              <li key={`${s.label}-${s.lat}-${s.lng}`}>
                <button
                  className="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-foreground text-xs hover:bg-muted"
                  onClick={() => {
                    setPicked(s)
                    setQuery(s.label ?? [s.line1, s.line2].filter(Boolean).join(', '))
                    setSuggestions([])
                  }}
                  type="button"
                >
                  <MapPin className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
                  <span>{s.label ?? [s.line1, s.line2].filter(Boolean).join(', ')}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <ActionGroup>
          <ActionButton
            disabled={busy}
            icon={<Search className="size-4" />}
            label={busy ? 'Finding…' : 'Find parcel'}
            onClick={findParcel}
          />
        </ActionGroup>
        {status ? <p className="text-muted-foreground text-xs">{status}</p> : null}
      </PanelSection>

      {node.parcel ? (
        <PanelSection title="Parcel">
          <Row label="APN" value={node.parcel.apn || '—'} />
          <Row label="County" value={node.parcel.county || '—'} />
          <Row
            label="Lot area"
            value={
              node.parcel.lotAreaSqFt
                ? `${Math.round(node.parcel.lotAreaSqFt).toLocaleString()} sq ft`
                : '—'
            }
          />
          <Row label="Source" value={node.parcel.layer || node.parcel.source || '—'} />
          {node.parcel.notes?.length ? (
            <p className="text-muted-foreground text-xs leading-snug">
              {node.parcel.notes.join(' ')}
            </p>
          ) : null}
        </PanelSection>
      ) : null}

      <PanelSection title="Setbacks">
        {setbackField('front', 'Front')}
        {setbackField('side', 'Side')}
        {setbackField('rear', 'Rear')}
        {setbackField('left', 'Left (override)', true)}
        {setbackField('right', 'Right (override)', true)}
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">Source / citation</span>
          <input
            className="w-full rounded-md border border-border/70 bg-background px-2 py-1.5 text-foreground"
            defaultValue={node.setbacksSource ?? ''}
            key={node.setbacksSource ?? ''}
            onBlur={(event) => update({ setbacksSource: event.target.value || undefined })}
            placeholder="e.g. Tampa LDC §27-156"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">Zone</span>
          <input
            className="w-full rounded-md border border-border/70 bg-background px-2 py-1.5 text-foreground"
            defaultValue={node.zone ?? ''}
            key={node.zone ?? ''}
            onBlur={(event) => update({ zone: event.target.value || undefined })}
            placeholder="e.g. RS-60"
          />
        </label>
      </PanelSection>

      <PanelSection title="Orientation">
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">Front (street) edge</span>
          <select
            className="w-full rounded-md border border-border/70 bg-background px-2 py-1.5 text-foreground"
            onChange={(event) =>
              update({
                frontEdge: event.target.value === '' ? undefined : Number(event.target.value),
              })
            }
            value={node.frontEdge == null ? '' : String(node.frontEdge)}
          >
            <option value="">Auto — most north-facing edge</option>
            {edges.map((edge) => (
              <option key={edge.index} value={String(edge.index)}>
                {edge.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground">North rotation</span>
          <span className="flex items-center gap-1">
            <input
              className="w-20 rounded-md border border-border/70 bg-background px-2 py-1 text-right text-foreground"
              defaultValue={String(
                Math.round(((node.northRotation ?? 0) * 180) / Math.PI * 10) / 10,
              )}
              inputMode="decimal"
              key={String(node.northRotation ?? 0)}
              onBlur={(event) => {
                const deg = Number(event.target.value.trim())
                if (!Number.isFinite(deg)) return
                update({ northRotation: (deg * Math.PI) / 180 })
              }}
            />
            <span className="text-muted-foreground text-xs">°</span>
          </span>
        </label>
      </PanelSection>
    </PanelWrapper>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate font-medium text-foreground">{value}</span>
    </div>
  )
}

export default SiteNodePanel
