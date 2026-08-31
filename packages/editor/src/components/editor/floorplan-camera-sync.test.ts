import { describe, expect, test } from 'bun:test'
import type { CameraPose } from '@pascal-app/core'
import { publishInitialCameraPose } from '../../lib/camera-pose'
import type { NavigationSyncPose } from '../../store/use-editor'
import {
  cameraPoseToFloorplanNavigationPose,
  createFloorplanCameraNavigationChannel,
  createFloorplanCameraSyncBridge,
  floorplanNavigationPoseToCameraPose,
} from './floorplan-camera-sync'

const cameraPose: CameraPose = {
  fov: 50,
  position: [3, 4, 4],
  projection: 'perspective',
  target: [0, 1, 0],
  viewWidth: 12,
}

function cameraPoseAtAzimuth(
  azimuth: number,
  target: [number, number, number] = [0, 1, 0],
): CameraPose {
  const horizontalDistance = 5
  return {
    ...cameraPose,
    position: [
      target[0] + Math.sin(azimuth) * horizontalDistance,
      4,
      target[2] + Math.cos(azimuth) * horizontalDistance,
    ],
    target,
  }
}

describe('floorplan camera sync', () => {
  test('derives the floor-plan navigation pose from the generic camera pose', () => {
    expect(
      cameraPoseToFloorplanNavigationPose({
        position: [10, 5, 0],
        projection: 'perspective',
        target: [0, 0, 0],
        viewWidth: 20,
      }),
    ).toEqual({
      source: '3d',
      target: [0, 0, 0],
      azimuth: Math.PI / 2,
      viewWidth: 20,
    })
  })

  test('applies a floor-plan pose while preserving the generic camera elevation and projection', () => {
    expect(
      floorplanNavigationPoseToCameraPose(
        {
          source: '2d',
          revision: 4,
          target: [10, 2, 20],
          azimuth: Math.PI / 2,
          viewWidth: 8,
        },
        cameraPose,
      ),
    ).toEqual({
      fov: 50,
      position: [15, 5, 20],
      projection: 'perspective',
      target: [10, 2, 20],
      viewWidth: 8,
    })
  })

  test('owns two-way synchronization without echoing tiny camera changes', () => {
    const published: Array<Omit<NavigationSyncPose, 'revision'>> = []
    const applied: CameraPose[] = []
    const bridge = createFloorplanCameraSyncBridge({
      applyCameraPose: (pose) => applied.push(pose),
      publishNavigationPose: (pose) => published.push(pose),
    })

    bridge.receiveCameraPose(cameraPose)
    bridge.receiveCameraPose({
      ...cameraPose,
      position: [3.0001, 4, 4],
    })
    bridge.receiveNavigationPose({
      source: '2d',
      revision: 1,
      target: [10, 2, 20],
      azimuth: Math.PI / 2,
      viewWidth: 8,
    })

    expect(published).toHaveLength(1)
    expect(published[0]?.source).toBe('3d')
    expect(applied).toHaveLength(1)
    expect(applied[0]).toMatchObject({
      fov: 50,
      projection: 'perspective',
      target: [10, 2, 20],
      viewWidth: 8,
    })
    expect(applied[0]?.position[0]).toBeCloseTo(15)
    expect(applied[0]?.position[1]).toBeCloseTo(5)
    expect(applied[0]?.position[2]).toBeCloseTo(20)
  })

  test('publishes sub-degree camera rotation for a real-time compass', () => {
    const published: Array<Omit<NavigationSyncPose, 'revision'>> = []
    const bridge = createFloorplanCameraSyncBridge({
      applyCameraPose: () => {},
      publishNavigationPose: (pose) => published.push(pose),
    })

    bridge.receiveCameraPose(cameraPoseAtAzimuth(0))
    bridge.receiveCameraPose(cameraPoseAtAzimuth((0.9 * Math.PI) / 180))
    expect(published).toHaveLength(2)
    expect(published[1]?.azimuth).toBeCloseTo((0.9 * Math.PI) / 180)
  })

  test('keeps a sub-degree camera rotation when it arrives with a pan', () => {
    const published: Array<Omit<NavigationSyncPose, 'revision'>> = []
    const bridge = createFloorplanCameraSyncBridge({
      applyCameraPose: () => {},
      publishNavigationPose: (pose) => published.push(pose),
    })

    bridge.receiveCameraPose(cameraPoseAtAzimuth(0))
    bridge.receiveCameraPose(cameraPoseAtAzimuth((0.5 * Math.PI) / 180, [1, 1, 0]))

    expect(published).toHaveLength(2)
    expect(published[1]).toMatchObject({
      target: [1, 1, 0],
    })
    expect(published[1]?.azimuth).toBeCloseTo((0.5 * Math.PI) / 180)
  })

  test('keeps streaming live camera headings in 3D-only mode', () => {
    const published: Array<Omit<NavigationSyncPose, 'revision'>> = []
    const applied: CameraPose[] = []
    const bridge = createFloorplanCameraSyncBridge({
      active: false,
      applyCameraPose: (pose) => applied.push(pose),
      publishNavigationPose: (pose) => published.push(pose),
    })
    const latestPose = cameraPoseAtAzimuth(Math.PI / 2, [8, 1, 4])

    bridge.receiveCameraPose(cameraPoseAtAzimuth(0))
    bridge.receiveCameraPose(latestPose)
    bridge.receiveNavigationPose({
      source: '2d',
      revision: 1,
      target: [10, 2, 20],
      azimuth: Math.PI / 2,
      viewWidth: 8,
    })

    expect(published).toEqual([
      {
        source: '3d',
        target: cameraPose.target,
        azimuth: 0,
        viewWidth: 12,
      },
      {
        source: '3d',
        target: latestPose.target,
        azimuth: Math.PI / 2,
        viewWidth: 12,
      },
    ])
    expect(applied).toEqual([])

    bridge.setActive(true)
    expect(published).toHaveLength(2)
    expect(applied).toEqual([])
  })

  test('applies the north-alignment pose used by the compass in 3D view', () => {
    const applied: CameraPose[] = []
    const bridge = createFloorplanCameraSyncBridge({
      applyCameraPose: (pose) => applied.push(pose),
      publishNavigationPose: () => {},
    })
    const currentPose = cameraPoseAtAzimuth(Math.PI / 2, [8, 1, 4])

    bridge.receiveCameraPose(currentPose)
    bridge.receiveNavigationPose({
      source: '2d',
      revision: 1,
      target: [...currentPose.target],
      azimuth: 0,
      viewWidth: currentPose.viewWidth!,
    })

    expect(applied).toHaveLength(1)
    expect(applied[0]).toMatchObject({
      target: currentPose.target,
      projection: currentPose.projection,
      viewWidth: currentPose.viewWidth,
    })
    expect(applied[0]?.position[0]).toBeCloseTo(currentPose.target[0])
    expect(applied[0]?.position[1]).toBeCloseTo(currentPose.position[1])
    expect(applied[0]?.position[2]).toBeCloseTo(currentPose.target[2] + 5)
  })

  test('applies 2D-first navigation on initial load without a 3D interaction', () => {
    const applied: CameraPose[] = []
    const bridge = createFloorplanCameraSyncBridge({
      applyCameraPose: (pose) => applied.push(pose),
      publishNavigationPose: () => {},
    })

    bridge.receiveNavigationPose({
      source: '2d',
      revision: 1,
      target: [10, 2, 20],
      azimuth: Math.PI / 2,
      viewWidth: 8,
    })
    expect(applied).toEqual([])

    publishInitialCameraPose(() => bridge.receiveCameraPose(cameraPose))
    expect(applied).toHaveLength(1)
  })

  test('delivers the live camera stream through transient subscribers', () => {
    const channel = createFloorplanCameraNavigationChannel()
    const received: NavigationSyncPose[] = []
    const unsubscribe = channel.subscribe((pose) => received.push(pose))
    const input = {
      source: '3d' as const,
      target: [0, 1, 2] as [number, number, number],
      azimuth: 0.5,
      viewWidth: 12,
    }

    channel.publish(input)
    channel.publish({ ...input, azimuth: 0.75 })
    unsubscribe()
    channel.publish({ ...input, azimuth: 1 })

    expect(received).toEqual([
      { ...input, revision: 1 },
      { ...input, azimuth: 0.75, revision: 2 },
    ])
  })
})
