import { sceneRegistry } from '@pascal-app/core'
import type { Object3D } from 'three'

/**
 * `userData` flag on the site's ground surfaces (the lot's fill, its sculpted terrain, the
 * horizon disc): what a level below grade is seen through. The lines drawn on it are not ground.
 */
export const SITE_GROUND = 'siteGround'

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

/** The ground among the site's surfaces. */
export function siteGroundSurfaces(): Object3D[] {
  return siteSurfaces().filter((surface) => surface.userData[SITE_GROUND] === true)
}
