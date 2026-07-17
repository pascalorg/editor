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
import {
  castVisibleMeasurementSurface,
  selectClosestVerifiedAxisProjection,
  selectMeasurementSurfaceHit,
} from './surface-query'

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

describe('polygon measurement surface intent', () => {
  test('prefers a nearby floor at a wall corner but keeps a deliberate wall-face pick', () => {
    const level = new Group()
    const material = new MeshBasicMaterial({ side: DoubleSide })
    const wall = new Mesh(new PlaneGeometry(4, 4), material)
    const slab = new Mesh(new PlaneGeometry(16, 16), material)
    wall.position.z = 0.1
    slab.rotation.x = -Math.PI / 2
    level.add(wall, slab)
    level.updateMatrixWorld(true)
    useScene.setState({
      nodes: {
        wall_1: { type: 'wall' },
        slab_1: { type: 'slab' },
      },
    } as never)

    const hitsFor = (target: Vector3) =>
      new Raycaster(
        new Vector3(0, 1, 2),
        target
          .clone()
          .sub(new Vector3(0, 1, 2))
          .normalize(),
      )
        .intersectObjects([wall, slab])
        .map((intersection) => ({
          intersection,
          targetNodeId: intersection.object === wall ? 'wall_1' : 'slab_1',
        }))

    const cornerHits = hitsFor(new Vector3(0, 0, 0))
    expect(cornerHits[0]?.targetNodeId).toBe('wall_1')
    expect(
      selectMeasurementSurfaceHit(cornerHits, level, { kind: 'horizontal' })?.targetNodeId,
    ).toBe('slab_1')
    expect(
      selectMeasurementSurfaceHit(cornerHits, level, {
        kind: 'plane',
        point: [0, 0, 0],
        normal: [0, 1, 0],
      })?.targetNodeId,
    ).toBe('slab_1')

    const wallFaceHits = hitsFor(new Vector3(0, 0.7, 0))
    expect(
      selectMeasurementSurfaceHit(wallFaceHits, level, { kind: 'horizontal' })?.targetNodeId,
    ).toBe('wall_1')
    const tableTop = new Mesh(new PlaneGeometry(4, 4), material)
    tableTop.position.y = 0.3
    tableTop.rotation.x = -Math.PI / 2
    level.add(tableTop)
    level.updateMatrixWorld(true)
    useScene.setState({
      nodes: { ...useScene.getState().nodes, item_1: { type: 'item' } },
    } as never)
    const horizontalOccluderHits = new Raycaster(
      new Vector3(0, 1, 2),
      new Vector3(0, -1, -2).normalize(),
    )
      .intersectObjects([wall, slab, tableTop])
      .map((intersection) => ({
        intersection,
        targetNodeId:
          intersection.object === wall
            ? 'wall_1'
            : intersection.object === slab
              ? 'slab_1'
              : 'item_1',
      }))
    expect(
      selectMeasurementSurfaceHit(horizontalOccluderHits, level, { kind: 'horizontal' })
        ?.targetNodeId,
    ).toBe('item_1')
    wall.geometry.dispose()
    slab.geometry.dispose()
    tableTop.geometry.dispose()
    material.dispose()
  })
})
