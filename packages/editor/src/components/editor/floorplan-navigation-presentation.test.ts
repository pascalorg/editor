import { describe, expect, test } from 'bun:test'
import {
  canApplyFloorplanNavigationSync,
  canZoomFloorplanDuringNavigation,
  createFloorplanNavigationSyncScheduler,
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
