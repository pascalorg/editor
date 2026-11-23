import type { SiteNode } from '@pascal-app/core'
import { type Camera, Raycaster, Vector2 } from 'three'
import { lawnPointerPoint } from '../lawn/tool-ground'

type Point = [number, number]
type PointerPosition = { clientX?: number; clientY?: number } | null | undefined
type CanvasBounds = {
  getBoundingClientRect: () => Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>
}
type Ground = { heightAt: (x: number, z: number) => number }

/**
 * The point of the Site ground under the pointer, in Site metres: where the pointer's own ray
 * meets the terrain (or the flat ground), then the top of a slab lying on it.
 *
 * A garden tool must not take this from the editor's grid events. Those are measured on the
 * active floor's plane, which is the ground only when that floor sits on the Site datum: with an
 * upper level active, or a house seated above its garden, the plane hangs metres over the ground
 * and its point lies far behind the one the pointer shows. Null when the event carries no pointer
 * position (a forwarded event) or the ray meets no ground.
 */
export function sitePointerGround(
  pointer: PointerPosition,
  camera: Camera,
  canvas: CanvasBounds,
  site: SiteNode | null,
  ground: Ground,
): Point | null {
  const clientX = pointer?.clientX
  const clientY = pointer?.clientY
  if (typeof clientX !== 'number' || typeof clientY !== 'number') return null
  const onTerrain = lawnPointerPoint({ clientX, clientY }, camera, canvas, site)
  if (!onTerrain) return null
  const rect = canvas.getBoundingClientRect()
  const raycaster = new Raycaster()
  raycaster.setFromCamera(
    new Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      1 - ((clientY - rect.top) / rect.height) * 2,
    ),
    camera,
  )
  const { origin, direction } = raycaster.ray
  if (Math.abs(direction.y) < 1e-9) return onTerrain
  // A slab on the Site stands above the terrain point: follow the same ray back to its top.
  let point = onTerrain
  for (let step = 0; step < 6; step++) {
    const distance = (ground.heightAt(point[0], point[1]) - origin.y) / direction.y
    if (!(distance > 0)) return onTerrain
    const next: Point = [origin.x + direction.x * distance, origin.z + direction.z * distance]
    const moved = Math.hypot(next[0] - point[0], next[1] - point[1])
    point = next
    if (moved < 1e-4) return point
  }
  // No fixed point (the ray passes a slab's edge): the terrain point stands.
  return onTerrain
}

/**
 * The ground point a garden tool works at for a grid event: under the pointer's own ray when the
 * event carries a pointer position, else the grid's point (an event forwarded without one).
 */
export function gridEventSiteGround(
  event: {
    position: readonly [number, number, number]
    nativeEvent?: PointerPosition
  },
  camera: Camera,
  canvas: CanvasBounds,
  site: SiteNode | null,
  ground: Ground,
): Point {
  return (
    sitePointerGround(event.nativeEvent, camera, canvas, site, ground) ?? [
      event.position[0],
      event.position[2],
    ]
  )
}
