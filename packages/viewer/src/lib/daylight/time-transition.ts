import { useScene } from '@pascal-app/core'
import useViewer from '../../store/use-viewer'
import { resolveDaylightSite } from './location'
import { presetInstant, solarClockMinutes, type TimeOfDay } from './solar'

export type TimeTransitionOptions = {
  durationMs?: number | ((deltaMinutes: number) => number)
  easing?: (t: number) => number
}

let cancelPrevious = () => {}

/** Also used by the sky dial and live-clock switch when they take over the clock. */
export function cancelTimeTransition() {
  cancelPrevious()
}

/** Ease the displayed solar clock to a preset along the shortest route around midnight. */
export function transitionTimeOfDay(
  preset: TimeOfDay,
  options: TimeTransitionOptions = {},
): () => void {
  cancelPrevious()
  const state = useViewer.getState()
  const graph = useScene.getState()
  const site = graph.rootNodeIds.map((id) => graph.nodes[id]).find((node) => node?.type === 'site')
  const { location } = resolveDaylightSite(site, state.daylightSite, state.deviceLocation)
  const now = new Date()
  const instant = (value: TimeOfDay) => presetInstant(now, location.lat, location.lng, value)
  const from =
    state.timeOfDayMinutes ??
    solarClockMinutes(state.skyLive ? now : instant(state.timeOfDay), location.lng)
  const to = solarClockMinutes(instant(preset), location.lng)
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
    state.setTimeOfDay(preset)
    return cancel
  }
  const start = performance.now()
  const ease = options.easing ?? ((t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2))
  const step = (timestamp: number) => {
    if (cancelled) return
    const t = Math.min(1, (timestamp - start) / duration)
    if (t >= 1) {
      frame = 0
      useViewer.getState().setTimeOfDay(preset)
      return
    }
    useViewer.getState().setTimeOfDayMinutes((((from + delta * ease(t)) % 1440) + 1440) % 1440)
    frame = requestAnimationFrame(step)
  }
  frame = requestAnimationFrame(step)
  return cancel
}
