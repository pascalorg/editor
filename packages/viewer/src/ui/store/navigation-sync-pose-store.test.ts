import { afterEach, describe, expect, test } from 'bun:test'
import {
  type NavigationSyncPose,
  navigationSyncPoseStore,
  publishNavigationSyncPose,
  subscribeNavigationSyncPose,
} from './navigation-sync-pose-store'

const pose = {
  source: '2d' as const,
  target: [1, 2, 3] as [number, number, number],
  azimuth: 0.5,
  viewWidth: 12,
}

afterEach(() => {
  navigationSyncPoseStore.setState({ pose: null })
})

describe('navigation sync pose store', () => {
  test('replays the latest pose and streams only later pose writes, each with the next revision', () => {
    publishNavigationSyncPose(pose)
    const received: NavigationSyncPose[] = []
    const unsubscribe = subscribeNavigationSyncPose((nextPose) => received.push(nextPose))

    publishNavigationSyncPose({ ...pose, viewWidth: 8 })
    unsubscribe()
    publishNavigationSyncPose(pose)

    expect(received).toEqual([
      { ...pose, revision: 1 },
      { ...pose, viewWidth: 8, revision: 2 },
    ])
    expect(navigationSyncPoseStore.getState().pose?.revision).toBe(3)
  })
})
