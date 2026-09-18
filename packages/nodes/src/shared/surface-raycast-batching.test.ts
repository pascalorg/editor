import { expect, test } from 'bun:test'
import {
  type AnyNode,
  type GridEvent,
  LevelNode,
  type PaintResolveArgs,
  SlabNode,
  sceneRegistry,
  useScene,
  WallNode,
} from '@pascal-app/core'
import { hideFromScene, showInScene } from '@pascal-app/viewer'
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Ray, Vector3 } from 'three'
import { resolveWallRole } from '../wall/paint'
import { accessoryCursor } from './accessory-cursor'
import { resolveSlotByReRaycast } from './slot-paint'

test.each([
  'door',
  'window',
] as const)('%s paint resolves the real slot before a batched proxy target is released', (kind) => {
  const id = `${kind}_paint_batch` as const
  const root = new Group()
  const mesh = new Mesh(new BoxGeometry(1, 1, 0.1), new MeshBasicMaterial())
  mesh.userData.slotId = 'frame'
  root.add(mesh)
  root.updateMatrixWorld(true)
  const args = {
    node: { id, type: kind },
    hitObject: { userData: {} },
    ray: new Ray(new Vector3(0, 0, 2), new Vector3(0, 0, -1)),
  } as unknown as PaintResolveArgs
  sceneRegistry.nodes.set(id, root)
  try {
    for (const batched of [false, true, false]) {
      if (batched) hideFromScene(mesh, 'batched')
      else showInScene(mesh, 'batched')
      expect(resolveSlotByReRaycast(args)).toBe('frame')
    }
  } finally {
    sceneRegistry.nodes.delete(id)
    mesh.geometry.dispose()
    mesh.material.dispose()
  }
})

test('wall paint resolves a batched face band before hover release', () => {
  const node = WallNode.parse({ id: 'wall_paint_batch', start: [0, 0], end: [1, 0] })
  const root = new Group()
  const mesh = new Mesh(new BoxGeometry(1, 1, 0.1), new MeshBasicMaterial())
  mesh.userData.slotId = 'lowerInterior'
  root.add(mesh)
  root.updateMatrixWorld(true)
  sceneRegistry.nodes.set(node.id, root)
  try {
    hideFromScene(mesh, 'wall-batched')
    expect(
      resolveWallRole({
        node,
        materialIndex: null,
        normal: undefined,
        localPosition: undefined,
        ray: new Ray(new Vector3(0, 0, 2), new Vector3(0, 0, -1)),
      }),
    ).toBe('lowerInterior')
  } finally {
    sceneRegistry.nodes.delete(node.id)
    mesh.geometry.dispose()
    mesh.material.dispose()
  }
})

test('accessory cursor preserves the batched slab hit and normal in its explicit host list', () => {
  const previousScene = useScene.getState()
  const level = LevelNode.parse({ id: 'level_accessory_batch' })
  const slab = SlabNode.parse({ id: 'slab_accessory_batch', parentId: level.id, polygon: [] })
  const mesh = new Mesh(new BoxGeometry(4, 0.25, 4), new MeshBasicMaterial())
  mesh.position.y = 2
  mesh.updateMatrixWorld(true)
  sceneRegistry.nodes.set(slab.id, mesh)
  useScene.setState({ nodes: { [level.id]: level, [slab.id]: slab } as Record<string, AnyNode> })
  const event = {
    position: [0, 0, 0],
    localRay: { origin: [0, 5, 0], direction: [0, -1, 0] },
    surfaceHit: { hostId: slab.id },
  } as unknown as GridEvent
  try {
    for (const batched of [false, true, false]) {
      if (batched) hideFromScene(mesh, 'batched')
      else showInScene(mesh, 'batched')
      expect(accessoryCursor(event, level.id)).toEqual({
        point: [0, 2.125, 0],
        surface: true,
        normal: [0, 1, 0],
      })
    }
  } finally {
    sceneRegistry.nodes.delete(slab.id)
    useScene.setState(previousScene)
    mesh.geometry.dispose()
    mesh.material.dispose()
  }
})
