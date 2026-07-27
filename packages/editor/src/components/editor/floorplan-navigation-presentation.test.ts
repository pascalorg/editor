import { describe, expect, test } from 'bun:test'
import {
  canApplyFloorplanNavigationSync,
  canZoomFloorplanDuringNavigation,
  createFloorplanNavigationSyncScheduler,
  finalizeFloorplanNavigation,
  flushFloorplanRotationPresentationRestore,
  getFloorplanRotationOverscanViewBox,
  queueFloorplanRotationPresentationRestore,
  resolveFloorplanPresentationViewBox,
  setFloorplanCompassRotation,
} from './floorplan-navigation-presentation'

describe('floorplan navigation presentation', () => {
  test('keeps the viewport inside the painted floorplan surface throughout rotation', () => {
    const viewport = { minX: -80, minY: -45, width: 160, height: 90 }
    const overscan = getFloorplanRotationOverscanViewBox(viewport)
    const viewportCorners: Array<[number, number]> = [
      [-80, -45],
      [80, -45],
      [80, 45],
      [-80, 45],
    ]

    for (let degrees = 0; degrees < 360; degrees += 1) {
      const radians = (-degrees * Math.PI) / 180
      const cos = Math.cos(radians)
      const sin = Math.sin(radians)

      for (const [x, y] of viewportCorners) {
        const localX = x * cos - y * sin
        const localY = x * sin + y * cos
        expect(localX).toBeGreaterThanOrEqual(overscan.minX - 1e-10)
        expect(localX).toBeLessThanOrEqual(overscan.minX + overscan.width + 1e-10)
        expect(localY).toBeGreaterThanOrEqual(overscan.minY - 1e-10)
        expect(localY).toBeLessThanOrEqual(overscan.minY + overscan.height + 1e-10)
      }
    }
  })

  test('keeps the imperative viewBox authoritative during navigation', () => {
    const reactViewBox = { minX: 0, minY: 0, width: 100, height: 50 }
    const imperativeViewBox = { minX: 25, minY: 10, width: 40, height: 20 }

    expect(resolveFloorplanPresentationViewBox(reactViewBox, imperativeViewBox, true)).toBe(
      imperativeViewBox,
    )
    expect(resolveFloorplanPresentationViewBox(reactViewBox, imperativeViewBox, false)).toBe(
      reactViewBox,
    )
  })

  test('does not mix wheel zoom with a compositor rotation preview', () => {
    expect(canZoomFloorplanDuringNavigation(true)).toBe(false)
    expect(canZoomFloorplanDuringNavigation(false)).toBe(true)
  })

  test('does not apply synchronized camera poses over local navigation', () => {
    expect(canApplyFloorplanNavigationSync(true)).toBe(false)
    expect(canApplyFloorplanNavigationSync(false)).toBe(true)
  })

  test('updates the compass presentation on every live rotation frame', () => {
    const compass = { style: { transform: '' } }

    setFloorplanCompassRotation(compass, 0.25)
    expect(compass.style.transform).toBe('rotate(0.25deg)')

    setFloorplanCompassRotation(compass, 0.5)
    expect(compass.style.transform).toBe('rotate(0.5deg)')
  })

  test('keeps the rotation preview in place until the committed state is ready to paint', () => {
    const pending = { current: null }
    const svg = {
      style: {
        transform: 'rotate(42deg)',
        transformOrigin: 'center',
        willChange: 'transform',
      },
    }
    const presentation = {
      svg,
      svgStyle: {
        transform: '',
        transformOrigin: '',
        willChange: '',
      },
    }

    queueFloorplanRotationPresentationRestore(pending, presentation)
    expect(svg.style.transform).toBe('rotate(42deg)')

    flushFloorplanRotationPresentationRestore(pending)
    expect(svg.style.transform).toBe('')
    expect(pending.current).toBeNull()
  })

  test('commits every active navigation channel before teardown', () => {
    const calls: string[] = []
    const rotationState = { angle: 42 }

    finalizeFloorplanNavigation({
      zoomPending: true,
      panActive: true,
      rotationState,
      commitZoom: () => calls.push('zoom'),
      commitPan: () => calls.push('pan'),
      commitRotation: (state) => calls.push(`rotation:${state.angle}`),
    })

    expect(calls).toEqual(['zoom', 'pan', 'rotation:42'])
  })

  test('coalesces a camera pose stream into one settled React commit', () => {
    const presented: number[] = []
    const committed: number[] = []
    let scheduled: (() => void) | null = null
    const scheduler = createFloorplanNavigationSyncScheduler<number>({
      applyPresentation: (pose) => presented.push(pose),
      commit: (pose) => committed.push(pose),
      schedule: (callback) => {
        scheduled = callback
        return 1 as unknown as ReturnType<typeof globalThis.setTimeout>
      },
      cancel: () => {
        scheduled = null
      },
    })

    for (let pose = 1; pose <= 30; pose += 1) {
      scheduler.update(pose)
    }

    expect(presented).toHaveLength(30)
    expect(committed).toEqual([])

    const settle = scheduled as (() => void) | null
    settle?.()
    expect(committed).toEqual([30])
  })
})
