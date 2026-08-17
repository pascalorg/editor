'use client'

import { Crosshair, Loader2, Minus, Plus, Search } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  clampZoom,
  formatCoordinate,
  type LonLat,
  MAX_ZOOM,
  MIN_ZOOM,
  osmTileUrl,
  panCenter,
  roundCoordinate,
  TILE_SIZE,
  viewportPointToLonLat,
  visibleTiles,
} from '../../../../lib/slippy-map'
import { LocalizedContent } from '../../../../lib/i18n'
import { cn } from '../../../../lib/utils'

const MAP_HEIGHT = 176
const DEFAULT_ZOOM = 11
/** A drag under this many pixels is a click that wobbled, not a pan. */
const CLICK_SLOP_PX = 4

type NominatimPlace = { lat: string; lon: string; display_name: string }

/**
 * Location picker for the sun study.
 *
 * Raster tiles straight from OpenStreetMap and place search from Nominatim —
 * both free, both requiring only attribution. No mapping library: this is a
 * picker, not a map, and the arithmetic it needs is a few dozen lines
 * (`lib/slippy-map.ts`) against the hundreds of kilobytes Leaflet or MapLibre
 * would add to a package embedders install.
 *
 * The map is an aid, never the source of truth. Tiles are third-party network
 * requests that an offline machine, a strict CSP or a blocked host will drop;
 * when that happens the panel's latitude and longitude fields still work, so
 * the study is never gated on the map loading.
 */
export function LocationMap({
  latitude,
  longitude,
  onPick,
}: {
  latitude: number | undefined
  longitude: number | undefined
  onPick: (position: LonLat) => void
}) {
  const located = typeof latitude === 'number' && typeof longitude === 'number'
  const [center, setCenter] = useState<LonLat>(() =>
    located ? { latitude, longitude } : { latitude: 41.0082, longitude: 28.9784 },
  )
  const [zoom, setZoom] = useState(DEFAULT_ZOOM)
  const [width, setWidth] = useState(0)
  // Measured, not assumed. `MAP_HEIGHT` is what the box asks for, but a flex
  // parent can shrink it — and then the tiles are laid out for one height while
  // a click is measured against another, so the pick lands hundreds of metres
  // from where the user aimed.
  const [height, setHeight] = useState(MAP_HEIGHT)
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [tilesFailed, setTilesFailed] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ x: number; y: number; moved: number } | null>(null)

  // Follow the site when it is set from outside (typed into the fields, or
  // loaded with the scene) — but not while the user is dragging the map.
  useEffect(() => {
    if (!located || dragRef.current) return
    setCenter({ latitude, longitude })
  }, [located, latitude, longitude])

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      setWidth(entry.contentRect.width)
      if (entry.contentRect.height > 0) setHeight(entry.contentRect.height)
    })
    observer.observe(element)
    setWidth(element.clientWidth)
    if (element.clientHeight > 0) setHeight(element.clientHeight)
    return () => observer.disconnect()
  }, [])

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = { x: event.clientX, y: event.clientY, moved: 0 }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const dx = event.clientX - drag.x
    const dy = event.clientY - drag.y
    drag.moved += Math.abs(dx) + Math.abs(dy)
    drag.x = event.clientX
    drag.y = event.clientY
    setCenter((current) => panCenter(current, zoom, dx, dy))
  }

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    dragRef.current = null
    if (!drag) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    // A pan is not a pick; only a stationary press sets the site.
    if (drag.moved > CLICK_SLOP_PX) return

    const bounds = event.currentTarget.getBoundingClientRect()
    const picked = viewportPointToLonLat(
      center,
      zoom,
      bounds.width,
      bounds.height,
      event.clientX - bounds.left,
      event.clientY - bounds.top,
    )
    onPick({
      latitude: roundCoordinate(picked.latitude),
      longitude: roundCoordinate(picked.longitude),
    })
  }

  const search = useCallback(async () => {
    const term = query.trim()
    if (!term) return
    setSearching(true)
    setSearchError(null)
    try {
      const response = await fetch(
        // `jsonv2` + a single result: Nominatim asks callers to be frugal, and
        // one hit per deliberate Enter press is as frugal as search gets.
        `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(term)}`,
        { headers: { Accept: 'application/json' } },
      )
      if (!response.ok) throw new Error(String(response.status))
      const results = (await response.json()) as NominatimPlace[]
      const hit = results[0]
      if (!hit) {
        setSearchError('No place found')
        return
      }
      const position = {
        latitude: roundCoordinate(Number(hit.lat)),
        longitude: roundCoordinate(Number(hit.lon)),
      }
      if (!(Number.isFinite(position.latitude) && Number.isFinite(position.longitude))) {
        setSearchError('No place found')
        return
      }
      setCenter(position)
      setZoom(DEFAULT_ZOOM)
      onPick(position)
    } catch {
      // Offline, blocked, or rate-limited — all the same to the user, and the
      // coordinate fields remain the way through.
      setSearchError('Search unavailable')
    } finally {
      setSearching(false)
    }
  }, [query, onPick])

  const tiles = width > 0 ? visibleTiles(center, zoom, width, height) : []

  return (
    <LocalizedContent>
      <div className="flex flex-col gap-1.5 px-3 pb-2">
      <div className="flex items-center gap-1.5">
        <div className="relative min-w-0 flex-1">
          <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-1.5 h-3 w-3 text-muted-foreground/60" />
          <input
            className="w-full rounded bg-foreground/5 py-1 pr-1.5 pl-6 text-foreground text-xs outline-none focus:bg-foreground/10"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              // The editor's shortcuts listen on window; without this every
              // keystroke here would also drive a tool.
              event.stopPropagation()
              if (event.key === 'Enter') void search()
            }}
            placeholder="Search a place…"
            value={query}
          />
        </div>
        <button
          aria-label="Search"
          className="shrink-0 rounded p-1 text-muted-foreground/70 transition-colors hover:bg-foreground/10 hover:text-foreground disabled:opacity-40"
          disabled={searching || !query.trim()}
          onClick={() => void search()}
          type="button"
        >
          {searching ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Search className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      <div
        className="relative shrink-0 touch-none overflow-hidden rounded border border-border/50 bg-foreground/5"
        onPointerCancel={() => {
          dragRef.current = null
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        ref={containerRef}
        style={{ height: MAP_HEIGHT, cursor: 'crosshair' }}
      >
        {tilesFailed ? (
          <div className="flex h-full items-center justify-center px-4 text-center text-[11px] text-muted-foreground/60">
            Map tiles unavailable — enter the coordinates below instead.
          </div>
        ) : (
          tiles.map((tile) => (
            <img
              alt=""
              className="pointer-events-none absolute select-none"
              draggable={false}
              height={TILE_SIZE}
              key={`${tile.zoom}/${tile.x}/${tile.y}`}
              onError={() => setTilesFailed(true)}
              src={osmTileUrl(tile)}
              style={{ left: tile.left, top: tile.top }}
              width={TILE_SIZE}
            />
          ))
        )}

        {/* Crosshair marks the picked site, which is the map centre while the
            fields and the map are in step. */}
        <Crosshair
          className={cn(
            '-translate-x-1/2 -translate-y-1/2 pointer-events-none absolute top-1/2 left-1/2 h-5 w-5 drop-shadow',
            located ? 'text-primary' : 'text-muted-foreground/70',
          )}
        />

        <div className="absolute top-1 right-1 flex flex-col gap-0.5">
          {[
            { label: 'Zoom in', icon: Plus, next: zoom + 1, disabled: zoom >= MAX_ZOOM },
            { label: 'Zoom out', icon: Minus, next: zoom - 1, disabled: zoom <= MIN_ZOOM },
          ].map(({ label, icon: Icon, next, disabled }) => (
            <button
              aria-label={label}
              className="rounded bg-background/80 p-0.5 text-foreground shadow-sm backdrop-blur transition-colors hover:bg-background disabled:opacity-40"
              disabled={disabled}
              key={label}
              onClick={() => setZoom(clampZoom(next))}
              type="button"
            >
              <Icon className="h-3 w-3" />
            </button>
          ))}
        </div>

        {!tilesFailed && (
          // OpenStreetMap's tile policy requires visible attribution.
          <a
            className="absolute right-0 bottom-0 bg-background/70 px-1 text-[9px] text-muted-foreground backdrop-blur hover:text-foreground"
            href="https://www.openstreetmap.org/copyright"
            onPointerDown={(event) => event.stopPropagation()}
            rel="noreferrer"
            target="_blank"
          >
            © OpenStreetMap
          </a>
        )}
      </div>

      <p className="text-[10px] text-muted-foreground/50">
        {searchError ??
          (located
            ? `Click the map to move the site · ${formatCoordinate(latitude)}, ${formatCoordinate(longitude)}`
            : 'Click the map to place the site.')}
      </p>
      </div>
    </LocalizedContent>
  )
}
