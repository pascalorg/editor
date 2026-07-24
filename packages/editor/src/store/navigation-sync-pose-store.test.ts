import { afterEach, describe, expect, test } from 'bun:test'
import {
  navigationSyncPoseStore,
  publishNavigationSyncPoseToStore,
  subscribeNavigationSyncPose,
} from './navigation-sync-pose-store'
import type { NavigationSyncPose } from './use-editor'

const pose = {
  source: '2d' as const,
  revision: 1,
  target: [1, 2, 3] as [number, number, number],
  azimuth: 0.5,
  viewWidth: 12,
}

afterEach(() => {
  navigationSyncPoseStore.setState({ pose: null })
})

describe('navigation sync pose store', () => {
  test('replays the latest pose and streams only later pose writes', () => {
    publishNavigationSyncPoseToStore(pose)
    const received: NavigationSyncPose[] = []
    const unsubscribe = subscribeNavigationSyncPose((nextPose) => received.push(nextPose))
    const nextPose = { ...pose, revision: 2, viewWidth: 8 }

    publishNavigationSyncPoseToStore(nextPose)
    unsubscribe()
    publishNavigationSyncPoseToStore({ ...pose, revision: 3 })

    expect(received).toEqual([pose, nextPose])
  })
})
