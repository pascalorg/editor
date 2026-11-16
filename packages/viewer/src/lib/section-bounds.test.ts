import { expect, spyOn, test } from 'bun:test'
import { sceneRegistry } from '@pascal-app/core'
import { BoxGeometry, BoxHelper, Group, InstancedMesh, Matrix4, Mesh } from 'three'
import { sectionBounds } from '../index'
import { OVERLAY_LAYER } from './layers'

function model() {
  const site = new Group()
  site.userData.kind = 'site'
  const ground = new Mesh(new BoxGeometry(1000, 1, 1000))
  site.add(ground)
  const building = new Group()
  building.userData.kind = 'building'
  const mesh = new Mesh(new BoxGeometry(2, 4, 6))
  mesh.position.set(10, 3, -5)
  building.add(mesh)
  site.add(building)
  const helper = new BoxHelper(ground)
  helper.position.set(1000, 1000, 1000)
  building.add(helper)
  const overlay = new Mesh(new BoxGeometry(2000, 2000, 2000))
  overlay.layers.set(OVERLAY_LAYER)
  building.add(overlay)
  return { site, building, mesh, ground, helper, overlay }
}

test('baked bounds exclude site and helper outliers, cache, and refresh after geometry edits', () => {
  const m = model()
  const compute = spyOn(m.mesh.geometry, 'computeBoundingBox')
  try {
    const bounds = sectionBounds(m.site)!
    expect(bounds.min.toArray()).toEqual([9, 1, -8])
    expect(bounds.max.toArray()).toEqual([11, 5, -2])
    expect(sectionBounds(m.site)).toBe(bounds)
    expect(compute).toHaveBeenCalledTimes(1)
    // Presentation never changes the slider's full-model range.
    m.building.visible = false
    expect(sectionBounds(m.site)).toBe(bounds)
    m.mesh.geometry.scale(2, 1, 1)
    expect(sectionBounds(m.site)!.min.x).toBe(8)
    expect(sectionBounds(m.site)!.max.x).toBe(12)
    m.mesh.geometry = new BoxGeometry(8, 4, 6)
    expect(sectionBounds(m.site)!.min.x).toBe(6)
    const identity = new Map([
      ['site', m.site],
      ['building', m.building],
    ])
    expect(sectionBounds(identity)!.equals(sectionBounds(m.site)!)).toBe(true)
    m.mesh.position.x = 20
    expect(sectionBounds(identity)!.min.x).toBe(16)
  } finally {
    compute.mockRestore()
  }
})

test('live registry ownership excludes site geometry without relying on baked metadata', () => {
  const m = model()
  delete m.site.userData.kind
  delete m.building.userData.kind
  sceneRegistry.nodes.set('site_section-test', m.site)
  sceneRegistry.nodes.set('building_section-test', m.building)
  sceneRegistry.byType.site.add('site_section-test')
  sceneRegistry.byType.building.add('building_section-test')
  try {
    expect(sectionBounds()!.min.toArray()).toEqual([9, 1, -8])
    expect(sectionBounds()!.max.toArray()).toEqual([11, 5, -2])
  } finally {
    sceneRegistry.nodes.delete('site_section-test')
    sceneRegistry.nodes.delete('building_section-test')
    sceneRegistry.byType.site.delete('site_section-test')
    sceneRegistry.byType.building.delete('building_section-test')
  }
})

test('instance bounds follow live replacement geometry and matrix updates', () => {
  const instances = new InstancedMesh(new BoxGeometry(2, 2, 2), undefined, 2)
  instances.setMatrixAt(0, new Matrix4().makeTranslation(4, 0, 0))
  instances.setMatrixAt(1, new Matrix4().makeTranslation(8, 0, 0))
  expect(sectionBounds(instances)!.min.x).toBe(3)
  expect(sectionBounds(instances)!.max.x).toBe(9)
  instances.setMatrixAt(1, new Matrix4().makeTranslation(20, 0, 0))
  instances.instanceMatrix.needsUpdate = true
  expect(sectionBounds(instances)!.max.x).toBe(21)
  expect(sectionBounds(new Group())).toBeNull()
})

test('temporary family, isolation, solo and reveal masks never shrink model bounds', async () => {
  const { hideFromScene, showInScene } = await import('./scene-visibility')
  const root = new Group()
  const large = new Mesh(new BoxGeometry(20, 20, 20))
  const small = new Mesh(new BoxGeometry(1, 1, 1))
  root.add(large, small)
  const original = sectionBounds(root)!.clone()
  for (const reason of ['xray', 'isolated', 'shadow-only'] as const) {
    hideFromScene(large, reason)
    expect(sectionBounds(root)!.equals(original)).toBe(true)
    showInScene(large, reason)
  }
  large.visible = false
  expect(sectionBounds(root)!.equals(original)).toBe(true)
})

test('standalone batch bounds follow translated instances and later instance mutations', async () => {
  const { BatchedMesh, MeshBasicMaterial } = await import('three')
  const batch = new BatchedMesh(2, 100, 100, new MeshBasicMaterial())
  const geometry = batch.addGeometry(new BoxGeometry(2, 2, 2))
  const instance = batch.addInstance(geometry)
  batch.setMatrixAt(instance, new Matrix4().makeTranslation(100, 0, 0))
  expect(sectionBounds(batch)!.min.x).toBe(99)
  expect(sectionBounds(batch)!.max.x).toBe(101)
  batch.setMatrixAt(instance, new Matrix4().makeTranslation(200, 0, 0))
  expect(sectionBounds(batch)!.min.x).toBe(199)
  batch.dispose()
})

test('construction reveal poses on meshes and ancestors leave rest bounds and live matrices unchanged', async () => {
  const { clearRevealPose, setRevealPose } = await import('./reveal-pose')
  const { Vector3 } = await import('three')
  const parent = new Group()
  parent.position.set(10, 5, -3)
  const mesh = new Mesh(new BoxGeometry(20, 10, 4))
  mesh.position.set(4, 0, 2)
  mesh.pivot = new Vector3(1, 2, 3)
  parent.add(mesh)
  const original = sectionBounds(parent)!.clone()
  try {
    setRevealPose(parent, new Vector3(), new Vector3(0.01, 0.01, 0.01), 20)
    setRevealPose(mesh, new Vector3(2, 0, 0), new Vector3(0.1, 1, 0.1), 10)
    parent.updateWorldMatrix(true, true)
    const posed = mesh.matrixWorld.clone()
    expect(sectionBounds(parent)!.equals(original)).toBe(true)
    // A registered child may be the only source, with its posed parent outside that source.
    expect(sectionBounds(new Map([['mesh', mesh]]))!.equals(original)).toBe(true)
    expect(mesh.matrixWorld.equals(posed)).toBe(true)
  } finally {
    clearRevealPose(mesh)
    clearRevealPose(parent)
  }
})
