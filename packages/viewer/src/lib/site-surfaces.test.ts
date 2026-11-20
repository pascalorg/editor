// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { afterEach, expect, test } from 'bun:test'
import { sceneRegistry } from '@pascal-app/core'
import { Group, Mesh } from 'three'
import { SCENE_LAYER } from './layers'
import { hideFromScene } from './scene-visibility'
import {
  SITE_GROUND,
  siteGround,
  siteSurfaces,
  temporarilyHideSiteSurfaces,
  temporarilyVeilGround,
} from './site-surfaces'

afterEach(() => sceneRegistry.clear())

/**
 * A site as SiteRenderer mounts it: the building it holds, then its own surfaces: the solid
 * ground, the veil drawn in its place over a level below grade (hidden until then), the lot line.
 */
function site() {
  const group = new Group()
  const building = new Group().add(new Group())
  const ground = new Mesh()
  ground.userData[SITE_GROUND] = 'solid'
  const veil = new Mesh()
  veil.userData[SITE_GROUND] = 'veil'
  veil.visible = false
  const lotLine = new Mesh()
  group.add(building, ground, veil, lotLine)
  sceneRegistry.nodes.set('site_a', group)
  sceneRegistry.byType.site?.add('site_a')
  return { ground, veil, lotLine }
}

test("the site's surfaces are its own shown meshes, not the buildings it holds", () => {
  const { ground, lotLine } = site()
  expect(siteSurfaces()).toEqual([ground, lotLine])
})

test('the ground is the solid surfaces and their veils, shown or not; the lines on it are not', () => {
  const { ground, veil } = site()
  expect(siteGround()).toEqual({ solid: [ground], veil: [veil] })
})

test('a capture veils the ground for its picture, then gives the solid ground back', () => {
  const { ground, veil, lotLine } = site()
  const restore = temporarilyVeilGround(true)
  expect(ground.layers.isEnabled(SCENE_LAYER)).toBe(false)
  expect(veil.visible).toBe(true)
  expect(lotLine.visible).toBe(true)
  restore()
  expect(ground.layers.isEnabled(SCENE_LAYER)).toBe(true)
  expect(veil.visible).toBe(false)
})

test('a capture stands the whole building on solid ground, then gives the veil back', () => {
  const { ground, veil } = site()
  hideFromScene(ground, 'ground-aside')
  veil.visible = true
  const restore = temporarilyVeilGround(false)
  expect(ground.layers.isEnabled(SCENE_LAYER)).toBe(true)
  expect(veil.visible).toBe(false)
  restore()
  expect(ground.layers.isEnabled(SCENE_LAYER)).toBe(false)
  expect(veil.visible).toBe(true)
})

test('an untagged live site root mesh is ground; registered descendants and section carriers are not', () => {
  const site = new Mesh()
  site.userData[SITE_GROUND] = 'solid'
  const carrier = new Group()
  carrier.userData[SITE_GROUND] = 'solid'
  const item = new Mesh()
  item.userData[SITE_GROUND] = 'solid'
  site.add(carrier)
  carrier.add(item)
  sceneRegistry.nodes.set('site_root', site)
  sceneRegistry.byType.site.add('site_root')
  sceneRegistry.nodes.set('item_root', item)
  sceneRegistry.byType.item.add('item_root')
  expect(siteGround()).toEqual({ solid: [site], veil: [] })
  expect(siteSurfaces()).toEqual([site])
  const restore = temporarilyVeilGround(true)
  try {
    expect(site.layers.isEnabled(SCENE_LAYER)).toBe(false)
    expect(item.layers.isEnabled(SCENE_LAYER)).toBe(true)
    expect(carrier.visible).toBe(true)
  } finally {
    restore()
  }
})

test('thumbnail hiding a site root mesh keeps its registered building descendants drawn', () => {
  const site = new Mesh()
  site.userData[SITE_GROUND] = 'solid'
  const building = new Group()
  const wall = new Mesh()
  building.add(wall)
  site.add(building)
  sceneRegistry.nodes.set('site_thumbnail_root', site)
  sceneRegistry.byType.site.add('site_thumbnail_root')
  sceneRegistry.nodes.set('building_thumbnail_root', building)
  const restore = temporarilyHideSiteSurfaces()
  try {
    expect(site.layers.isEnabled(SCENE_LAYER)).toBe(false)
    expect(wall.layers.isEnabled(SCENE_LAYER)).toBe(true)
    for (let object = wall.parent; object; object = object.parent) expect(object.visible).toBe(true)
  } finally {
    restore()
  }
  expect(site.layers.isEnabled(SCENE_LAYER)).toBe(true)
})
