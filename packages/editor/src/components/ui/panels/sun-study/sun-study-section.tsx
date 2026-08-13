'use client'

import { type AnyNode, useScene } from '@pascal-app/core'
import { Sun } from 'lucide-react'
import { cn } from '../../../../lib/utils'
import { LocationMap } from './location-map'
import useSunStudy, {
  isSiteLocated,
  minutesIntoDay,
  readSiteSunSettings,
  resolveSunPosition,
} from '../../../../store/use-sun-study'

const HOUR_MARKS = [0, 6, 12, 18, 24]

const COMPASS_POINTS = [
  { label: 'N', from: 337.5, to: 22.5 },
  { label: 'NE', from: 22.5, to: 67.5 },
  { label: 'E', from: 67.5, to: 112.5 },
  { label: 'SE', from: 112.5, to: 157.5 },
  { label: 'S', from: 157.5, to: 202.5 },
  { label: 'SW', from: 202.5, to: 247.5 },
  { label: 'W', from: 247.5, to: 292.5 },
  { label: 'NW', from: 292.5, to: 337.5 },
]

function compassPoint(azimuth: number): string {
  const bearing = ((azimuth % 360) + 360) % 360
  for (const point of COMPASS_POINTS) {
    if (point.from > point.to) {
      if (bearing >= point.from || bearing < point.to) return point.label
    } else if (bearing >= point.from && bearing < point.to) {
      return point.label
    }
  }
  return 'N'
}

const formatClock = (dateMs: number): string =>
  new Date(dateMs).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

const toDateInputValue = (dateMs: number): string => {
  const date = new Date(dateMs)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * Sun study controls — where the site is, which way it faces, and the instant
 * being looked at.
 *
 * Latitude, longitude and north live on the `site` node because they describe
 * the project; the clock lives in editor state because it describes the study.
 * Neither reaches into the viewer: the resolved direction is pushed to
 * `useViewer.sunDirection` by `use-sun-study`.
 */
export function SunStudySection() {
  const enabled = useSunStudy((state) => state.enabled)
  const setEnabled = useSunStudy((state) => state.setEnabled)
  const dateMs = useSunStudy((state) => state.dateMs)
  const setDateMs = useSunStudy((state) => state.setDateMs)
  const setMinutes = useSunStudy((state) => state.setMinutesIntoDay)

  // Subscribing to `nodes` keeps the read-out live while the site is edited.
  const siteNodes = useScene((state) => state.nodes)
  void siteNodes
  const settings = readSiteSunSettings()
  const located = isSiteLocated(settings)
  const sun = located ? resolveSunPosition() : null

  const updateSite = (patch: Partial<AnyNode>) => {
    if (!settings) return
    useScene.getState().updateNode(settings.siteId, patch)
  }

  const numberField = (
    label: string,
    value: number | undefined,
    onCommit: (next: number | null) => void,
    placeholder: string,
  ) => (
    <label className="flex items-center gap-2 px-3 py-1 text-xs">
      <span className="w-20 shrink-0 text-muted-foreground">{label}</span>
      <input
        className="min-w-0 flex-1 rounded bg-white/5 px-1.5 py-0.5 text-right text-foreground tabular-nums outline-none focus:bg-white/10"
        defaultValue={value ?? ''}
        inputMode="decimal"
        key={`${label}-${value ?? ''}`}
        onBlur={(event) => {
          const raw = event.target.value.trim()
          if (!raw) {
            onCommit(null)
            return
          }
          const parsed = Number.parseFloat(raw)
          onCommit(Number.isFinite(parsed) ? parsed : null)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          // The editor's shortcuts listen on window; without this every
          // keystroke here would also drive a tool.
          event.stopPropagation()
        }}
        placeholder={placeholder}
      />
    </label>
  )

  return (
    <div className="flex flex-col border-border/40 border-b">
      <div className="flex items-center gap-1.5 px-3 pt-3 pb-1.5">
        <Sun className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="font-semibold text-muted-foreground text-xs tracking-tight">
          Sun study
        </span>
        <button
          aria-pressed={enabled}
          className={cn(
            'ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] transition-colors',
            enabled
              ? 'bg-primary/20 text-foreground'
              : 'text-muted-foreground/70 hover:bg-white/10 hover:text-foreground',
            !located && 'pointer-events-none opacity-40',
          )}
          disabled={!located}
          onClick={() => setEnabled(!enabled)}
          type="button"
        >
          {enabled ? 'On' : 'Off'}
        </button>
      </div>

      {settings === null ? (
        <p className="px-3 pb-2.5 text-[11px] text-muted-foreground/60">
          Add a site to study the sun on it.
        </p>
      ) : (
        <>
          {!located ? (
            <p className="px-3 pb-1.5 text-[11px] text-muted-foreground/60">
              Set a latitude and longitude — a sun angle means nothing until the project is
              somewhere.
            </p>
          ) : null}

          <LocationMap
            latitude={settings.latitude}
            longitude={settings.longitude}
            onPick={({ latitude, longitude }) =>
              updateSite({ latitude, longitude } as Partial<AnyNode>)
            }
          />

          {numberField(
            'Latitude',
            settings.latitude,
            (next) => updateSite({ latitude: next ?? undefined } as Partial<AnyNode>),
            '41.0082',
          )}
          {numberField(
            'Longitude',
            settings.longitude,
            (next) => updateSite({ longitude: next ?? undefined } as Partial<AnyNode>),
            '28.9784',
          )}
          {numberField(
            'North',
            settings.northOffset,
            (next) =>
              updateSite({
                northOffset: Math.min(360, Math.max(0, next ?? 0)),
              } as Partial<AnyNode>),
            '0',
          )}
          <p className="px-3 pb-1 text-[10px] text-muted-foreground/50">
            North is the true bearing that plan-up points at.
          </p>

          <label className="flex items-center gap-2 px-3 py-1 text-xs">
            <span className="w-20 shrink-0 text-muted-foreground">Date</span>
            <input
              className="min-w-0 flex-1 rounded bg-white/5 px-1.5 py-0.5 text-foreground outline-none focus:bg-white/10 [color-scheme:dark]"
              onChange={(event) => {
                const [year, month, day] = event.target.value.split('-').map(Number)
                if (!(year && month && day)) return
                const next = new Date(dateMs)
                next.setFullYear(year, month - 1, day)
                setDateMs(next.getTime())
              }}
              onKeyDown={(event) => event.stopPropagation()}
              type="date"
              value={toDateInputValue(dateMs)}
            />
          </label>

          <div className="flex flex-col gap-1 px-3 pt-1 pb-2">
            <div className="flex items-baseline justify-between text-xs">
              <span className="text-muted-foreground">Time</span>
              <span className="text-foreground tabular-nums">{formatClock(dateMs)}</span>
            </div>
            <input
              aria-label="Time of day"
              className="w-full accent-primary"
              max={1439}
              min={0}
              onChange={(event) => setMinutes(Number(event.target.value))}
              onKeyDown={(event) => event.stopPropagation()}
              step={5}
              type="range"
              value={minutesIntoDay(dateMs)}
            />
            <div className="flex justify-between text-[9px] text-muted-foreground/50 tabular-nums">
              {HOUR_MARKS.map((hour) => (
                <span key={hour}>{String(hour).padStart(2, '0')}</span>
              ))}
            </div>
          </div>

          {sun ? (
            <div className="flex items-center gap-3 px-3 pb-2.5 text-[11px] tabular-nums">
              <span className="text-muted-foreground">
                Alt <span className="text-foreground">{sun.altitude.toFixed(1)}°</span>
              </span>
              <span className="text-muted-foreground">
                Az{' '}
                <span className="text-foreground">
                  {sun.azimuth.toFixed(1)}° {compassPoint(sun.azimuth)}
                </span>
              </span>
              {sun.altitude <= 0 ? (
                <span className="ml-auto text-muted-foreground/60">below horizon</span>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
