// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { afterEach, expect, test } from 'bun:test'
import { sceneRegistry } from '@pascal-app/core'
import { Group, Mesh } from 'three'
import { SCENE_LAYER } from './layers'
import { hideFromScene } from './scene-visibility'
import {
  SITE_FOUNDATION,
  SITE_GROUND,
  siteFoundation,
  siteGround,
  siteSurfaces,
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
  const foundation = new Mesh()
  foundation.userData[SITE_FOUNDATION] = true
  group.add(building, ground, veil, lotLine, foundation)
  sceneRegistry.nodes.set('site_a', group)
  sceneRegistry.byType.site?.add('site_a')
  return { ground, veil, lotLine, foundation }
}

test("the site's surfaces are its own shown meshes, not the buildings it holds", () => {
  const { ground, lotLine, foundation } = site()
  expect(siteSurfaces()).toEqual([ground, lotLine, foundation])
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

test('the generic foundation is found by its mark, shown or not', () => {
  const { foundation } = site()
  expect(siteFoundation()).toEqual([foundation])
})

test('a capture through the veil leaves the foundation out, then gives it back', () => {
  const { foundation } = site()
  const restore = temporarilyVeilGround(true)
  expect(foundation.layers.isEnabled(SCENE_LAYER)).toBe(false)
  restore()
  expect(foundation.layers.isEnabled(SCENE_LAYER)).toBe(true)
})

test('a capture of the whole building on solid ground keeps the foundation as it is', () => {
  const { foundation } = site()
  const restore = temporarilyVeilGround(false)
  expect(foundation.layers.isEnabled(SCENE_LAYER)).toBe(true)
  restore()
  expect(foundation.layers.isEnabled(SCENE_LAYER)).toBe(true)
})
