import { afterEach, describe, expect, test } from 'bun:test'
import { useScene } from '@pascal-app/core'
import {
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Raycaster,
  Vector3,
} from 'three'
import { castVisibleMeasurementSurface, selectClosestVerifiedAxisProjection } from './surface-query'

afterEach(() => {
  useScene.setState({ nodes: {} } as never)
})

function createSurface(z: number) {
  const surface = new Mesh(new PlaneGeometry(2, 2), new MeshBasicMaterial({ side: DoubleSide }))
  surface.position.z = z
  return surface
}

describe('smart measurement surface priority', () => {
  test('prefers a zone over a nearly coplanar slab', () => {
    const root = new Group()
    const slab = createSurface(0.04)
    const zone = createSurface(0)
    root.add(slab, zone)
    root.updateMatrixWorld(true)
    useScene.setState({
      nodes: {
        slab_1: { type: 'slab' },
        zone_1: { type: 'zone' },
      },
    } as never)

    const hit = castVisibleMeasurementSurface(
      new Raycaster(new Vector3(0, 0, 1), new Vector3(0, 0, -1)),
      {
        includeZoneLayer: true,
        ownerByObject: new Map([
          [slab, 'slab_1'],
          [zone, 'zone_1'],
        ]),
        roots: [slab, zone],
      },
    )

    expect(hit?.targetNodeId).toBe('zone_1')
    slab.geometry.dispose()
    slab.material.dispose()
    zone.geometry.dispose()
    zone.material.dispose()
  })

  test('keeps a wall even when the zone is nearly coplanar', () => {
    const root = new Group()
    const wall = createSurface(0.04)
    const zone = createSurface(0)
    root.add(wall, zone)
    root.updateMatrixWorld(true)
    useScene.setState({
      nodes: {
        wall_1: { type: 'wall' },
        zone_1: { type: 'zone' },
      },
    } as never)

    const hit = castVisibleMeasurementSurface(
      new Raycaster(new Vector3(0, 0, 1), new Vector3(0, 0, -1)),
      {
        includeZoneLayer: true,
        ownerByObject: new Map([
          [wall, 'wall_1'],
          [zone, 'zone_1'],
        ]),
        roots: [wall, zone],
      },
    )

    expect(hit?.targetNodeId).toBe('wall_1')
    wall.geometry.dispose()
    wall.material.dispose()
    zone.geometry.dispose()
    zone.material.dispose()
  })
})

describe('measurement axis acquisition', () => {
  test('acquires a verified axis within sixteen screen pixels', () => {
    expect(
      selectClosestVerifiedAxisProjection([
        {
          axis: 'z',
          point: [1, 0, 7],
          screenDistance: 15,
          verified: true,
        },
      ]),
    ).toEqual({ axis: 'z', point: [1, 0, 7] })
  })
})
