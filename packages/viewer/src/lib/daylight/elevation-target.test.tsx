import { afterEach, beforeEach, expect, setSystemTime, spyOn, test } from 'bun:test'
import { SiteNode, useInteractive, useScene } from '@pascal-app/core'
import { act, create } from '@react-three/test-renderer'
import { DaylightAtmosphere } from '../../components/viewer/daylight-atmosphere'
import {
  type SceneAtmosphereSource,
  useSceneAtmosphere,
} from '../../components/viewer/scene-atmosphere'
import {
  presetInstant,
  solarClockInstant,
  solarClockMinutes,
  solarPosition,
  type TimeTarget,
  timeTargetMinutes,
  transitionTimeOfDay,
  useViewer,
} from '../../index'
import { daylightUniforms } from './runtime'
import { cancelTimeTransition } from './time-transition'

const day = new Date('2026-06-21T12:00:00Z')
const location = { lat: 48.86, lng: 2.35 }
const dusk: TimeTarget = { elevation: -2.5, side: 'setting' }
let previous: ReturnType<typeof useViewer.getState>
let graph: ReturnType<typeof useScene.getState>
let interactive: ReturnType<typeof useInteractive.getState>
let frames: Map<number, FrameRequestCallback>
let timestamp: number
let reduce: boolean
let restore: () => void

function frame(at: number) {
  timestamp = at
  const pending = [...frames.values()]
  frames.clear()
  for (const callback of pending) callback(at)
}

beforeEach(() => {
  previous = useViewer.getState()
  graph = useScene.getState()
  interactive = useInteractive.getState()
  const keys = [
    'window',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'IS_REACT_ACT_ENVIRONMENT',
  ] as const
  const descriptors = keys.map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  )
  frames = new Map()
  timestamp = 0
  reduce = false
  let nextFrame = 0
  Object.assign(globalThis, {
    window: { matchMedia: () => ({ matches: reduce }) },
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      frames.set(++nextFrame, callback)
      return nextFrame
    },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    IS_REACT_ACT_ENVIRONMENT: true,
  })
  const clock = spyOn(performance, 'now').mockImplementation(() => timestamp)
  setSystemTime(day)
  useScene.setState({ nodes: {}, rootNodeIds: [] })
  useViewer.setState({
    daylightSite: { northRotation: 0, ...location },
    timeOfDay: 'golden',
    timeOfDayMinutes: 0,
    skyLive: false,
    transparentBackground: false,
    weather: 'fair',
  })
  restore = () => {
    clock.mockRestore()
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
})

afterEach(() => {
  cancelTimeTransition()
  restore()
  setSystemTime()
  useViewer.setState(previous, true)
  useScene.setState(graph, true)
  useInteractive.setState(interactive, true)
})

test.each(['rising', 'setting'] as const)(
  '%s elevations resolve on their side of solar noon',
  (side) => {
    const noon = solarClockMinutes(
      presetInstant(day, location.lat, location.lng, 'midday'),
      location.lng,
    )
    const state = useViewer.getState()
    for (const elevation of [-14, -2.5, 6, 35]) {
      const minutes = timeTargetMinutes({ elevation, side })
      expect(side === 'rising' ? minutes < noon : minutes > noon).toBe(true)
      const sun = solarPosition(
        solarClockInstant(day, location.lng, minutes),
        location.lat,
        location.lng,
      )
      expect(Math.abs(sun.elevation - elevation)).toBeLessThan(0.01)
    }
    expect(useViewer.getState()).toBe(state)
    for (const preset of ['dawn', 'midday', 'golden', 'blue', 'night'] as const) {
      expect(timeTargetMinutes(preset)).toBe(
        solarClockMinutes(presetInstant(day, location.lat, location.lng, preset), location.lng),
      )
    }
  },
)

test.each(['rising', 'setting'] as const)(
  '%s polar fallback uses the closest reachable elevation',
  (side) => {
    const lat = 80
    const lng = 18.96
    useViewer.setState({ daylightSite: { lat, lng, northRotation: 0 } })
    for (const month of [5, 11]) {
      const date = new Date(2026, month, 21, 12)
      setSystemTime(date)
      const noon = presetInstant(date, lat, lng, 'midday').getTime()
      // Below the summer minimum; above the winter maximum.
      const elevation = month === 5 ? -2.5 : 6
      const minutes = timeTargetMinutes({ elevation, side })
      expect(Number.isFinite(minutes)).toBe(true)
      const reached = solarPosition(solarClockInstant(date, lng, minutes), lat, lng).elevation
      expect(month === 5 ? reached > elevation : reached < elevation).toBe(true)
      for (let offset = 0; offset <= 720; offset++) {
        const candidate = new Date(noon + (side === 'rising' ? -offset : offset) * 60_000)
        expect(Math.abs(reached - elevation)).toBeLessThanOrEqual(
          Math.abs(solarPosition(candidate, lat, lng).elevation - elevation) + 0.02,
        )
      }
    }
  },
)

test('elevations use graph location, daylightSite override and device fallback in renderer order', () => {
  const site = SiteNode.parse({ id: 'site_elevation', parcel: { originLngLat: [151.21, -33.87] } })
  useScene.setState({ nodes: { [site.id]: site }, rootNodeIds: [site.id] })
  for (const override of [null, { northRotation: 0, ...location }, { northRotation: 0 }]) {
    const device = { lat: 40.71, lng: -74 }
    const point = override ? ('lat' in override ? location : device) : { lat: -33.87, lng: 151.21 }
    useViewer.setState({ daylightSite: override, deviceLocation: device, skyLive: true })
    const minutes = timeTargetMinutes(dusk)
    const sun = solarPosition(solarClockInstant(day, point.lng, minutes), point.lat, point.lng)
    expect(Math.abs(sun.elevation + 2.5)).toBeLessThan(0.01)
    transitionTimeOfDay(dusk, { durationMs: 1000, easing: (t) => t })
    frame(timestamp)
    expect(useViewer.getState().timeOfDayMinutes).toBe(0)
    frame(timestamp + 1000)
    expect(useViewer.getState().timeOfDayMinutes).toBe(minutes)
    useViewer.setState({ timeOfDayMinutes: 0 })
  }
})

test('duration zero, reduced motion and nearby elevations immediately leave a fixed explicit minute', () => {
  const to = timeTargetMinutes(dusk)
  for (const mode of ['zero', 'reduce', 'nearby']) {
    reduce = mode === 'reduce'
    useViewer.setState({
      timeOfDayMinutes: mode === 'nearby' ? to + 0.5 : null,
      skyLive: mode !== 'nearby',
    })
    transitionTimeOfDay(dusk, mode === 'zero' ? { durationMs: 0 } : {})
    expect(useViewer.getState()).toMatchObject({
      timeOfDay: 'golden',
      timeOfDayMinutes: to,
      skyLive: false,
    })
    expect(frames.size).toBe(0)
  }
})

test('elevations take the short route, cancel and restart from the displayed minute', () => {
  const dawn: TimeTarget = { elevation: 6, side: 'rising' }
  const to = timeTargetMinutes(dawn)
  useViewer.setState({ timeOfDayMinutes: 1430 })
  const cancel = transitionTimeOfDay(dawn, { durationMs: 1000, easing: (t) => t })
  frame(200)
  const displayed = (1430 + (to + 10) * 0.2) % 1440
  expect(useViewer.getState().timeOfDayMinutes).toBeCloseTo(displayed)
  cancel()
  frame(400)
  expect(useViewer.getState().timeOfDayMinutes).toBeCloseTo(displayed)
  const duskMinute = timeTargetMinutes(dusk)
  let delta = 0
  transitionTimeOfDay(dusk, {
    durationMs: (value) => {
      delta = value
      return 1000
    },
    easing: (t) => t,
  })
  frame(900)
  expect(delta).toBeCloseTo(duskMinute - displayed - 1440)
  const halfway = (displayed + delta * 0.5 + 1440) % 1440
  expect(useViewer.getState().timeOfDayMinutes).toBeCloseTo(halfway)
  transitionTimeOfDay(dawn, { durationMs: 1000, easing: (t) => t })
  frame(900)
  expect(useViewer.getState().timeOfDayMinutes).toBeCloseTo(halfway)
  expect(frames.size).toBe(1)
  frame(1900)
  expect(useViewer.getState()).toMatchObject({ timeOfDay: 'golden', timeOfDayMinutes: to })
  expect(frames.size).toBe(0)
})

test('a resting -2.5 degree sun keeps lamps on and exposure settles with the live clock off', async () => {
  transitionTimeOfDay(dusk, { durationMs: 0 })
  const minutes = useViewer.getState().timeOfDayMinutes
  let source: SceneAtmosphereSource | null = null
  function Probe() {
    source = useSceneAtmosphere()
    return null
  }
  const renderer = await create(
    <>
      <DaylightAtmosphere />
      <Probe />
    </>,
  )
  try {
    expect(useInteractive.getState().lampDefault).toBe(true)
    expect(daylightUniforms.lampLevel.value).toBeGreaterThan(0.8)
    const direction = source!.sunDirection.clone()
    await renderer.advanceFrames(300, 1 / 30)
    const exposure = source!.exposure
    expect(Number.isFinite(exposure)).toBe(true)
    const switches = spyOn(useInteractive.getState(), 'setLampDefault')
    try {
      setSystemTime(new Date(day.getTime() + 10 * 60_000))
      await act(async () => useViewer.setState({ timeOfDay: 'night' }))
      await renderer.advanceFrames(300, 1 / 30)
      expect(source!.sunDirection.distanceTo(direction)).toBeLessThan(1e-10)
      expect(source!.exposure).toBeCloseTo(exposure, 6)
      expect(useViewer.getState()).toMatchObject({ timeOfDayMinutes: minutes, skyLive: false })
      expect(useInteractive.getState().lampDefault).toBe(true)
      expect(switches).not.toHaveBeenCalled()
    } finally {
      switches.mockRestore()
    }
  } finally {
    await renderer.unmount()
  }
})
