import type { RevealStyle } from '@pascal-app/core'
import type { Material, Mesh, Object3D } from 'three'
import { positionWorld, uniform } from 'three/tsl'
import type { Node, NodeMaterial } from 'three/webgpu'

/**
 * The covering of a node laid over what stands under it, in place: a roof at the Framing level
 * keeps its frame and its shell is revealed continuously from its lowest edge to its highest, the
 * way a wall's boards and finish go over its studs. Presentation only, like the pose: the scene is not
 * touched, and the meshes wear masked clones of their materials while it plays (the scene's
 * materials are shared and cached, so a wipe never writes to them).
 *
 * The sweep runs along the height when the node rises enough for that to read as eave to ridge, and
 * along its longer plan side when it is flat.
 */

/**
 * What a candidate is played as: a kind's declared style, or `cover`, which an `assemble` node
 * plays at the Framing level (a roof holds still while its covering is laid over its frame). A
 * kind never declares it, so it is the viewer's own and `RevealStyle` does not carry it.
 */
export type PlayedStyle = RevealStyle | 'cover'

export type CoverAxis = 'x' | 'y' | 'z'

/** Where the sweep starts and ends along its axis, in world metres. */
export type CoverSweep = { axis: CoverAxis; from: number; to: number }

/** A node that rises less than this (m) is flat: it sweeps along its longer plan side. */
export const COVER_MIN_RISE_M = 0.6

type BoxLike = {
  min: { x: number; y: number; z: number }
  max: { x: number; y: number; z: number }
}

/** The sweep of a node drawn inside `box` (world space). */
export function coverSweepOf(box: BoxLike): CoverSweep {
  // Nothing drawn yet: an empty sweep, so the covering has nothing to close.
  if (!(box.max.y >= box.min.y)) return { axis: 'y', from: 0, to: 0 }
  if (box.max.y - box.min.y >= COVER_MIN_RISE_M) {
    return { axis: 'y', from: box.min.y, to: box.max.y }
  }
  const alongX = box.max.x - box.min.x >= box.max.z - box.min.z
  return alongX
    ? { axis: 'x', from: box.min.x, to: box.max.x }
    : { axis: 'z', from: box.min.z, to: box.max.z }
}

/**
 * How long a covering takes by the size of what it covers, at a level's pace and the person's speed:
 * `perMeterMs` for each metre of the sweep, never under `minMs` (a small porch roof does not crawl,
 * it does not flash either) and never over `maxMs` (a long flat roof does not take half a minute).
 */
export type CoverRange = { perMeterMs: number; minMs: number; maxMs: number }

/** The time a covering of `sweep` takes in `range`. */
export function coverDurationMs(sweep: CoverSweep, range: CoverRange): number {
  const length = Math.max(0, sweep.to - sweep.from)
  return Math.min(range.maxMs, Math.max(range.minMs, length * range.perMeterMs))
}

/**
 * How much of the sweep the covering has closed `elapsedMs` into `durationMs`, as a share in [0, 1].
 * It moves continuously: an ease in and out (a sine), so it starts and stops without a jolt, and it
 * is exactly 0 at the start and 1 at the end.
 */
export function coverShareAt(elapsedMs: number, durationMs: number): number {
  if (!(durationMs > 0)) return elapsedMs >= 0 ? 1 : 0
  const t = Math.min(1, Math.max(0, elapsedMs / durationMs))
  return 0.5 - 0.5 * Math.cos(Math.PI * t)
}

type Worn = {
  original: Material | Material[]
  wiped: Material | Material[]
  cast: boolean
}

type Sweep = {
  level: { value: number }
  axis: CoverAxis
}

const worn = new WeakMap<Mesh, Worn>()
const sweeps = new WeakMap<Object3D, Sweep>()

const eachOf = (material: Material | Material[]) =>
  Array.isArray(material) ? material : [material]

const isMesh = (object: Object3D): object is Mesh =>
  (object as Mesh).isMesh === true && Boolean((object as Mesh).material)

function maskOf(sweep: Sweep): Node<'bool'> {
  const coordinate =
    sweep.axis === 'y' ? positionWorld.y : sweep.axis === 'x' ? positionWorld.x : positionWorld.z
  return coordinate.lessThanEqual(sweep.level as never) as Node<'bool'>
}

function wipedClone(material: Material, mask: Node<'bool'>): Material {
  const clone = material.clone() as unknown as NodeMaterial
  clone.maskNode = clone.maskNode ? (clone.maskNode as Node<'bool'>).and(mask) : mask
  return clone as unknown as Material
}

/**
 * Shows what is below `at` (world metres along the sweep's axis) of everything drawn under `root`,
 * and hides the rest. Idempotent: a frame later it only moves the level; a mesh whose renderer put
 * its own materials back is dressed again. Cleared by `clearRevealWipe`.
 */
export function setRevealWipe(root: Object3D, sweep: CoverSweep, at: number): void {
  let state = sweeps.get(root)
  if (!state || state.axis !== sweep.axis) {
    if (state) clearRevealWipe(root)
    state = { level: uniform(at) as unknown as { value: number }, axis: sweep.axis }
    sweeps.set(root, state)
  }
  state.level.value = at
  const mask = maskOf(state)
  root.traverse((child) => {
    if (!isMesh(child)) return
    let entry = worn.get(child)
    if (entry && child.material !== entry.wiped) {
      // Its renderer set the real materials again: they are the originals now.
      for (const material of eachOf(entry.wiped)) material.dispose()
      entry = undefined
    }
    if (!entry) {
      const original = child.material
      const wiped = Array.isArray(original)
        ? original.map((material) => wipedClone(material, mask))
        : wipedClone(original, mask)
      entry = { original, wiped, cast: child.castShadow }
      worn.set(child, entry)
      child.material = wiped
    }
    // The depth pass has no mask: a row not yet laid would still throw its shadow.
    child.castShadow = false
  })
}

/** Gives every mesh under `root` its own materials and its shadow back. */
export function clearRevealWipe(root: Object3D): void {
  if (!sweeps.delete(root)) return
  root.traverse((child) => {
    if (!isMesh(child)) return
    const entry = worn.get(child)
    if (!entry) return
    if (child.material === entry.wiped) child.material = entry.original
    for (const material of eachOf(entry.wiped)) material.dispose()
    child.castShadow = entry.cast
    worn.delete(child)
  })
}

/** The world coordinate the covering has reached on `root`, or null when it is not under a wipe. */
export function revealWipeLevelOf(root: Object3D): number | null {
  return sweeps.get(root)?.level.value ?? null
}
