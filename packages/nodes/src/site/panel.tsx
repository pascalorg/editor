'use client'

import { type AnyNode, type SiteNode, usePascalI18n, useScene } from '@pascal-app/core'
import {
  ActionButton,
  ActionGroup,
  describeSiteEdges,
  dropInLot,
  PanelSection,
  PanelWrapper,
  useParcelProvider,
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

/**
 * Site inspector — address → real parcel, plus the zoning inputs the site
 * plan draws from. Mounted through `siteParametrics.customPanel`.
 *
 * The address lookup goes through the host's parcel provider
 * (`setParcelProvider`) and is hidden when the host has none.
 */
export function SiteNodePanel() {
  const i18n = usePascalI18n()
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  // The selected site node, else THE site node: the sidebar's Site header
  // mounts this panel directly, where nothing may be selected.
  const node = useScene((s) => {
    const selected = selectedId
      ? (s.nodes[selectedId as AnyNode['id']] as AnyNode | undefined)
      : undefined
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
  const parcelProvider = useParcelProvider()

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
    if (!parcelProvider || q.length < 4 || picked) {
      setSuggestions([])
      return
    }
    const seq = ++requestSeq.current
    const timer = setTimeout(() => {
      parcelProvider('autocomplete', { q })
        .then((data) => {
          if (seq !== requestSeq.current) return
          const list = (data as { suggestions?: Suggestion[] } | null)?.suggestions
          setSuggestions(Array.isArray(list) ? list : [])
        })
        .catch(() => {
          if (seq === requestSeq.current) setSuggestions([])
        })
    }, 300)
    return () => clearTimeout(timer)
  }, [parcelProvider, query, picked])

  const edges = useMemo(() => describeSiteEdges(node ?? null), [node])

  // One engine for every path (Lot panel, Generate, here): resolve the
  // parcel, map the streets, pick the street-facing edge, default the
  // setbacks when the site has none, re-centre a building that fell outside
  // the new ring. See @pascal-app/editor `dropInLot`.
  const findParcel = useCallback(async () => {
    if (!node) return
    const address = query.trim()
    if (!address) {
      setStatus(
        i18n._({ id: 'node.site.panel.typeAnAddressFirst', message: 'Type an address first.' }),
      )
      return
    }
    setBusy(true)
    setStatus(
      i18n._({
        id: 'node.site.panel.lookingUpTheParcel',
        message: 'Looking up the parcel and the streets around it…',
      }),
    )
    try {
      const result = await dropInLot(
        {
          address,
          ...(picked?.lat != null && picked?.lng != null
            ? { latitude: picked.lat, longitude: picked.lng, state: picked.state }
            : {}),
          street: picked?.line1,
          city: picked?.city,
          zip: picked?.postcode,
        },
        { siteId: node.id },
      )
      setStatus(result.message)
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : i18n._({ id: 'node.site.panel.parcelLookupFailed', message: 'Parcel lookup failed.' }),
      )
    } finally {
      setBusy(false)
    }
  }, [node, picked, query, i18n])

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
            setbacks?.[key] != null
              ? String(Math.round((setbacks[key] / METRES_PER_FOOT) * 10) / 10)
              : ''
          }
          inputMode="decimal"
          onFocus={(event) => event.target.select()}
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
          placeholder={optional ? i18n._({ id: 'node.site.panel.side', message: 'side' }) : '0'}
        />
        <span className="text-muted-foreground text-xs">ft</span>
      </span>
    </label>
  )

  return (
    <PanelWrapper title={i18n._({ id: 'node.site.panel.site', message: 'Site' })}>
      {parcelProvider ? (
        <PanelSection title={i18n._({ id: 'node.site.panel.address', message: 'Address' })}>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">
              {i18n._({ id: 'node.site.panel.streetAddress', message: 'Street address' })}
            </span>
            <input
              className="w-full rounded-md border border-border/70 bg-background px-2 py-1.5 text-foreground"
              onChange={(event) => {
                setQuery(event.target.value)
                setPicked(null)
              }}
              placeholder={i18n._({
                id: 'node.site.panel.n1200WCassStTampaFl',
                message: '1200 W Cass St, Tampa, FL',
              })}
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
              label={
                busy
                  ? i18n._({ id: 'node.site.panel.finding', message: 'Finding…' })
                  : i18n._({ id: 'node.site.panel.findParcel', message: 'Find parcel' })
              }
              onClick={findParcel}
            />
          </ActionGroup>
          {status ? <p className="text-muted-foreground text-xs">{status}</p> : null}
        </PanelSection>
      ) : null}

      {node.parcel ? (
        <PanelSection title={i18n._({ id: 'node.site.panel.parcel', message: 'Parcel' })}>
          <Row
            label={i18n._({ id: 'node.site.panel.apn', message: 'APN' })}
            value={node.parcel.apn || '—'}
          />
          <Row
            label={i18n._({ id: 'node.site.panel.county', message: 'County' })}
            value={node.parcel.county || '—'}
          />
          <Row
            label={i18n._({ id: 'node.site.panel.lotArea', message: 'Lot area' })}
            value={
              node.parcel.lotAreaSqFt
                ? `${Math.round(node.parcel.lotAreaSqFt).toLocaleString()} sq ft`
                : '—'
            }
          />
          <Row
            label={i18n._({ id: 'node.site.panel.source', message: 'Source' })}
            value={node.parcel.layer || node.parcel.source || '—'}
          />
          {node.parcel.notes?.length ? (
            <p className="text-muted-foreground text-xs leading-snug">
              {node.parcel.notes.join(' ')}
            </p>
          ) : null}
        </PanelSection>
      ) : null}

      <PanelSection title={i18n._({ id: 'node.site.panel.setbacks', message: 'Setbacks' })}>
        {setbackField('front', i18n._({ id: 'node.site.setback.front', message: 'Front' }))}
        {setbackField('side', i18n._({ id: 'node.site.setback.side', message: 'Side' }))}
        {setbackField('rear', i18n._({ id: 'node.site.setback.rear', message: 'Rear' }))}
        {setbackField(
          'left',
          i18n._({ id: 'node.site.setback.leftOverride', message: 'Left (override)' }),
          true,
        )}
        {setbackField(
          'right',
          i18n._({ id: 'node.site.setback.rightOverride', message: 'Right (override)' }),
          true,
        )}
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">
            {i18n._({ id: 'node.site.panel.sourceCitation', message: 'Source / citation' })}
          </span>
          <input
            className="w-full rounded-md border border-border/70 bg-background px-2 py-1.5 text-foreground"
            defaultValue={node.setbacksSource ?? ''}
            key={node.setbacksSource ?? ''}
            onBlur={(event) => update({ setbacksSource: event.target.value || undefined })}
            placeholder={i18n._({
              id: 'node.site.panel.eGTampaLdc27156',
              message: 'e.g. Tampa LDC §27-156',
            })}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">
            {i18n._({ id: 'node.site.panel.zone', message: 'Zone' })}
          </span>
          <input
            className="w-full rounded-md border border-border/70 bg-background px-2 py-1.5 text-foreground"
            defaultValue={node.zone ?? ''}
            key={node.zone ?? ''}
            onBlur={(event) => update({ zone: event.target.value || undefined })}
            placeholder={i18n._({ id: 'node.site.panel.eGRs60', message: 'e.g. RS-60' })}
          />
        </label>
      </PanelSection>

      <PanelSection title={i18n._({ id: 'node.site.panel.projectLook', message: 'Project look' })}>
        <p className="text-muted-foreground text-xs">
          {i18n._({
            id: 'node.site.panel.saveTheCurrentLightingAndDisplay',
            message:
              "Save the current lighting and display as this project's default. Personal display changes stay in this browser.",
          })}
        </p>
        <ActionGroup>
          <ActionButton
            label={i18n._({ id: 'node.site.panel.saveCurrentLook', message: 'Save current look' })}
            onClick={() => {
              const viewer = useViewer.getState()
              const look = viewer.sceneAppearance
              update({
                presentation: {
                  ...node.presentation,
                  theme: viewer.sceneTheme,
                  exposure: look.toneMappingExposure,
                  shading: viewer.shading,
                  edges: viewer.edges,
                  shadows: viewer.shadows,
                  lighting: {
                    background: look.background,
                    backgroundSky: look.backgroundSky,
                    ground: look.ground,
                    ambient: look.ambient,
                    hemi: look.hemi,
                    lights: look.lights,
                    environment: look.environment,
                  },
                  postprocessing: look.postprocessing,
                },
              })
              viewer.resetProjectLook()
            }}
          />
          <ActionButton
            label={i18n._({ id: 'node.site.panel.useProjectLook', message: 'Use project look' })}
            onClick={() => useViewer.getState().resetProjectLook()}
          />
        </ActionGroup>
      </PanelSection>

      <PanelSection title={i18n._({ id: 'node.site.panel.terrain', message: 'Terrain' })}>
        <label className="flex items-center gap-2 text-sm">
          <input
            checked={node.showGround !== false}
            onChange={(event) => update({ showGround: event.target.checked })}
            type="checkbox"
          />
          <span className="text-muted-foreground">
            {i18n._({ id: 'node.site.panel.showGround', message: 'Show ground' })}
          </span>
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">
            {i18n._({
              id: 'node.site.panel.contourIntervalSitePlanAnd3d',
              message: 'Contour interval (site plan and 3D)',
            })}
          </span>
          <select
            className="w-full rounded-md border border-border/70 bg-background px-2 py-1.5 text-foreground"
            onChange={(event) => update({ contourIntervalIn: Number(event.target.value) })}
            value={String(node.contourIntervalIn ?? 12)}
          >
            <option value="0">{i18n._({ id: 'node.site.panel.none', message: 'none' })}</option>
            <option value="6">
              {i18n._({ id: 'node.site.panel.every6In', message: 'every 6 in' })}
            </option>
            <option value="12">
              {i18n._({ id: 'node.site.panel.every12In', message: 'every 12 in' })}
            </option>
            <option value="24">
              {i18n._({ id: 'node.site.panel.every24In', message: 'every 24 in' })}
            </option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            checked={node.contours3d ?? false}
            onChange={(event) => update({ contours3d: event.target.checked })}
            type="checkbox"
          />
          <span className="text-muted-foreground">
            {i18n._({
              id: 'node.site.panel.showTheContourLinesIn3d',
              message: 'Show the contour lines in 3D',
            })}
          </span>
        </label>
        {node.terrainContours ? (
          <p className="text-muted-foreground text-xs">
            {node.terrainContours.lines.length}{' '}
            {i18n._({ id: 'node.site.panel.surveyedLinesAt', message: 'surveyed lines at' })}{' '}
            {node.terrainContours.intervalFt}{' '}
            {i18n._({ id: 'node.site.panel.ft', message: 'ft (' })}
            {node.terrainContours.datum}) —{' '}
            {node.terrainContours.source ??
              i18n._({ id: 'node.site.panel.survey', message: 'survey' })}
          </p>
        ) : (
          <p className="text-muted-foreground text-xs">
            {i18n._({
              id: 'node.site.panel.noSurveyedLinesContoursAreDrawn',
              message: 'No surveyed lines — contours are drawn from the sculpted ground.',
            })}
          </p>
        )}
      </PanelSection>

      <PanelSection title={i18n._({ id: 'node.site.panel.orientation', message: 'Orientation' })}>
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">
            {i18n._({ id: 'node.site.panel.frontStreetEdge', message: 'Front (street) edge' })}
          </span>
          <select
            className="w-full rounded-md border border-border/70 bg-background px-2 py-1.5 text-foreground"
            onChange={(event) =>
              update({
                frontEdge: event.target.value === '' ? undefined : Number(event.target.value),
              })
            }
            value={node.frontEdge == null ? '' : String(node.frontEdge)}
          >
            <option value="">
              {i18n._({
                id: 'node.site.panel.autoMostNorthFacingEdge',
                message: 'Auto — most north-facing edge',
              })}
            </option>
            {edges.map((edge) => (
              <option key={edge.index} value={String(edge.index)}>
                {edge.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground">
            {i18n._({ id: 'node.site.panel.northRotation', message: 'North rotation' })}
          </span>
          <span className="flex items-center gap-1">
            <input
              className="w-20 rounded-md border border-border/70 bg-background px-2 py-1 text-right text-foreground"
              defaultValue={String(
                Math.round((((node.northRotation ?? 0) * 180) / Math.PI) * 10) / 10,
              )}
              inputMode="decimal"
              onFocus={(event) => event.target.select()}
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
