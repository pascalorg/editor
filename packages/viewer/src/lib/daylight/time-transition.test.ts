import { afterEach, beforeEach, expect, setSystemTime, spyOn, test } from 'bun:test'
import { SiteNode, useScene } from '@pascal-app/core'
import { presetInstant, solarClockMinutes, transitionTimeOfDay, useViewer } from '../../index'
import { cancelTimeTransition } from './time-transition'

const date = new Date('2026-06-21T12:00:00Z')
const location = { lat: 40.71, lng: -74 }
const target = (preset: Parameters<typeof transitionTimeOfDay>[0]) =>
  solarClockMinutes(presetInstant(date, location.lat, location.lng, preset), location.lng)
let previous: ReturnType<typeof useViewer.getState>
let graph: ReturnType<typeof useScene.getState>
let timestamp = 0
let reduce = false
let frames: Map<number, FrameRequestCallback>
let nextFrame = 0
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
  const keys = ['window', 'requestAnimationFrame', 'cancelAnimationFrame'] as const
  const descriptors = keys.map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  )
  frames = new Map()
  timestamp = 0
  reduce = false
  Object.assign(globalThis, {
    window: { matchMedia: () => ({ matches: reduce }) },
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      frames.set(++nextFrame, callback)
      return nextFrame
    },
    cancelAnimationFrame: (id: number) => frames.delete(id),
  })
  const clock = spyOn(performance, 'now').mockImplementation(() => timestamp)
  setSystemTime(date)
  useViewer.setState({
    daylightSite: { northRotation: 0, ...location },
    skyLive: false,
    timeOfDayMinutes: 0,
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
})

test('default duration and cubic easing preserve the sky preset minute sequence', () => {
  const to = target('midday')
  useViewer.setState({ timeOfDayMinutes: to - 360 })
  transitionTimeOfDay('midday')
  for (const [at, elapsed] of [
    [0, 0],
    [562.5, 22.5],
    [1125, 180],
    [1687.5, 337.5],
  ] as const) {
    frame(at)
    expect(useViewer.getState().timeOfDayMinutes).toBeCloseTo(to - 360 + elapsed)
  }
  frame(2250)
  expect(useViewer.getState()).toMatchObject({
    timeOfDay: 'midday',
    timeOfDayMinutes: null,
    skyLive: false,
  })
  expect(frames.size).toBe(0)
})

test('takes the shortest route across midnight and restarts from the displayed minute', () => {
  useViewer.setState({ timeOfDayMinutes: 1430 })
  transitionTimeOfDay('dawn', { durationMs: 1000, easing: (t) => t })
  frame(100)
  const displayed = useViewer.getState().timeOfDayMinutes!
  expect(displayed).toBeCloseTo((1430 + (target('dawn') + 10) * 0.1) % 1440)
  transitionTimeOfDay('midday', { durationMs: 1000, easing: (t) => t * t })
  frame(600)
  expect(useViewer.getState().timeOfDayMinutes).toBeCloseTo(
    displayed + (target('midday') - displayed) * 0.25,
  )
  expect(frames.size).toBe(1)
})

test('duration callback receives signed shortest delta and cancellation leaves the displayed clock', () => {
  const to = target('midday')
  useViewer.setState({ timeOfDayMinutes: to + 100 })
  let delta: number | undefined
  const cancel = transitionTimeOfDay('midday', {
    durationMs: (value) => {
      delta = value
      return 400
    },
    easing: (t) => t,
  })
  frame(100)
  expect(delta).toBeCloseTo(-100)
  expect(useViewer.getState().timeOfDayMinutes).toBeCloseTo(to + 75)
  cancel()
  frame(1000)
  expect(useViewer.getState().timeOfDayMinutes).toBeCloseTo(to + 75)
  expect(frames.size).toBe(0)
})

test('reduced motion and sub-minute differences settle without scheduling a frame', () => {
  reduce = true
  transitionTimeOfDay('night')
  expect(useViewer.getState().timeOfDay).toBe('night')
  reduce = false
  useViewer.setState({ timeOfDayMinutes: target('dawn') + 0.5 })
  transitionTimeOfDay('dawn')
  expect(useViewer.getState()).toMatchObject({ timeOfDay: 'dawn', timeOfDayMinutes: null })
  expect(frames.size).toBe(0)
})

test('resolves graph, baked override, live clock and current preset with renderer location precedence', () => {
  const site = SiteNode.parse({
    id: 'site_transition',
    dossier: {
      provider: 'test',
      asOf: date.toISOString(),
      sections: {},
      point: { lat: 1, lng: 2 },
    },
  })
  useScene.setState({ nodes: { [site.id]: site }, rootNodeIds: [site.id] })
  for (const override of [null, { northRotation: 0, ...location }]) {
    const point = override ?? { lat: 1, lng: 2 }
    for (const live of [true, false]) {
      useViewer.setState({
        daylightSite: override,
        timeOfDayMinutes: null,
        skyLive: live,
        timeOfDay: 'golden',
      })
      transitionTimeOfDay('midday', { durationMs: 1000 })
      frame(timestamp)
      const from = solarClockMinutes(
        live ? date : presetInstant(date, point.lat, point.lng, 'golden'),
        point.lng,
      )
      expect(useViewer.getState().timeOfDayMinutes).toBeCloseTo(from)
      frame(timestamp + 1000)
      expect(useViewer.getState().timeOfDayMinutes).toBeNull()
    }
  }
})

test('a SkyPanel preset click produces the default minute sequence with a fixed clock', async () => {
  const { create } = await import('@react-three/test-renderer')
  const { isValidElement } = await import('react')
  const { SkyPanel } = await import('../../ui/components/sky-control')
  const to = target('midday')
  const from = to - 360
  useViewer.setState({ timeOfDayMinutes: from })
  let select: (() => void) | undefined
  function Panel() {
    const tree = SkyPanel({
      sky: {
        minutes: from,
        clock: from,
        phase: 'dawn',
        activePreset: null,
        presets: {
          dawn: target('dawn'),
          midday: to,
          golden: target('golden'),
          blue: target('blue'),
          night: target('night'),
        },
        events: { sunrise: 360, sunset: 1080 },
        skyLive: false,
        weather: 'fair',
        source: 'site',
      },
    })
    const visit = (element: unknown) => {
      if (Array.isArray(element)) {
        for (const child of element) visit(child)
        return
      }
      if (!isValidElement<{ name?: string; onSelect?: () => void; children?: unknown }>(element))
        return
      if (element.props.name === 'Midday') select = element.props.onSelect
      visit(element.props.children)
    }
    visit(tree)
    return null
  }
  const { createElement } = await import('react')
  const renderer = await create(createElement(Panel))
  try {
    expect(select).toBeDefined()
    select!()
    frame(562.5)
    expect(useViewer.getState().timeOfDayMinutes).toBeCloseTo(from + 22.5)
    frame(1125)
    expect(useViewer.getState().timeOfDayMinutes).toBeCloseTo(from + 180)
    frame(1687.5)
    expect(useViewer.getState().timeOfDayMinutes).toBeCloseTo(from + 337.5)
    frame(2250)
    expect(useViewer.getState()).toMatchObject({ timeOfDay: 'midday', timeOfDayMinutes: null })
  } finally {
    await renderer.unmount()
  }
})
