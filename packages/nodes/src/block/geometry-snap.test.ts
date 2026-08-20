import { describe, expect, test } from 'bun:test'
import { createBoxBlockTopology } from '@pascal-app/core'
import { PerspectiveCamera, Vector3 } from 'three'
import { blockGeometrySnapThreshold, resolveBlockGeometrySnap } from './geometry-snap'

describe('block geometry snapping', () => {
  test('keeps the acquisition radius consistent in screen pixels as the camera moves', () => {
    const camera = new PerspectiveCamera(60, 1, 0.1, 100)
    camera.position.set(0, 0, 5)
    camera.updateMatrixWorld()
    const nearThreshold = blockGeometrySnapThreshold(
      camera,
      new Vector3(0, 0, 0),
      1000,
      new Vector3(1, 1, 1),
    )

    camera.position.z = 10
    camera.updateMatrixWorld()
    const farThreshold = blockGeometrySnapThreshold(
      camera,
      new Vector3(0, 0, 0),
      1000,
      new Vector3(1, 1, 1),
    )

    expect(farThreshold / nearThreshold).toBeCloseTo(2)
  })

  test('snaps a selected vertex to another vertex', () => {
    const snap = resolveBlockGeometrySnap(
      createBoxBlockTopology(),
      { mode: 'vertex', ids: ['v6'], activeId: 'v6' },
      [-1.96, 0, 0],
      'free',
      0.1,
    )

    expect(snap?.kind).toBe('vertex')
    expect(snap?.targetId).toBe('v7')
    expect(snap?.delta).toEqual([-2, 0, 0])
  })

  test('respects an axis constraint while snapping selection center to an edge', () => {
    const snap = resolveBlockGeometrySnap(
      createBoxBlockTopology(),
      { mode: 'edge', ids: ['e5'], activeId: 'e5' },
      [-1.93, 0, 0],
      'x',
      0.1,
    )

    expect(snap?.kind).toBe('edge')
    expect(snap?.targetId).toBe('e7')
    expect(snap?.delta[1]).toBe(0)
    expect(snap?.delta[2]).toBe(0)
  })

  test('snaps an active face center onto another face surface', () => {
    const snap = resolveBlockGeometrySnap(
      createBoxBlockTopology(),
      { mode: 'face', ids: ['f-top'], activeId: 'f-top' },
      [0, -2.35, 0],
      'y',
      0.1,
    )

    expect(snap?.kind).toBe('face')
    expect(snap?.targetId).toBe('f-bottom')
    expect(snap?.delta).toEqual([0, -2.4, 0])
  })

  test('returns no snap outside the acquisition threshold', () => {
    expect(
      resolveBlockGeometrySnap(
        createBoxBlockTopology(),
        { mode: 'vertex', ids: ['v6'], activeId: 'v6' },
        [-1.5, 0, 0],
        'free',
        0.1,
      ),
    ).toBeNull()
  })
})
