import { afterEach, describe, expect, test } from 'bun:test'
import type { CameraPose } from '@pascal-app/core'
import { cameraPoseStore, publishCameraPose, subscribeCameraPose } from './camera-pose-store'

const pose: CameraPose = {
  position: [3, 4, 5],
  projection: 'perspective',
  target: [0, 1, 0],
  viewWidth: 12,
}

afterEach(() => {
  cameraPoseStore.setState({ pose: null })
})

describe('camera pose store', () => {
  test('replays the latest pose and streams later poses to focused subscribers', () => {
    publishCameraPose(pose)
    const received: CameraPose[] = []
    const unsubscribe = subscribeCameraPose((nextPose) => received.push(nextPose))
    const nextPose = { ...pose, viewWidth: 8 }

    publishCameraPose(nextPose)
    unsubscribe()
    publishCameraPose({ ...pose, viewWidth: 4 })

    expect(received).toEqual([pose, nextPose])
  })
})
