import { sceneRegistry } from '@pascal-app/core'
import type { Object3D } from 'three'
import { temporarilySetGroundAside } from './scene-visibility'

/**
 * `userData` key marking the site's ground surfaces with their {@link SiteGroundRole}: the lines
 * drawn on the ground (property line, setbacks, contours) carry none.
 */
export const SITE_GROUND = 'siteGround'

/**
 * `userData` key marking the generic foundation under the buildings (footing and stem, drawn under
 * the ground): a capture that sees through the veil leaves it out, as it left it out before it was drawn.
 */
export const SITE_FOUNDATION = 'siteFoundation'

/**
 * `solid`: the lot's fill, its sculpted terrain, the horizon disc. `veil`: what is drawn in their
 * place over a level below grade, the grade ring with it.
 */
export type SiteGroundRole = 'solid' | 'veil'

/**
 * The site's own shown surfaces (ground, horizon disc, property and setback lines, contours), not
 * its registered children (buildings, items), which are groups.
 */
export function siteSurfaces(): Object3D[] {
  const surfaces: Object3D[] = []
  for (const siteId of sceneRegistry.byType.site ?? []) {
    for (const child of sceneRegistry.nodes.get(siteId)?.children ?? []) {
      if (child.visible && !(child.type === 'Group' && child.children.length > 0)) {
        surfaces.push(child)
      }
    }
  }
  return surfaces
}

/** The site's generic foundation meshes, shown or not. */
export function siteFoundation(): Object3D[] {
  const foundation: Object3D[] = []
  for (const siteId of sceneRegistry.byType.site ?? []) {
    for (const child of sceneRegistry.nodes.get(siteId)?.children ?? []) {
      if (child.userData[SITE_FOUNDATION] === true) foundation.push(child)
    }
  }
  return foundation
}

/** The site's ground by role, shown or not: the veil is hidden until a level below grade is shown. */
export function siteGround(): Record<SiteGroundRole, Object3D[]> {
  const ground: Record<SiteGroundRole, Object3D[]> = { solid: [], veil: [] }
  for (const siteId of sceneRegistry.byType.site ?? []) {
    for (const child of sceneRegistry.nodes.get(siteId)?.children ?? []) {
      const role: unknown = child.userData[SITE_GROUND]
      if (role === 'solid' || role === 'veil') ground[role].push(child)
    }
  }
  return ground
}

/**
 * The ground veiled, or solid, for one capture, whatever the person's view shows: a picture of a
 * floor below grade sees it through the veil, a picture of the whole building stands on solid
 * ground. The returned function gives the person's view back.
 */
export function temporarilyVeilGround(veiled: boolean): () => void {
  const { solid, veil } = siteGround()
  const restoreSolid = temporarilySetGroundAside(solid, veiled)
  // Seen through a veil the footing under a floor below grade would show: the picture has none.
  const restoreFoundation = veiled ? temporarilySetGroundAside(siteFoundation(), true) : () => {}
  const flipped = veil.filter((surface) => surface.visible !== veiled)
  for (const surface of flipped) surface.visible = veiled
  return () => {
    for (const surface of flipped) surface.visible = !veiled
    restoreFoundation()
    restoreSolid()
  }
}
