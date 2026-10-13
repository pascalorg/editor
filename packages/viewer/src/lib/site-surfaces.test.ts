// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { afterEach, expect, test } from 'bun:test'
import { sceneRegistry } from '@pascal-app/core'
import { Group, Mesh } from 'three'
import { SITE_GROUND, siteGroundSurfaces, siteSurfaces } from './site-surfaces'

afterEach(() => sceneRegistry.clear())

/** A site as SiteRenderer mounts it: the building it holds, then its own surfaces. */
function site() {
  const group = new Group()
  const building = new Group().add(new Group())
  const ground = new Mesh()
  ground.userData[SITE_GROUND] = true
  const propertyLine = new Mesh()
  const hiddenGround = new Mesh()
  hiddenGround.userData[SITE_GROUND] = true
  hiddenGround.visible = false
  group.add(building, ground, propertyLine, hiddenGround)
  sceneRegistry.nodes.set('site_a', group)
  sceneRegistry.byType.site?.add('site_a')
  return { ground, propertyLine }
}

test("the site's surfaces are its own shown meshes, not the buildings it holds", () => {
  const { ground, propertyLine } = site()
  expect(siteSurfaces()).toEqual([ground, propertyLine])
})

test('the ground is the surfaces flagged as ground: the lines on it are not', () => {
  const { ground } = site()
  expect(siteGroundSurfaces()).toEqual([ground])
})
