import { afterEach, expect, test } from 'bun:test'
import { type AnyNode, sceneRegistry, useScene } from '@pascal-app/core'
import * as THREE from 'three'
import { FloorSurface } from './floor-surface'

const GROUND = 'level_ground'
const UPPER = 'level_upper'

function node(id: string, type: string, parentId: string | null, extra: object = {}) {
  return { id, type, parentId, visible: true, ...extra } as unknown as AnyNode
}

// A flat slab whose top is at `top`, spanning x/z from -5 to 5.
function slabMesh(top: number, thickness = 0.2) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(10, thickness, 10),
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  )
  mesh.position.set(0, top - thickness / 2, 0)
  return mesh
}

function register(id: string, type: string, object: THREE.Object3D) {
  sceneRegistry.nodes.set(id, object)
  sceneRegistry.byType[type]!.add(id)
  object.updateMatrixWorld(true)
}

function scene(nodes: AnyNode[]) {
  useScene.setState({ nodes: Object.fromEntries(nodes.map((n) => [n.id, n])) as never })
}

function topAt(surface: FloorSurface, x = 0, z = 0, levelY = 0) {
  void surface.revision
  return surface.topAt(x, z, levelY)
}

afterEach(() => sceneRegistry.clear())

test('the highest floor of the active level under the camera counts, nothing else', () => {
  scene([
    node(GROUND, 'level', null, { level: 0 }),
    node(UPPER, 'level', null, { level: 1 }),
    node('slab_base', 'slab', GROUND),
    node('slab_platform', 'slab', GROUND),
    node('slab_upper', 'slab', UPPER),
    node('wall_a', 'wall', GROUND),
    node('ceiling_a', 'ceiling', GROUND),
  ])
  register('slab_base', 'slab', slabMesh(0.05))
  register('slab_platform', 'slab', slabMesh(0.5))
  register('slab_upper', 'slab', slabMesh(2.76))
  register('wall_a', 'wall', slabMesh(2.5, 2.5))
  register('ceiling_a', 'ceiling', slabMesh(2.5, 0.05))

  const surface = new FloorSurface()
  surface.levelId = GROUND
  // The raised platform, not the base slab below it, nor the wall, ceiling or
  // the level above.
  expect(topAt(surface)).toBeCloseTo(0.5, 6)
  // Off every slab: nothing under the camera.
  expect(topAt(surface, 20, 20)).toBeNull()

  surface.levelId = UPPER
  expect(topAt(surface, 0, 0, 2.71)).toBeCloseTo(2.76, 6)
})

test('hidden slabs and items standing on a slab are not the floor', () => {
  scene([
    node(GROUND, 'level', null, { level: 0 }),
    node('slab_base', 'slab', GROUND),
    node('slab_hidden', 'slab', GROUND, { visible: false }),
    node('item_table', 'item', 'slab_base'),
  ])
  const base = slabMesh(0.05)
  register('slab_base', 'slab', base)
  register('slab_hidden', 'slab', slabMesh(0.9))
  const table = slabMesh(0.75 - 0.05, 0.05)
  base.add(table)
  register('item_table', 'item', table)

  const surface = new FloorSurface()
  surface.levelId = GROUND
  expect(topAt(surface)).toBeCloseTo(0.05, 6)
})

test('on the ground level the site ground counts; on other levels it does not', () => {
  scene([
    node(GROUND, 'level', null, { level: 0 }),
    node(UPPER, 'level', null, { level: 1 }),
    node('site_a', 'site', null),
  ])
  const site = new THREE.Group()
  site.add(slabMesh(-0.05, 0.01))
  register('site_a', 'site', site)

  const surface = new FloorSurface()
  surface.levelId = GROUND
  expect(topAt(surface, 3, 3)).toBeCloseTo(-0.05, 6)
  surface.levelId = UPPER
  expect(topAt(surface, 3, 3, 2.71)).toBeNull()
})

test('rebuilding a slab in place moves the revision so a cached answer is refreshed', () => {
  scene([node(GROUND, 'level', null, { level: 0 }), node('slab_base', 'slab', GROUND)])
  const slab = slabMesh(0.05)
  register('slab_base', 'slab', slab)
  const surface = new FloorSurface()
  surface.levelId = GROUND
  const before = surface.revision
  slab.position.y += 0.4
  slab.updateMatrixWorld(true)
  expect(surface.revision).not.toBe(before)
  expect(topAt(surface)).toBeCloseTo(0.45, 6)
})

test('a platform moved horizontally into a cached camera position refreshes the floor', () => {
  scene([node(GROUND, 'level', null, { level: 0 }), node('slab_platform', 'slab', GROUND)])
  const slab = slabMesh(1)
  slab.position.x = 20
  register('slab_platform', 'slab', slab)
  const surface = new FloorSurface()
  surface.levelId = GROUND
  expect(topAt(surface)).toBeNull()
  const before = surface.revision
  slab.position.x = 0
  slab.updateMatrixWorld(true)
  expect(surface.revision).not.toBe(before)
  expect(topAt(surface)).toBeCloseTo(1, 6)
})

test('resizing and hiding a mounted platform invalidate a cached floor height', () => {
  scene([node(GROUND, 'level', null, { level: 0 }), node('slab_platform', 'slab', GROUND)])
  const slab = slabMesh(1)
  register('slab_platform', 'slab', slab)
  const surface = new FloorSurface()
  surface.levelId = GROUND
  expect(topAt(surface)).toBeCloseTo(1, 6)
  let before = surface.revision
  slab.scale.y = 2
  slab.updateMatrixWorld(true)
  expect(surface.revision).not.toBe(before)
  expect(topAt(surface)).toBeCloseTo(1.1, 6)
  before = surface.revision
  slab.visible = false
  expect(surface.revision).not.toBe(before)
  expect(topAt(surface)).toBeNull()
})

test('a floor mesh mounted or replaced after its site keeps the active surface current', () => {
  scene([node(GROUND, 'level', null, { level: 0 }), node('site_a', 'site', null)])
  const site = new THREE.Group()
  register('site_a', 'site', site)
  const surface = new FloorSurface()
  surface.levelId = GROUND
  expect(topAt(surface)).toBeNull()
  const floor = slabMesh(0.05)
  site.add(floor)
  site.updateMatrixWorld(true)
  expect(topAt(surface)).toBeCloseTo(0.05, 6)
  site.remove(floor)
  site.add(slabMesh(0.5))
  site.updateMatrixWorld(true)
  expect(topAt(surface)).toBeCloseTo(0.5, 6)
})
