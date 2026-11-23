import { useScene } from '@pascal-app/core'
import useViewer from '../../store/use-viewer'
import { resolveDaylightSite } from './location'
import { presetInstant, solarClockMinutes, type TimeTarget, timeTargetInstant } from './solar'

export type TimeTransitionOptions = {
  durationMs?: number | ((deltaMinutes: number) => number)
  easing?: (t: number) => number
}

let cancelPrevious = () => {}

/** Also used by the sky dial and live-clock switch when they take over the clock. */
export function cancelTimeTransition() {
  cancelPrevious()
}

function currentDaylightClock() {
  const state = useViewer.getState()
  const graph = useScene.getState()
  const site = graph.rootNodeIds.map((id) => graph.nodes[id]).find((node) => node?.type === 'site')
  const { location } = resolveDaylightSite(site, state.daylightSite, state.deviceLocation)
  const now = new Date()
  return { state, location, now }
}

/** Resolve solar-clock minutes for the current day/site without changing viewer state. */
export function timeTargetMinutes(target: TimeTarget): number {
  const { location, now } = currentDaylightClock()
  return solarClockMinutes(timeTargetInstant(now, location.lat, location.lng, target), location.lng)
}

/** Ease the displayed solar clock to a target along the shortest route around midnight. */
export function transitionTimeOfDay(
  target: TimeTarget,
  options: TimeTransitionOptions = {},
): () => void {
  cancelPrevious()
  const { state, location, now } = currentDaylightClock()
  const from =
    state.timeOfDayMinutes ??
    solarClockMinutes(
      state.skyLive ? now : presetInstant(now, location.lat, location.lng, state.timeOfDay),
      location.lng,
    )
  const to = solarClockMinutes(
    timeTargetInstant(now, location.lat, location.lng, target),
    location.lng,
  )
  const finish = () => {
    const current = useViewer.getState()
    if (typeof target === 'string') current.setTimeOfDay(target)
    else current.setTimeOfDayMinutes(to)
  }
  const delta = ((((to - from + 2160) % 1440) + 1440) % 1440) - 720
  let frame = 0
  let cancelled = false
  const cancel = () => {
    cancelled = true
    cancelAnimationFrame(frame)
  }
  cancelPrevious = cancel
  const duration =
    typeof options.durationMs === 'function'
      ? options.durationMs(delta)
      : (options.durationMs ?? 1500 + 1500 * (Math.abs(delta) / 720))
  if (
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ||
    Math.abs(delta) < 1 ||
    duration <= 0
  ) {
    finish()
    return cancel
  }
  const start = performance.now()
  const ease = options.easing ?? ((t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2))
  const step = (timestamp: number) => {
    if (cancelled) return
    const t = Math.min(1, (timestamp - start) / duration)
    if (t >= 1) {
      frame = 0
      finish()
      return
    }
    useViewer.getState().setTimeOfDayMinutes((((from + delta * ease(t)) % 1440) + 1440) % 1440)
    frame = requestAnimationFrame(step)
  }
  frame = requestAnimationFrame(step)
  return cancel
}
