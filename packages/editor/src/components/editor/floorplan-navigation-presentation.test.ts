import { describe, expect, test } from 'bun:test'
import {
  canApplyFloorplanNavigationSync,
  canZoomFloorplanDuringNavigation,
  finalizeFloorplanNavigation,
  resolveFloorplanPresentationViewBox,
} from './floorplan-navigation-presentation'

describe('floorplan navigation presentation', () => {
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
})
