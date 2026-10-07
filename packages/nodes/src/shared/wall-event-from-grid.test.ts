import { expect, test } from 'bun:test'
import { BuildingNode, type GridEvent, LevelNode, WallNode } from '@pascal-app/core'
import { BoxGeometry, Group, Matrix3, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three'
import { wallEventFromGrid } from './wall-event-from-grid'

function fixture() {
  const building = BuildingNode.parse({})
  const level = LevelNode.parse({ parentId: building.id })
  const wall = WallNode.parse({ parentId: level.id, start: [2, 4], end: [2, 14] })
  const frame = new Group()
  const object = new Mesh(new BoxGeometry(10, 3, 0.2), new MeshBasicMaterial())
  frame.position.set(20, 6, -10)
  frame.rotation.y = 0.63
  object.position.set(2, 0.2, 4)
  object.rotation.y = -Math.PI / 2
  frame.add(object)
  frame.updateMatrixWorld(true)
  const point = object.localToWorld(new Vector3(2, 1.4, 0.1))
  const normal = new Vector3(0, 0, 1).applyNormalMatrix(
    new Matrix3().getNormalMatrix(object.matrixWorld),
  )
  const localNormal = normal
    .clone()
    .applyNormalMatrix(new Matrix3().getNormalMatrix(frame.matrixWorld.clone().invert()))
  const event: GridEvent = {
    position: point.toArray(),
    localPosition: frame.worldToLocal(point.clone()).toArray(),
    localFrameId: building.id,
    surfaceNormal: localNormal.toArray(),
    surfaceHit: { kind: 'wall', hostId: wall.id, face: 'side' },
    nativeEvent: { timeStamp: 42 } as GridEvent['nativeEvent'],
  }
  return {
    building,
    level,
    wall,
    frame,
    object,
    point,
    normal,
    event,
    nodes: { [building.id]: building, [level.id]: level, [wall.id]: wall },
    objects: new Map([
      [building.id, frame],
      [wall.id, object],
    ]),
  }
}

test('an actual batched wall surface gives Window a wall-local target without a wall mesh event', () => {
  const f = fixture()
  f.object.layers.set(5)
  const ray = new Raycaster(f.point.clone().addScaledVector(f.normal, 3), f.normal.clone().negate())
  ray.layers.enable(5)
  const hit = ray.intersectObject(f.object)[0]!
  expect(hit).toBeDefined()
  const event = wallEventFromGrid(
    { ...f.event, position: hit.point.toArray() },
    f.level.id,
    f.nodes,
    f.objects,
  )!
  expect(event.node.id).toBe(f.wall.id)
  expect(new Vector3(...event.localPosition).distanceTo(new Vector3(2, 1.4, 0.1))).toBeLessThan(
    1e-8,
  )
  expect(new Vector3(...event.normal!).distanceTo(new Vector3(0, 0, 1))).toBeLessThan(1e-8)
  expect(event.nativeEvent.timeStamp).toBe(42)
})

test('fallback placement still rejects other floors, non-wall surfaces, tops and curved walls', () => {
  const f = fixture()
  expect(wallEventFromGrid(f.event, LevelNode.parse({}).id, f.nodes, f.objects)).toBeNull()
  expect(
    wallEventFromGrid({ ...f.event, surfaceHit: undefined }, f.level.id, f.nodes, f.objects),
  ).toBeNull()
  expect(
    wallEventFromGrid(
      { ...f.event, surfaceHit: { kind: 'slab', hostId: f.wall.id, face: 'top' } },
      f.level.id,
      f.nodes,
      f.objects,
    ),
  ).toBeNull()
  expect(
    wallEventFromGrid({ ...f.event, surfaceNormal: [0, 1, 0] }, f.level.id, f.nodes, f.objects),
  ).toBeNull()
  expect(
    wallEventFromGrid(
      f.event,
      f.level.id,
      { ...f.nodes, [f.wall.id]: { ...f.wall, curveOffset: 1 } },
      f.objects,
    ),
  ).toBeNull()
  expect(
    wallEventFromGrid(
      f.event,
      f.level.id,
      { ...f.nodes, [f.wall.id]: { ...f.wall, visible: false } },
      f.objects,
    ),
  ).toBeNull()
})
