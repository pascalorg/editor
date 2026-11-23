import { describe, expect, test } from 'bun:test'
import {
  createFloorplanNavigationSyncScheduler,
  setFloorplanCompassRotation,
} from './floorplan-navigation-sync'

describe('floorplan navigation sync', () => {
  test('updates the compass presentation on every live rotation frame', () => {
    const compass = { style: { transform: '' } }

    setFloorplanCompassRotation(compass, 0.25)
    expect(compass.style.transform).toBe('rotate(0.25deg)')

    setFloorplanCompassRotation(compass, 0.5)
    expect(compass.style.transform).toBe('rotate(0.5deg)')
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
