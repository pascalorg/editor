'use client'

import { type PascalI18n, usePascalI18n, useScene } from '@pascal-app/core'
import {
  presetInstant,
  requestDeviceLocation,
  resolveLocation,
  type SkyPhase,
  skyPhase,
  solarClockInstant,
  solarClockMinutes,
  solarPosition,
  sunEvents,
  type TimeOfDay,
  useViewer,
  WEATHER_COVER,
  type Weather,
} from '@pascal-app/viewer'
import {
  Cloud,
  CloudSun,
  Cloudy,
  LocateFixed,
  Moon,
  RotateCcw,
  Sun,
  Sunrise,
  Sunset,
  X,
} from 'lucide-react'
import {
  type CSSProperties,
  type PointerEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { create } from 'zustand'
import { cn } from '../../lib/utils'
import { Popover, PopoverAnchor, PopoverContent } from '../ui/primitives/popover'
import { Switch } from '../ui/primitives/switch'

/**
 * The sky (time of day and weather) as a chip beside the compass, opening a panel: the sun's
 * arc to drag through the day, the presets, the live clock, and the cloud cover. While a chip is
 * mounted the display menus point here instead of carrying their own time and weather menus.
 */
export const useSkyPanel = create<{ open: boolean; hosts: number }>(() => ({
  open: false,
  hosts: 0,
}))

export function openSkyPanel() {
  useSkyPanel.setState({ open: true })
}

/**
 * The bottom docks the chip lines up with (measured): the editor's tool dock and the viewer's
 * controls bar, both 24 px up. The compass beside the chip centres on them.
 */
export const SKY_DOCK_BOTTOM = 24
export const SKY_DOCK_HEIGHT = { editor: 58, viewer: 56 } as const
export const SKY_COMPASS_BOTTOM = 36

/**
 * A preset or reset eases the sun to its time the short way round the clock, slowly enough to
 * watch the light change: 1.5 s for a short hop, up to 3 s for half a day, easing in and out.
 */
const TWEEN_MIN_MS = 1500
const TWEEN_MAX_MS = 3000
let tween = 0

function stopTween() {
  cancelAnimationFrame(tween)
  tween = 0
}

function easeTimeTo(from: number, to: number, done: () => void) {
  stopTween()
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const delta = ((((to - from + 2160) % 1440) + 1440) % 1440) - 720
  if (reduce || Math.abs(delta) < 1) {
    done()
    return
  }
  const start = performance.now()
  const duration = TWEEN_MIN_MS + (TWEEN_MAX_MS - TWEEN_MIN_MS) * (Math.abs(delta) / 720)
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / duration)
    const eased = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2
    if (t >= 1) {
      tween = 0
      done()
      return
    }
    useViewer.getState().setTimeOfDayMinutes((((from + delta * eased) % 1440) + 1440) % 1440)
    tween = requestAnimationFrame(step)
  }
  tween = requestAnimationFrame(step)
}

const PRESETS: readonly { id: TimeOfDay; icon: typeof Sun }[] = [
  { id: 'midday', icon: Sun },
  { id: 'golden', icon: Sunset },
  { id: 'blue', icon: Sunrise },
  { id: 'night', icon: Moon },
]

const WEATHERS: readonly { id: Weather; icon: typeof Sun }[] = [
  { id: 'clear', icon: Sun },
  { id: 'fair', icon: CloudSun },
  { id: 'cloudy', icon: Cloudy },
  { id: 'overcast', icon: Cloud },
]

export function weatherIcon(weather: Weather) {
  return WEATHERS.find((option) => option.id === weather)?.icon ?? CloudSun
}

function presetName(i18n: PascalI18n, id: TimeOfDay) {
  switch (id) {
    case 'golden':
      return i18n._({ id: 'viewer.daylight.time.golden', message: 'Golden hour' })
    case 'midday':
      return i18n._({ id: 'viewer.daylight.time.midday', message: 'Midday' })
    case 'blue':
      return i18n._({ id: 'viewer.daylight.time.blue', message: 'Blue hour' })
    case 'night':
      return i18n._({ id: 'viewer.daylight.time.night', message: 'Night' })
  }
}

function phaseName(i18n: PascalI18n, phase: SkyPhase) {
  switch (phase) {
    case 'night':
      return presetName(i18n, 'night')
    case 'blue':
      return presetName(i18n, 'blue')
    case 'golden':
      return presetName(i18n, 'golden')
    case 'midday':
      return presetName(i18n, 'midday')
    case 'morning':
      return i18n._({ id: 'viewer.daylight.phase.morning', message: 'Morning' })
    case 'afternoon':
      return i18n._({ id: 'viewer.daylight.phase.afternoon', message: 'Afternoon' })
  }
}

export function weatherName(i18n: PascalI18n, id: Weather) {
  switch (id) {
    case 'clear':
      return i18n._({ id: 'viewer.daylight.weather.clear', message: 'Clear' })
    case 'fair':
      return i18n._({ id: 'viewer.daylight.weather.fair', message: 'Fair' })
    case 'cloudy':
      return i18n._({ id: 'viewer.daylight.weather.cloudy', message: 'Cloudy' })
    case 'overcast':
      return i18n._({ id: 'viewer.daylight.weather.overcast', message: 'Overcast' })
  }
}

/** Sky colours (zenith, horizon) per phase, for the chip swatch and the arc's backdrop. */
const PHASE_SKY: Record<SkyPhase, [string, string]> = {
  night: ['#121a36', '#36406c'],
  blue: ['#263465', '#8c88b4'],
  golden: ['#8e98c6', '#f2cfb2'],
  morning: ['#6f9dd6', '#dbe7f2'],
  midday: ['#5a93d5', '#d3e4f3'],
  afternoon: ['#6a98d0', '#e6e2da'],
}

/** Minutes after midnight, as the locale writes a time of day. */
const formatMinutes = (() => {
  let format: Intl.DateTimeFormat | null = null
  return (minutes: number) => {
    format ??= new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'UTC',
    })
    return format.format(new Date(Math.round(minutes) * 60_000))
  }
})()

type SiteFacts = Parameters<typeof resolveLocation>[0]

/** The sky the viewer shows right now: its time on the site's sun clock, phase and events. */
function useSky() {
  const timeOfDay = useViewer((s) => s.timeOfDay)
  const timeOfDayMinutes = useViewer((s) => s.timeOfDayMinutes)
  const skyLive = useViewer((s) => s.skyLive)
  const weather = useViewer((s) => s.weather)
  const deviceLocation = useViewer((s) => s.deviceLocation)
  const site = useScene((state) => {
    for (const id of state.rootNodeIds) {
      const node = state.nodes[id]
      if (node?.type === 'site') return node as unknown as SiteFacts
    }
    return undefined
  })
  // The live clock moves the chip on once a minute.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    if (!skyLive) return
    setNow(new Date())
    const timer = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(timer)
  }, [skyLive])

  const { location, source } = resolveLocation(site, deviceLocation)
  const { lat, lng } = location
  const day = useMemo(() => {
    const today = new Date()
    const presets = Object.fromEntries(
      PRESETS.map(({ id }) => [id, solarClockMinutes(presetInstant(today, lat, lng, id), lng)]),
    ) as Record<TimeOfDay, number>
    return { today, presets, events: sunEvents(today, lat, lng) }
  }, [lat, lng])

  const minutes = skyLive
    ? solarClockMinutes(now, location.lng)
    : (timeOfDayMinutes ?? day.presets[timeOfDay])
  const elevation = solarPosition(
    solarClockInstant(day.today, location.lng, minutes),
    location.lat,
    location.lng,
  ).elevation
  return {
    minutes,
    // The live sky reads the wall clock the person knows; set times read the site's sun clock.
    clock: skyLive ? now.getHours() * 60 + now.getMinutes() : minutes,
    phase: skyPhase(elevation, minutes),
    activePreset: skyLive || timeOfDayMinutes !== null ? null : timeOfDay,
    presets: day.presets,
    events: day.events ?? { sunrise: 6 * 60, sunset: 18 * 60 },
    skyLive,
    weather,
    source,
  }
}

/**
 * The chip and its panel, absolutely placed by the caller (the scene's bottom-left corner, beside
 * the compass). `dark` for the viewer's dark chrome.
 */
export function SkyControl({
  className,
  dark = false,
  height,
  style,
}: {
  className?: string
  dark?: boolean
  /** The dock's height beside it, so the two line up. */
  height: number
  style?: CSSProperties
}) {
  const i18n = usePascalI18n()
  const open = useSkyPanel((s) => s.open)
  const sky = useSky()
  const WeatherIcon = weatherIcon(sky.weather)
  const nextWeather =
    WEATHERS[(WEATHERS.findIndex((w) => w.id === sky.weather) + 1) % WEATHERS.length]!
  const chip = useRef<HTMLDivElement | null>(null)
  const compact = useClearOfDock(chip)

  useEffect(() => {
    useSkyPanel.setState((s) => ({ hosts: s.hosts + 1 }))
    return () => useSkyPanel.setState((s) => ({ hosts: s.hosts - 1, open: false }))
  }, [])

  return (
    <Popover onOpenChange={(next) => useSkyPanel.setState({ open: next })} open={open}>
      <PopoverAnchor asChild>
        <div
          className={cn(
            'corner-smooth pointer-events-auto absolute z-30 flex items-stretch gap-0.5 rounded-2xl border border-border/40 bg-background/95 p-1 text-foreground text-xs shadow-elevation-4 backdrop-blur-xl',
            dark && 'dark',
            className,
          )}
          onPointerDown={(event) => event.stopPropagation()}
          ref={chip}
          style={{ bottom: SKY_DOCK_BOTTOM, height, ...style }}
        >
          <button
            aria-expanded={open}
            aria-label={i18n._({ id: 'viewer.daylight.sky.open', message: 'Time and weather' })}
            className={cn(
              'flex items-center gap-2 rounded-xl pr-3 pl-1.5 transition-colors',
              open ? 'bg-violet-500/10' : 'hover:bg-accent',
            )}
            onClick={() => useSkyPanel.setState({ open: !open })}
            type="button"
          >
            <MiniSky sky={sky} />
            <span className="font-mono text-foreground text-sm tabular-nums">
              {formatMinutes(sky.clock)}
            </span>
            {compact ? null : (
              <span className="text-muted-foreground text-sm">{phaseName(i18n, sky.phase)}</span>
            )}
          </button>
          <span aria-hidden="true" className="mx-0.5 my-auto h-6 w-px bg-border" />
          <button
            aria-label={i18n._({
              id: 'viewer.daylight.sky.cycleWeather',
              message: 'Cloud cover: {current}. Change to {next}',
              values: {
                current: weatherName(i18n, sky.weather),
                next: weatherName(i18n, nextWeather.id),
              },
            })}
            className="flex items-center gap-1.5 rounded-xl px-2.5 text-sm transition-colors hover:bg-accent"
            onClick={() => useViewer.getState().setWeather(nextWeather.id)}
            title={i18n._({
              id: 'viewer.daylight.sky.cycleWeatherTip',
              message: 'Cycle cloud cover',
            })}
            type="button"
          >
            <WeatherIcon aria-hidden="true" className="h-[18px] w-[18px] text-muted-foreground" />
            {compact ? null : <span>{weatherName(i18n, sky.weather)}</span>}
          </button>
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className={cn('w-[22rem] rounded-2xl p-4', dark && 'dark')}
        // Opened from a menu, focus returns to that menu's trigger: only a click outside closes.
        onFocusOutside={(event) => event.preventDefault()}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onPointerDown={(event) => event.stopPropagation()}
        side="top"
        sideOffset={8}
      >
        <SkyPanel sky={sky} />
      </PopoverContent>
    </Popover>
  )
}

/**
 * Whether the chip must drop its phase and weather labels to stay clear of the bottom dock (centred
 * on the window, so a sidebar or a narrow pane brings it close). Measures the full chip, then
 * compares where it would end with where the dock starts.
 */
function useClearOfDock(chip: { current: HTMLDivElement | null }): boolean {
  const [compact, setCompact] = useState(false)
  const fullWidth = useRef(0)
  useLayoutEffect(() => {
    const element = chip.current
    if (!element) return
    const check = () => {
      const box = element.getBoundingClientRect()
      if (!compact) fullWidth.current = box.width
      const dock = document.querySelector(
        '[data-surface="tool-dock"], [data-surface="viewer-dock"]',
      )
      const dockBox = dock?.getBoundingClientRect()
      const overlaps =
        !!dockBox &&
        dockBox.width > 0 &&
        Math.abs(dockBox.bottom - box.bottom) < 40 &&
        box.left + fullWidth.current + 12 > dockBox.left
      if (overlaps !== compact) setCompact(overlaps)
    }
    check()
    const observer = new ResizeObserver(check)
    observer.observe(element)
    if (element.offsetParent) observer.observe(element.offsetParent)
    window.addEventListener('resize', check)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', check)
    }
  })
  return compact
}

/** The chip's swatch: the sky's colours with the sun (or moon) where it stands on its arc. */
function MiniSky({ sky }: { sky: ReturnType<typeof useSky> }) {
  const [top, horizon] = PHASE_SKY[sky.phase]
  const sun = arcPoint(sky.minutes, sky.events.sunrise, sky.events.sunset)
  return (
    <span
      aria-hidden="true"
      className="relative h-8 w-8 shrink-0 overflow-hidden rounded-lg border border-black/10"
      style={{ background: `linear-gradient(${top}, ${horizon} 62%, #8a8a94 63%, #6c6c7a)` }}
    >
      <span
        className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          left: `${(sun.x / W) * 100}%`,
          top: `${Math.min(92, (sun.y / H) * 100)}%`,
          background: sun.day ? '#fcd165' : '#d6dcf0',
          boxShadow: sun.day ? '0 0 4px 1px rgba(252, 209, 101, 0.6)' : 'none',
        }}
      />
    </span>
  )
}

function SkyPanel({ sky }: { sky: ReturnType<typeof useSky> }) {
  const i18n = usePascalI18n()
  const [locating, setLocating] = useState(false)
  const viewer = useViewer.getState
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <div className="font-medium text-foreground text-sm">
            {i18n._({ id: 'viewer.daylight.sky.title', message: 'Sky' })}
          </div>
          <div className="text-muted-foreground text-xs">
            {i18n._({
              id: 'viewer.daylight.sky.subtitle',
              message: 'Light and weather for this view',
            })}
          </div>
        </div>
        <button
          className="flex items-center gap-1 rounded-md px-1.5 py-1 text-violet-600 text-xs hover:bg-accent dark:text-violet-300"
          onClick={() => {
            easeTimeTo(sky.minutes, sky.presets.midday, () => viewer().setTimeOfDay('midday'))
            viewer().setWeather('fair')
          }}
          type="button"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          {i18n._({ id: 'viewer.daylight.sky.reset', message: 'Reset' })}
        </button>
        <button
          aria-label={i18n._({ id: 'viewer.daylight.sky.close', message: 'Close' })}
          className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={() => useSkyPanel.setState({ open: false })}
          type="button"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <span className="flex-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
          {i18n._({ id: 'viewer.daylight.time.title', message: 'Time of day' })}
        </span>
        <span className="font-mono text-foreground text-sm tabular-nums">
          {formatMinutes(sky.clock)}
        </span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-foreground text-xs">
          {phaseName(i18n, sky.phase)}
        </span>
      </div>

      <SunArc sky={sky} />

      <div className="-mt-1 flex justify-between text-muted-foreground text-xs">
        <span className="flex items-center gap-1">
          <Sunrise className="h-3.5 w-3.5" />
          {i18n._({ id: 'viewer.daylight.sky.sunrise', message: 'Sunrise' })}
          <span className="font-mono text-foreground tabular-nums">
            {formatMinutes(sky.events.sunrise)}
          </span>
        </span>
        <span className="flex items-center gap-1">
          {i18n._({ id: 'viewer.daylight.sky.sunset', message: 'Sunset' })}
          <span className="font-mono text-foreground tabular-nums">
            {formatMinutes(sky.events.sunset)}
          </span>
          <Sunset className="h-3.5 w-3.5" />
        </span>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {PRESETS.map((preset) => (
          <OptionCard
            active={sky.activePreset === preset.id}
            detail={formatMinutes(sky.presets[preset.id])}
            icon={preset.icon}
            key={preset.id}
            name={presetName(i18n, preset.id)}
            onSelect={() =>
              easeTimeTo(sky.minutes, sky.presets[preset.id], () =>
                viewer().setTimeOfDay(preset.id),
              )
            }
          />
        ))}
      </div>

      <div className="flex items-center gap-3 rounded-xl bg-muted/60 px-3 py-2.5">
        <LocateFixed className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="flex-1">
          <div className="text-foreground text-sm">
            {sky.source === 'site'
              ? i18n._({ id: 'viewer.daylight.sky.followClock', message: 'Follow the clock' })
              : i18n._({ id: 'viewer.daylight.location.use', message: 'Use my location' })}
          </div>
          <div className="text-muted-foreground text-xs">
            {sky.source === 'site'
              ? i18n._({
                  id: 'viewer.daylight.sky.followClockDetail',
                  message: 'The sun moves with your local clock.',
                })
              : i18n._({
                  id: 'viewer.daylight.sky.liveDetail',
                  message: 'Follows your local clock. Sun position is approximate.',
                })}
          </div>
        </div>
        <Switch
          checked={sky.skyLive}
          disabled={locating}
          onCheckedChange={(live) => {
            stopTween()
            viewer().setSkyLive(live)
            if (!live || sky.source === 'site' || sky.source === 'device') return
            setLocating(true)
            requestDeviceLocation()
              .then((location) => useViewer.getState().setDeviceLocation(location))
              .catch(() => {})
              .finally(() => setLocating(false))
          }}
        />
      </div>

      <div className="h-px bg-border" />

      <div className="flex items-center">
        <span className="flex-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
          {i18n._({ id: 'viewer.daylight.sky.cloudCover', message: 'Cloud cover' })}
        </span>
        <span className="text-foreground text-sm">{weatherName(i18n, sky.weather)}</span>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {WEATHERS.map((option) => (
          <OptionCard
            active={sky.weather === option.id}
            detail={`${Math.round(WEATHER_COVER[option.id] * 100)}%`}
            icon={option.icon}
            key={option.id}
            name={weatherName(i18n, option.id)}
            onSelect={() => viewer().setWeather(option.id)}
          />
        ))}
      </div>
    </div>
  )
}

function OptionCard({
  active,
  detail,
  icon: Icon,
  name,
  onSelect,
}: {
  active: boolean
  detail: string
  icon: typeof Sun
  name: string
  onSelect: () => void
}) {
  return (
    <button
      aria-pressed={active}
      className={cn(
        'flex flex-col items-center gap-0.5 rounded-xl border px-1 py-2 text-center transition hover:bg-accent',
        active
          ? 'border-violet-500 bg-violet-500/10 text-violet-700 dark:text-violet-300'
          : 'border-border text-foreground',
      )}
      onClick={onSelect}
      type="button"
    >
      <Icon className={cn('mb-0.5 h-4 w-4', active ? '' : 'text-amber-600 dark:text-amber-400')} />
      <span className="text-xs leading-tight">{name}</span>
      <span className="font-mono text-[11px] text-muted-foreground tabular-nums">{detail}</span>
    </button>
  )
}

// The arc: day above the horizon from sunrise (left) to sunset (right), night dotted below.
const W = 320
const H = 150
const CX = W / 2
const CY = 100
const RX = 136
const RY_DAY = 80
const RY_NIGHT = 30
const SNAP = 5

function arcPoint(minutes: number, sunrise: number, sunset: number) {
  const dayLength = sunset - sunrise
  if (minutes >= sunrise && minutes <= sunset) {
    const angle = Math.PI * (1 - (minutes - sunrise) / dayLength)
    return { x: CX + RX * Math.cos(angle), y: CY - RY_DAY * Math.sin(angle), day: true }
  }
  const since = (minutes < sunrise ? minutes + 1440 : minutes) - sunset
  const angle = Math.PI * (since / (1440 - dayLength))
  return { x: CX + RX * Math.cos(angle), y: CY + RY_NIGHT * Math.sin(angle), day: false }
}

function arcMinutes(x: number, y: number, sunrise: number, sunset: number) {
  const dayLength = sunset - sunrise
  const angle = Math.atan2((CY - y) / (y < CY ? RY_DAY : RY_NIGHT), (x - CX) / RX)
  const minutes =
    angle >= 0
      ? sunrise + (1 - angle / Math.PI) * dayLength
      : sunset + (-angle / Math.PI) * (1440 - dayLength)
  return (((Math.round(minutes / SNAP) * SNAP) % 1440) + 1440) % 1440
}

/** The sun's course from `from` to `to` minutes after sunrise, as an SVG path. */
function coursePath(sunrise: number, sunset: number, from: number, to: number) {
  if (to - from < 1) return ''
  const steps = Math.max(2, Math.ceil((to - from) / 6))
  let d = ''
  for (let i = 0; i <= steps; i++) {
    const point = arcPoint((sunrise + from + ((to - from) * i) / steps) % 1440, sunrise, sunset)
    d += `${i ? 'L' : 'M'} ${point.x.toFixed(1)} ${point.y.toFixed(1)} `
  }
  return d
}

function SunArc({ sky }: { sky: ReturnType<typeof useSky> }) {
  const i18n = usePascalI18n()
  const slider = useRef<HTMLDivElement | null>(null)
  const { sunrise, sunset } = sky.events
  const sun = arcPoint(sky.minutes, sunrise, sunset)
  const [top, horizon] = PHASE_SKY[sky.phase]
  // The day's course from sunrise: drawn solid as far as the sun, dotted for what is left.
  const elapsed = (((sky.minutes - sunrise) % 1440) + 1440) % 1440
  const travelled = coursePath(sunrise, sunset, 0, elapsed)
  const ahead = coursePath(sunrise, sunset, elapsed, 1440)

  const setFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const rect = slider.current?.getBoundingClientRect()
    if (!rect) return
    const x = ((event.clientX - rect.left) / rect.width) * W
    const y = ((event.clientY - rect.top) / rect.height) * H
    stopTween()
    useViewer.getState().setTimeOfDayMinutes(arcMinutes(x, y, sunrise, sunset))
  }

  return (
    <div
      aria-label={i18n._({
        id: 'viewer.daylight.sky.arc',
        message: 'Drag the sun to set the time',
      })}
      aria-valuemax={1440}
      aria-valuemin={0}
      aria-valuenow={Math.round(sky.minutes)}
      aria-valuetext={formatMinutes(sky.clock)}
      className="cursor-grab touch-none select-none overflow-hidden rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
      onKeyDown={(event) => {
        const step = event.key === 'ArrowRight' ? 15 : event.key === 'ArrowLeft' ? -15 : 0
        if (!step) return
        event.preventDefault()
        stopTween()
        useViewer.getState().setTimeOfDayMinutes((sky.minutes + step + 1440) % 1440)
      }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        setFromPointer(event)
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) setFromPointer(event)
      }}
      ref={slider}
      role="slider"
      tabIndex={0}
    >
      <svg aria-hidden="true" className="block w-full" viewBox={`0 0 ${W} ${H}`}>
        <defs>
          <linearGradient id="sky-arc-backdrop" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={top} />
            <stop offset={CY / H} stopColor={horizon} />
            <stop offset={CY / H} stopColor="#9a9aa6" />
            <stop offset="1" stopColor="#6c6c7a" />
          </linearGradient>
        </defs>
        <rect fill="url(#sky-arc-backdrop)" height={H} width={W} />
        <line stroke="rgba(0,0,0,0.25)" x1="0" x2={W} y1={CY} y2={CY} />
        <path d={travelled} fill="none" stroke="#252a44" strokeLinecap="round" strokeWidth="2" />
        <path
          d={ahead}
          fill="none"
          stroke="#252a44"
          strokeDasharray="2 5"
          strokeLinecap="round"
          strokeOpacity="0.7"
          strokeWidth="1.5"
        />
        {sun.day ? <circle cx={sun.x} cy={sun.y} fill="#fcd165" opacity="0.3" r="15" /> : null}
        <circle
          cx={sun.x}
          cy={sun.y}
          fill={sun.day ? '#fcd165' : '#d6dcf0'}
          r="9"
          stroke="#ffffff"
          strokeWidth="2.5"
        />
      </svg>
    </div>
  )
}
