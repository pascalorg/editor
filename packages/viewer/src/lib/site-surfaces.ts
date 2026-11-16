import { sceneRegistry } from '@pascal-app/core'
import { type RefObject, useLayoutEffect } from 'react'
import type { Object3D } from 'three'
import { temporarilySetGroundAside } from './scene-visibility'

/**
 * `userData` key marking the site's ground surfaces with their {@link SiteGroundRole}: the lines
 * drawn on the ground (property line, setbacks, contours) carry none.
 */
export const SITE_GROUND = 'siteGround'

/** Presentation horizon and its veil keep capture ownership but never take an X-ray family. */
export const SITE_HORIZON = 'siteHorizon'

const ownerIds = new WeakMap<Object3D, string>()

export const siteSurfaceOwnerId = (object: Object3D) => ownerIds.get(object)

const ownedRoots = new Map<string, Set<Object3D>>()

/** A portaled surface scope retains the site's capture ownership. */
export function useSiteSurfaceOwner(siteId: string, ref: RefObject<Object3D | null>) {
  useLayoutEffect(() => {
    const root = ref.current
    if (!root) return
    const roots = ownedRoots.get(siteId) ?? new Set<Object3D>()
    ownedRoots.set(siteId, roots)
    roots.add(root)
    ownerIds.set(root, siteId)
    return () => {
      roots.delete(root)
      ownerIds.delete(root)
      if (!roots.size) ownedRoots.delete(siteId)
    }
  }, [siteId, ref])
}

function siteChildren(siteId: string): Object3D[] {
  return [
    ...(sceneRegistry.nodes.get(siteId)?.children ?? []),
    ...[...(ownedRoots.get(siteId) ?? [])].flatMap((root) => root.children),
  ]
}

/**
 * `solid`: the lot's fill, its sculpted terrain, the horizon disc. `veil`: what is drawn in their
 * place over a level below grade.
 */
export type SiteGroundRole = 'solid' | 'veil'

/**
 * The site's own shown surfaces (ground, horizon disc, property and setback lines, contours), not
 * its registered children (buildings, items), which are groups.
 */
export function siteSurfaces(): Object3D[] {
  const surfaces: Object3D[] = []
  for (const siteId of sceneRegistry.byType.site ?? []) {
    for (const child of siteChildren(siteId)) {
      if (child.visible && !(child.type === 'Group' && child.children.length > 0)) {
        surfaces.push(child)
      }
    }
  }
  return surfaces
}

/** The site's ground by role, shown or not: the veil is hidden until a level below grade is shown. */
export function siteGround(): Record<SiteGroundRole, Object3D[]> {
  const ground: Record<SiteGroundRole, Object3D[]> = { solid: [], veil: [] }
  for (const siteId of sceneRegistry.byType.site ?? []) {
    for (const child of siteChildren(siteId)) {
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
  const flipped = veil.filter((surface) => surface.visible !== veiled)
  for (const surface of flipped) surface.visible = veiled
  return () => {
    for (const surface of flipped) surface.visible = !veiled
    restoreSolid()
  }
}
