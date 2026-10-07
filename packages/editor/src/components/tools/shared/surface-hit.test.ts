import { afterEach, expect, test } from 'bun:test'
import { type ItemEvent, ItemNode, sceneRegistry } from '@pascal-app/core'
import { Group, Matrix3, Vector3 } from 'three'
import { itemEventToSurfaceHit } from './surface-hit'

const host = ItemNode.parse({
  id: 'item_hit-adapter',
  asset: { id: 'host', name: 'Host', category: 'furniture', thumbnail: '', src: '/host.glb' },
})

afterEach(() => sceneRegistry.nodes.delete(host.id))

test('matches the legacy host-local point and hit-mesh normal exactly under rotation and scale', () => {
  const mesh = new Group()
  mesh.position.set(4.3, 2.1, -3.7)
  mesh.rotation.set(0.2, 0.7, -0.1)
  mesh.scale.set(2, 0.7, 1.3)
  const object = new Group()
  object.name = 'surface-mesh'
  object.position.set(0.4, 0.8, -0.2)
  object.rotation.set(-0.1, 0.3, 0.2)
  object.scale.set(0.8, 1.4, 0.6)
  mesh.add(object)
  mesh.updateMatrixWorld(true)
  sceneRegistry.nodes.set(host.id, mesh)
  const event = {
    node: host,
    object,
    position: object.localToWorld(new Vector3(0.37, 0.81, -0.39)).toArray(),
    localPosition: [0.37, 0.81, -0.39],
    normal: [0.2, 1, -0.3],
    nativeEvent: {} as ItemEvent['nativeEvent'],
    stopPropagation() {},
  } as ItemEvent
  const before = structuredClone({ position: event.position, normal: event.normal })
  const expectedPoint = mesh.worldToLocal(new Vector3(...event.position)).toArray()
  const expectedNormal = new Vector3(...event.normal!)
    .applyNormalMatrix(new Matrix3().getNormalMatrix(object.matrixWorld))
    .normalize().y
  const hit = itemEventToSurfaceHit(host, event)!
  expect(hit.point).toEqual(expectedPoint)
  expect(hit.point).not.toEqual(event.localPosition)
  expect(hit.normalWorldY).toBe(expectedNormal)
  expect(hit.meshName).toBe(object.name)
  expect({ position: event.position, normal: event.normal }).toEqual(before)

  const roundTrip = mesh.localToWorld(new Vector3(...expectedPoint)).toArray()
  expect(itemEventToSurfaceHit(host, { ...event, position: roundTrip })!.point).toEqual(
    mesh.worldToLocal(new Vector3(...roundTrip)).toArray(),
  )
  expect(itemEventToSurfaceHit(host, { ...event, normal: undefined })!.normalWorldY).toBeNaN()
})

test('a missing registered host mesh yields no hit', () => {
  expect(itemEventToSurfaceHit(host, {} as ItemEvent)).toBeNull()
})
