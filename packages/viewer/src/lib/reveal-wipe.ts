import type { RevealStyle } from '@pascal-app/core'
import type { Material, Mesh, Object3D } from 'three'
import { positionWorld, uniform } from 'three/tsl'
import type { Node, NodeMaterial } from 'three/webgpu'

/**
 * The covering of a node laid over what stands under it, in place: a roof at the Framing level
 * keeps its frame and its shell is revealed row by row from its lowest edge to its highest, the way
 * a wall's boards and finish go over its studs. Presentation only, like the pose: the scene is not
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
/** One row of the covering takes about this much of the sweep (m): a course of tiles or a sheet. */
export const COVER_ROW_M = 0.5
export const COVER_MIN_ROWS = 4
export const COVER_MAX_ROWS = 14

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

/** One row of the covering: the part of the sweep it closes, and when it is laid. */
export type CoverRow = {
  index: number
  /** The row's far edge along the sweep, as a share of it; the rows go 0 → 1 in order. */
  upTo: number
  /** When the row is laid, from the start of the cover (ms). */
  atMs: number
}

/**
 * The rows of a covering that takes `durationMs`: their count follows the length of the sweep, the
 * first is laid at once, and each next one a stride later, so the last lands with the end of the
 * time. In order from the lowest edge.
 */
export function planCoverRows(sweep: CoverSweep, durationMs: number): CoverRow[] {
  const length = Math.max(0, sweep.to - sweep.from)
  const count = Math.min(COVER_MAX_ROWS, Math.max(COVER_MIN_ROWS, Math.round(length / COVER_ROW_M)))
  const stride = count > 1 ? durationMs / count : 0
  return Array.from({ length: count }, (_, index) => ({
    index,
    upTo: (index + 1) / count,
    atMs: index * stride,
  }))
}

/**
 * How much of the sweep the covering has closed `elapsedMs` into it, as a share in [0, 1]: the far
 * edge of the last row laid. 0 before the first row, 1 once the last is laid.
 */
export function coverShareAt(rows: readonly CoverRow[], elapsedMs: number): number {
  let share = 0
  for (const row of rows) {
    if (row.atMs > elapsedMs) break
    share = row.upTo
  }
  return share
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
