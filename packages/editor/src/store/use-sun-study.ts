'use client'

import {
  type AnyNodeId,
  type SiteNode,
  solarPosition,
  sunDirection,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { create } from 'zustand'

/**
 * Sun study state — which instant is being looked at, and whether the scene's
 * key light is following the sun at all.
 *
 * Lives in the editor because it is an editing/analysis concern; the viewer is
 * handed only the resolved direction (`useViewer.sunDirection`), never the
 * clock or the coordinates. Site latitude, longitude and project north are
 * scene data and stay on the `site` node.
 */
type SunStudyState = {
  enabled: boolean
  /** The instant under study, as UTC epoch milliseconds. */
  dateMs: number
  setEnabled: (enabled: boolean) => void
  setDateMs: (dateMs: number) => void
  /** Move within the current day, keeping the date. */
  setMinutesIntoDay: (minutes: number) => void
}

/** Local noon on the day the editor was opened — a neutral, well-lit start. */
function defaultDateMs(): number {
  const now = new Date()
  now.setHours(12, 0, 0, 0)
  return now.getTime()
}

const useSunStudy = create<SunStudyState>((set, get) => ({
  enabled: false,
  dateMs: defaultDateMs(),
  setEnabled: (enabled) => set({ enabled }),
  setDateMs: (dateMs) => set({ dateMs }),
  setMinutesIntoDay: (minutes) => {
    const date = new Date(get().dateMs)
    date.setHours(0, 0, 0, 0)
    set({ dateMs: date.getTime() + minutes * 60_000 })
  },
}))

/** Minutes past local midnight for the studied instant. */
export function minutesIntoDay(dateMs: number): number {
  const date = new Date(dateMs)
  return date.getHours() * 60 + date.getMinutes()
}

export type SiteSunSettings = {
  siteId: AnyNodeId
  latitude: number | undefined
  longitude: number | undefined
  northOffset: number
}

/** The site node's solar settings, or `null` when the scene has no site yet. */
export function readSiteSunSettings(): SiteSunSettings | null {
  for (const node of Object.values(useScene.getState().nodes)) {
    if (node.type !== 'site') continue
    const site = node as SiteNode
    return {
      siteId: site.id,
      latitude: site.latitude,
      longitude: site.longitude,
      northOffset: site.northOffset ?? 0,
    }
  }
  return null
}

/** True once the site knows where on earth it is. */
export function isSiteLocated(settings: SiteSunSettings | null): settings is SiteSunSettings & {
  latitude: number
  longitude: number
} {
  return (
    settings !== null &&
    typeof settings.latitude === 'number' &&
    typeof settings.longitude === 'number'
  )
}

/**
 * The sun for the current study, or `null` when it cannot be computed —
 * the study is off, or the site has no coordinates yet.
 */
export function resolveSunDirection(): [number, number, number] | null {
  const { enabled, dateMs } = useSunStudy.getState()
  if (!enabled) return null

  const settings = readSiteSunSettings()
  if (!isSiteLocated(settings)) return null

  const position = solarPosition(
    { latitude: settings.latitude, longitude: settings.longitude },
    new Date(dateMs),
  )
  return sunDirection(position, settings.northOffset)
}

/** The sun's angles for the current study, for read-outs. `null` as above. */
export function resolveSunPosition(): { azimuth: number; altitude: number } | null {
  const settings = readSiteSunSettings()
  if (!isSiteLocated(settings)) return null
  return solarPosition(
    { latitude: settings.latitude, longitude: settings.longitude },
    new Date(useSunStudy.getState().dateMs),
  )
}

function pushSunDirection(): void {
  const next = resolveSunDirection()
  const current = useViewer.getState().sunDirection

  // Compare before writing: this runs on every scene commit, and a fresh array
  // each time would re-render every light consumer for an unchanged sun.
  if (next === null && current === null) return
  if (
    next &&
    current &&
    next[0] === current[0] &&
    next[1] === current[1] &&
    next[2] === current[2]
  ) {
    return
  }
  useViewer.getState().setSunDirection(next)
}

let stopTracking: (() => void) | null = null

/**
 * Keep `useViewer.sunDirection` in step with the study and the site.
 *
 * Two sources feed it — the clock (editor state) and the site's coordinates and
 * north (scene state) — so both are watched. Idempotent; the editor starts it
 * once on mount.
 */
export function startSunStudyTracking(): () => void {
  if (stopTracking) return stopTracking

  const unsubscribeStudy = useSunStudy.subscribe(pushSunDirection)
  const unsubscribeScene = useScene.subscribe(pushSunDirection)
  pushSunDirection()

  stopTracking = () => {
    unsubscribeStudy()
    unsubscribeScene()
    // Hand the key light back to the theme rather than leaving it stuck at
    // whatever the study last resolved.
    useViewer.getState().setSunDirection(null)
  }
  return stopTracking
}

export function stopSunStudyTracking(): void {
  stopTracking?.()
  stopTracking = null
}

export default useSunStudy
