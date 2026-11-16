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
