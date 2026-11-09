'use client'

import { type PascalI18n, usePascalI18n, useScene } from '@pascal-app/core'
import {
  type RenderQuality,
  requestDeviceLocation,
  resolveLocation,
  type TimeOfDay,
  useViewer,
  type Weather,
} from '@pascal-app/viewer'
import {
  ArrowDownLeft,
  Check,
  Cloud,
  CloudSun,
  Gauge,
  LocateFixed,
  Moon,
  PenLine,
  Sun,
  Sunrise,
  Sunset,
} from 'lucide-react'
import { useState } from 'react'
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '../ui/primitives/dropdown-menu'
import { openSkyPanel, useSkyPanel, weatherIcon } from './sky-control'

/**
 * Render settings shared by every display dropdown:
 * - `QualityMenu` (both appearances): Low / Medium / High.
 * - `DaylightMenu` (colored): time-of-day and weather presets, plus "Use my location" when the
 *   site has no geocoded point — or, while the sky chip is in the viewport, a row opening it.
 * - `EdgesToggleItem` (monochrome): ink edges on or off.
 */

function timeOptions(i18n: PascalI18n) {
  return [
    {
      id: 'golden',
      icon: Sunrise,
      name: i18n._({ id: 'viewer.daylight.time.golden', message: 'Golden hour' }),
    },
    {
      id: 'midday',
      icon: Sun,
      name: i18n._({ id: 'viewer.daylight.time.midday', message: 'Midday' }),
    },
    {
      id: 'blue',
      icon: Sunset,
      name: i18n._({ id: 'viewer.daylight.time.blue', message: 'Blue hour' }),
    },
    {
      id: 'night',
      icon: Moon,
      name: i18n._({ id: 'viewer.daylight.time.night', message: 'Night' }),
    },
  ] as const satisfies readonly { id: TimeOfDay; icon: typeof Sun; name: string }[]
}

function weatherOptions(i18n: PascalI18n) {
  return [
    { id: 'clear', name: i18n._({ id: 'viewer.daylight.weather.clear', message: 'Clear' }) },
    { id: 'fair', name: i18n._({ id: 'viewer.daylight.weather.fair', message: 'Fair' }) },
    { id: 'cloudy', name: i18n._({ id: 'viewer.daylight.weather.cloudy', message: 'Cloudy' }) },
    {
      id: 'overcast',
      name: i18n._({ id: 'viewer.daylight.weather.overcast', message: 'Overcast' }),
    },
  ] as const satisfies readonly { id: Weather; name: string }[]
}

function qualityOptions(i18n: PascalI18n) {
  return [
    {
      id: 'low',
      name: i18n._({ id: 'viewer.daylight.quality.low', message: 'Low' }),
      detail: i18n._({
        id: 'viewer.daylight.quality.lowDetail',
        message: 'Fastest — no ambient occlusion or bloom',
      }),
    },
    {
      id: 'medium',
      name: i18n._({ id: 'viewer.daylight.quality.medium', message: 'Medium' }),
      detail: i18n._({
        id: 'viewer.daylight.quality.mediumDetail',
        message: 'Half-resolution ambient occlusion',
      }),
    },
    {
      id: 'high',
      name: i18n._({ id: 'viewer.daylight.quality.high', message: 'High' }),
      detail: i18n._({
        id: 'viewer.daylight.quality.highDetail',
        message: 'Lighting-aware ambient occlusion and bloom',
      }),
    },
  ] as const satisfies readonly { id: RenderQuality; name: string; detail: string }[]
}

export function QualityMenu({
  subContentClassName = 'dark min-w-56',
}: {
  subContentClassName?: string
}) {
  const i18n = usePascalI18n()
  const quality = useViewer((s) => s.renderQuality)
  const choice = useViewer((s) => s.renderQualityChoice)
  const qualities = qualityOptions(i18n)
  const active = qualities.find((o) => o.id === quality) ?? qualities[2]
  const autoName = i18n._({ id: 'viewer.daylight.quality.auto', message: 'Auto' })
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Gauge className="h-4 w-4" />
        <span>{i18n._({ id: 'viewer.daylight.quality.title', message: 'Quality' })}</span>
        <span className="ml-auto text-muted-foreground text-xs">
          {choice === 'auto' ? `${autoName} (${active.name})` : active.name}
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className={subContentClassName}>
        <DropdownMenuItem onSelect={() => useViewer.getState().setRenderQuality('auto')}>
          <div className="flex flex-col">
            <span className="text-foreground">{autoName}</span>
            <span className="text-muted-foreground text-xs">
              {i18n._({
                id: 'viewer.daylight.quality.autoDetail',
                message: 'Picked for this device: {tier}',
                values: { tier: active.name },
              })}
            </span>
          </div>
          {choice === 'auto' ? <Check className="ml-auto h-4 w-4 text-foreground" /> : null}
        </DropdownMenuItem>
        {qualities.map((option) => (
          <DropdownMenuItem
            key={option.id}
            onSelect={() => useViewer.getState().setRenderQuality(option.id)}
          >
            <div className="flex flex-col">
              <span className="text-foreground">{option.name}</span>
              <span className="text-muted-foreground text-xs">{option.detail}</span>
            </div>
            {choice === option.id ? <Check className="ml-auto h-4 w-4 text-foreground" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

export function DaylightMenu({
  subContentClassName = 'dark min-w-48',
}: {
  subContentClassName?: string
}) {
  const i18n = usePascalI18n()
  const timeOfDay = useViewer((s) => s.timeOfDay)
  const weather = useViewer((s) => s.weather)
  const deviceLocation = useViewer((s) => s.deviceLocation)
  const siteHasLocation = useScene((state) => {
    for (const id of state.rootNodeIds) {
      const node = state.nodes[id] as
        | { type?: string; parcel?: { originLngLat?: unknown }; dossier?: { point?: unknown } }
        | undefined
      if (node?.type === 'site') return Boolean(node.parcel?.originLngLat || node.dossier?.point)
    }
    return false
  })
  const [locating, setLocating] = useState(false)
  // The sky chip beside the compass carries time and weather wherever it is mounted.
  const skyChip = useSkyPanel((s) => s.hosts > 0)
  const times = timeOptions(i18n)
  const weathers = weatherOptions(i18n)
  const activeTime = times.find((o) => o.id === timeOfDay) ?? times[1]
  const activeWeather = weathers.find((o) => o.id === weather) ?? weathers[1]
  const source = siteHasLocation ? 'site' : resolveLocation(null, deviceLocation).source

  if (skyChip) {
    const WeatherIcon = weatherIcon(weather)
    return (
      <DropdownMenuItem onSelect={openSkyPanel}>
        <WeatherIcon className="h-4 w-4" />
        <span>{i18n._({ id: 'viewer.daylight.sky.menuItem', message: 'Time & weather' })}</span>
        <span className="ml-auto flex items-center gap-1 text-violet-600 text-xs dark:text-violet-300">
          {i18n._({ id: 'viewer.daylight.sky.inViewport', message: 'In viewport' })}
          <ArrowDownLeft className="h-3.5 w-3.5" />
        </span>
      </DropdownMenuItem>
    )
  }

  return (
    <>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <activeTime.icon className="h-4 w-4" />
          <span>{i18n._({ id: 'viewer.daylight.time.title', message: 'Time of day' })}</span>
          <span className="ml-auto text-muted-foreground text-xs">{activeTime.name}</span>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className={subContentClassName}>
          {times.map((option) => (
            <DropdownMenuItem
              key={option.id}
              onSelect={() => useViewer.getState().setTimeOfDay(option.id)}
            >
              <option.icon className="h-4 w-4" />
              <span>{option.name}</span>
              {timeOfDay === option.id ? <Check className="ml-auto h-4 w-4" /> : null}
            </DropdownMenuItem>
          ))}
          {source !== 'site' ? (
            <DropdownMenuItem
              disabled={locating}
              onSelect={(event) => {
                event.preventDefault()
                setLocating(true)
                requestDeviceLocation()
                  .then((location) => useViewer.getState().setDeviceLocation(location))
                  .catch(() => {})
                  .finally(() => setLocating(false))
              }}
            >
              <LocateFixed className="h-4 w-4" />
              <div className="flex flex-col">
                <span>
                  {i18n._({ id: 'viewer.daylight.location.use', message: 'Use my location' })}
                </span>
                <span className="text-muted-foreground text-xs">
                  {source === 'device'
                    ? i18n._({
                        id: 'viewer.daylight.location.device',
                        message: 'Sun follows your location',
                      })
                    : i18n._({
                        id: 'viewer.daylight.location.approximate',
                        message: 'Sun position is approximate',
                      })}
                </span>
              </div>
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          {weather === 'clear' ? <CloudSun className="h-4 w-4" /> : <Cloud className="h-4 w-4" />}
          <span>{i18n._({ id: 'viewer.daylight.weather.title', message: 'Weather' })}</span>
          <span className="ml-auto text-muted-foreground text-xs">{activeWeather.name}</span>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className={subContentClassName}>
          {weathers.map((option) => (
            <DropdownMenuItem
              key={option.id}
              onSelect={() => useViewer.getState().setWeather(option.id)}
            >
              <span>{option.name}</span>
              {weather === option.id ? <Check className="ml-auto h-4 w-4" /> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </>
  )
}

/** Ink edges on (soft) or off. The menu stays open on toggle. */
export function EdgesToggleItem() {
  const i18n = usePascalI18n()
  const on = useViewer((s) => s.edges !== 'off')
  return (
    <DropdownMenuItem
      onSelect={(event) => {
        event.preventDefault()
        useViewer.getState().setEdges(on ? 'off' : 'soft')
      }}
    >
      <PenLine className="h-4 w-4" />
      <span>{i18n._({ id: 'viewer.display.edges.title', message: 'Edges' })}</span>
      <span className="ml-auto text-muted-foreground text-xs">
        {on
          ? i18n._({ id: 'viewer.common.on', message: 'On' })
          : i18n._({ id: 'viewer.common.off', message: 'Off' })}
      </span>
    </DropdownMenuItem>
  )
}
