import {
  type AnyNode,
  type AnyNodeId,
  buildingGroundBox,
  type GroundBox,
  levelGroundBox,
  terrainBetweenEyeAndBox,
} from '@pascal-app/core'
import type { Camera } from 'three'
import { Box3, Ray, Vector3 } from 'three'
import { cameraPosition, max, min, positionWorld, uniform, vec3 } from 'three/tsl'
import { siteGround } from './site-surfaces'

/**
 * The ground window: where sculpted ground stands between the eye and the box that is shown
 * (a level, or the whole building), that patch of ground is veiled and the rest stays solid.
 * Decided per fragment here — a ray from the eye through the fragment that goes on to meet
 * the box — because the patch's shape is exactly the box's silhouette against the hillside,
 * which no CPU mesh rebuild could follow as cheaply. Whether the window opens at all is the
 * CPU's word (`terrainBetweenEyeAndBox`, a handful of sight lines), read by the site renderer
 * for the live view and by {@link temporarilyGroundWindowForCapture} for a picture, so both
 * agree from their own cameras.
 *
 * One set of uniforms for the whole scene: there is one shown box at a time.
 */
const windowEnabled = uniform(0)
const windowBoxMin = uniform(new Vector3())
const windowBoxMax = uniform(new Vector3())
let currentBox: GroundBox | null = null

/** The margin the window keeps around the box, so the house is not seen through a letterbox. */
const WINDOW_MARGIN = 0.6

/** Opens the window for `box` (kept with its margin), or closes it with `null`. */
export function setGroundWindow(box: GroundBox | null): void {
  currentBox = box
  if (!box) {
    windowEnabled.value = 0
    return
  }
  windowBoxMin.value.set(
    box.min[0] - WINDOW_MARGIN,
    box.min[1] - WINDOW_MARGIN,
    box.min[2] - WINDOW_MARGIN,
  )
  windowBoxMax.value.set(
    box.max[0] + WINDOW_MARGIN,
    box.max[1] + WINDOW_MARGIN,
    box.max[2] + WINDOW_MARGIN,
  )
  windowEnabled.value = 1
}

/** The box the window is currently open for, without its margin. */
export function groundWindowBoxNow(): GroundBox | null {
  return currentBox
}

/** True while the window is open at all (the veil's word for "only in the window"). */
export function groundWindowEnabledNode() {
  return windowEnabled.greaterThan(0.5)
}

/**
 * True for a fragment the window veils: the ray from the eye through it goes on to meet the
 * box (the fragment stands in front of the box, or inside it with box still beyond). The eye
 * inside the box never veils: there the box's near planes are behind it.
 */
export function inGroundWindowNode() {
  const toFragment = positionWorld.sub(cameraPosition)
  const fragmentT = toFragment.length()
  // The epsilon keeps an axis-aligned ray's reciprocal finite where a component is exactly 0.
  const dir = toFragment.normalize().add(vec3(1e-6, 1e-6, 1e-6))
  const invDir = vec3(1).div(dir)
  const near = windowBoxMin.sub(cameraPosition).mul(invDir)
  const far = windowBoxMax.sub(cameraPosition).mul(invDir)
  const tMin = min(near, far)
  const tMax = max(near, far)
  const enter = max(max(tMin.x, tMin.y), tMin.z)
  const exit = min(min(tMax.x, tMax.y), tMax.z)
  return windowEnabled
    .greaterThan(0.5)
    .and(enter.greaterThan(0))
    .and(enter.lessThanEqual(exit))
    .and(exit.greaterThan(fragmentT))
}

/** The mask solid ground draws with: everywhere but in the window. */
export function groundWindowMaskNode() {
  return inGroundWindowNode().not()
}

const inflatedBox = new Box3()
const scratchRay = new Ray()
const scratchPoint = new Vector3()

/**
 * The CPU twin of {@link inGroundWindowNode} for one pick: whether `point`, seen from
 * `origin`, is ground the window veils — so a click there falls through to what the window
 * reveals, as a click on the wholesale veil does. `false` while the window is closed.
 */
export function groundWindowContains(origin: Vector3, point: Vector3): boolean {
  if (!currentBox) return false
  inflatedBox.min.set(
    currentBox.min[0] - WINDOW_MARGIN,
    currentBox.min[1] - WINDOW_MARGIN,
    currentBox.min[2] - WINDOW_MARGIN,
  )
  inflatedBox.max.set(
    currentBox.max[0] + WINDOW_MARGIN,
    currentBox.max[1] + WINDOW_MARGIN,
    currentBox.max[2] + WINDOW_MARGIN,
  )
  if (inflatedBox.containsPoint(origin)) return false
  if (inflatedBox.containsPoint(point)) return true
  scratchRay.origin.copy(origin)
  scratchRay.direction.copy(point).sub(origin).normalize()
  const entry = scratchRay.intersectBox(inflatedBox, scratchPoint)
  return entry !== null && entry.distanceTo(origin) >= point.distanceTo(origin) - 1e-4
}

/**
 * The window as one capture's own camera sees it, whatever the person's view holds: opened
 * for the interior's floor, or the whole building, when ground stands between that camera
 * and it — and closed when it does not, so a window open for the person's eye never leaks
 * into a picture taken from the other side. The veil surfaces are stood up for the frame
 * (the solid ground stays, its mask cut by the same window). The returned function gives
 * the person's view back.
 */
export function temporarilyGroundWindowForCapture(
  camera: Camera,
  nodes: Record<AnyNodeId, AnyNode>,
  levelId?: string,
): () => void {
  const previous = currentBox
  const box = levelId ? levelGroundBox(nodes, levelId) : buildingGroundBox(nodes)
  const eye: [number, number, number] = [camera.position.x, camera.position.y, camera.position.z]
  const open = box !== null && terrainBetweenEyeAndBox(nodes, eye, box)
  setGroundWindow(open ? box : null)
  const { veil } = siteGround()
  const flipped = open ? veil.filter((surface) => !surface.visible) : []
  for (const surface of flipped) surface.visible = true
  return () => {
    for (const surface of flipped) surface.visible = false
    setGroundWindow(previous)
  }
}
