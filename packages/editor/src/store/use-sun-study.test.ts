import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { type AnyNode, type AnyNodeId, SiteNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import useSunStudy, {
  isSiteLocated,
  minutesIntoDay,
  readSiteSunSettings,
  resolveSunDirection,
  resolveSunPosition,
  startSunStudyTracking,
  stopSunStudyTracking,
} from './use-sun-study'

// Polyfills for bun:test (no DOM) — scene writes schedule a dirty flush on an
// animation frame.
type RafFn = (cb: (t: number) => void) => number
;(globalThis as unknown as { requestAnimationFrame?: RafFn }).requestAnimationFrame ??= ((
  cb: (t: number) => void,
) => {
  cb(0)
  return 0
}) as RafFn
;(globalThis as unknown as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame ??=
  () => {}

const ISTANBUL_NOON_UTC = Date.UTC(2024, 5, 21, 9, 0)

function seedSite(patch: Partial<{ latitude: number; longitude: number; northOffset: number }>) {
  const site = SiteNode.parse({ ...patch })
  useScene.setState({
    nodes: { [site.id]: site as unknown as AnyNode } as Record<AnyNodeId, AnyNode>,
    rootNodeIds: [site.id],
    readOnly: false,
  })
  return site
}

beforeEach(() => {
  stopSunStudyTracking()
  useScene.setState({ nodes: {}, rootNodeIds: [] })
  useViewer.setState({ sunDirection: null })
  useSunStudy.setState({ enabled: false, dateMs: ISTANBUL_NOON_UTC })
})

afterEach(() => {
  stopSunStudyTracking()
  useScene.setState({ nodes: {}, rootNodeIds: [] })
  useViewer.setState({ sunDirection: null })
})

describe('readSiteSunSettings', () => {
  test('returns null when the scene has no site', () => {
    expect(readSiteSunSettings()).toBeNull()
  })

  test('reads coordinates and north off the site', () => {
    seedSite({ latitude: 41, longitude: 29, northOffset: 30 })
    expect(readSiteSunSettings()).toMatchObject({ latitude: 41, longitude: 29, northOffset: 30 })
  })

  test('an existing scene loads north-up and unplaced', () => {
    seedSite({})
    const settings = readSiteSunSettings()
    expect(settings?.northOffset).toBe(0)
    expect(isSiteLocated(settings)).toBe(false)
  })
})

describe('resolveSunDirection', () => {
  test('a disabled study leaves the key light to the theme', () => {
    seedSite({ latitude: 41, longitude: 29 })
    expect(resolveSunDirection()).toBeNull()
  })

  test('an unplaced site cannot be studied', () => {
    seedSite({})
    useSunStudy.setState({ enabled: true })
    expect(resolveSunDirection()).toBeNull()
  })

  test('a located site with the study on resolves a unit vector', () => {
    seedSite({ latitude: 41.0082, longitude: 28.9784 })
    useSunStudy.setState({ enabled: true, dateMs: ISTANBUL_NOON_UTC })

    const direction = resolveSunDirection()
    expect(direction).not.toBeNull()
    if (!direction) return
    expect(Math.hypot(...direction)).toBeCloseTo(1, 9)
    // Midday in June at 41°N: sun high and to the south (+Z).
    expect(direction[1]).toBeGreaterThan(0.8)
    expect(direction[2]).toBeGreaterThan(0)
  })

  test('project north swings the sun with the model', () => {
    seedSite({ latitude: 41.0082, longitude: 28.9784 })
    useSunStudy.setState({ enabled: true, dateMs: ISTANBUL_NOON_UTC })
    const northUp = resolveSunDirection()

    seedSite({ latitude: 41.0082, longitude: 28.9784, northOffset: 90 })
    const turned = resolveSunDirection()

    expect(northUp).not.toEqual(turned)
    // Same altitude, different bearing.
    expect(turned?.[1]).toBeCloseTo(northUp?.[1] as number, 9)
  })

  test('night resolves a downward sun rather than nothing', () => {
    seedSite({ latitude: 41.0082, longitude: 28.9784 })
    useSunStudy.setState({ enabled: true, dateMs: Date.UTC(2024, 0, 15, 0, 0) })

    expect(resolveSunDirection()?.[1]).toBeLessThan(0)
  })
})

describe('resolveSunPosition', () => {
  test('reports angles even while the study is off, for the read-out', () => {
    seedSite({ latitude: 41.0082, longitude: 28.9784 })
    const position = resolveSunPosition()
    expect(position?.altitude).toBeGreaterThan(0)
  })

  test('null for an unplaced site', () => {
    seedSite({})
    expect(resolveSunPosition()).toBeNull()
  })
})

describe('sun study tracking', () => {
  test('pushes the resolved direction into the viewer', () => {
    seedSite({ latitude: 41.0082, longitude: 28.9784 })
    startSunStudyTracking()
    expect(useViewer.getState().sunDirection).toBeNull()

    useSunStudy.getState().setEnabled(true)

    expect(useViewer.getState().sunDirection).not.toBeNull()
  })

  test('follows the clock', () => {
    seedSite({ latitude: 41.0082, longitude: 28.9784 })
    useSunStudy.setState({ enabled: true, dateMs: ISTANBUL_NOON_UTC })
    startSunStudyTracking()
    const noon = useViewer.getState().sunDirection

    useSunStudy.getState().setDateMs(ISTANBUL_NOON_UTC + 5 * 3_600_000)

    expect(useViewer.getState().sunDirection).not.toEqual(noon)
  })

  test('follows the site — placing the project lights it', () => {
    seedSite({})
    useSunStudy.setState({ enabled: true })
    startSunStudyTracking()
    expect(useViewer.getState().sunDirection).toBeNull()

    const site = readSiteSunSettings()
    if (!site) throw new Error('expected a site')
    useScene.getState().updateNode(site.siteId, {
      latitude: 41.0082,
      longitude: 28.9784,
    } as Partial<AnyNode>)

    expect(useViewer.getState().sunDirection).not.toBeNull()
  })

  test('stopping hands the key light back to the theme', () => {
    seedSite({ latitude: 41.0082, longitude: 28.9784 })
    useSunStudy.setState({ enabled: true })
    startSunStudyTracking()
    expect(useViewer.getState().sunDirection).not.toBeNull()

    stopSunStudyTracking()

    expect(useViewer.getState().sunDirection).toBeNull()
  })

  test('an unchanged sun does not rewrite the viewer', () => {
    seedSite({ latitude: 41.0082, longitude: 28.9784 })
    useSunStudy.setState({ enabled: true })
    startSunStudyTracking()
    const first = useViewer.getState().sunDirection

    // A scene write that changes nothing solar must not churn the reference.
    const site = readSiteSunSettings()
    if (!site) throw new Error('expected a site')
    useScene.getState().updateNode(site.siteId, { name: 'Renamed' } as Partial<AnyNode>)

    expect(useViewer.getState().sunDirection).toBe(first)
  })
})

describe('minutesIntoDay', () => {
  test('reads the local wall clock', () => {
    const date = new Date(2024, 5, 21, 14, 30)
    expect(minutesIntoDay(date.getTime())).toBe(14 * 60 + 30)
  })

  test('setMinutesIntoDay moves within the day without changing the date', () => {
    useSunStudy.setState({ dateMs: new Date(2024, 5, 21, 8, 0).getTime() })
    useSunStudy.getState().setMinutesIntoDay(17 * 60 + 15)

    const moved = new Date(useSunStudy.getState().dateMs)
    expect(moved.getDate()).toBe(21)
    expect(moved.getHours()).toBe(17)
    expect(moved.getMinutes()).toBe(15)
  })
})
