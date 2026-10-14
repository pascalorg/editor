import type { RevealStyle } from '@pascal-app/core'
import { Box3, Matrix4, type Mesh, type Object3D, Vector3 } from 'three'

/**
 * A presentation-only pose composed on a registered root.
 *
 * The root's `position`, `quaternion` and `scale` stay owned by the renderer
 * and the systems that write them (`FloorElevationSystem` and `LevelSystem`
 * write `position.y` every frame), so the reveal never touches them: it swaps
 * the root's `updateMatrix` for one that appends `T(pivot)·S(scale)·T(−pivot)`
 * to the composed matrix and lifts the result straight up in the parent's
 * frame, and puts the prototype's back when it clears. A rebuild that replaces
 * the root's children keeps the pose; a root whose matrix someone else drives
 * by hand (`matrixAutoUpdate === false`) is left alone.
 */
type RevealPose = {
  pivot: Vector3
  scale: Vector3
  lift: number
  /** A piece moving in from where it was: its old position (the parent's frame), its old yaw, the share left. */
  glide: { from: Vector3; yaw: number; left: number } | null
}

const poses = new WeakMap<Object3D, RevealPose>()
const step = new Matrix4()
const glideStep = new Matrix4()
const glideAround = new Matrix4()

function updateRevealedMatrix(this: Object3D) {
  ;(Object.getPrototypeOf(this) as Object3D).updateMatrix.call(this)
  const pose = poses.get(this)
  if (!pose) return
  const { pivot, scale, lift, glide } = pose
  this.matrix.multiply(step.makeTranslation(pivot.x, pivot.y, pivot.z))
  this.matrix.multiply(step.makeScale(scale.x, scale.y, scale.z))
  this.matrix.multiply(step.makeTranslation(-pivot.x, -pivot.y, -pivot.z))
  if (glide && glide.left > 0) {
    // Read from the root as it is now, so a renderer that has not yet put it at its new place
    // leaves it where it was: turned about its own origin by the share left of the way round, then carried.
    const { position, rotation } = this
    let turn = glide.yaw - rotation.y
    turn -= Math.round(turn / (2 * Math.PI)) * 2 * Math.PI
    glideStep.makeTranslation(
      (glide.from.x - position.x) * glide.left,
      (glide.from.y - position.y) * glide.left,
      (glide.from.z - position.z) * glide.left,
    )
    glideStep.multiply(glideAround.makeTranslation(position.x, position.y, position.z))
    glideStep.multiply(glideAround.makeRotationY(turn * glide.left))
    glideStep.multiply(glideAround.makeTranslation(-position.x, -position.y, -position.z))
    this.matrix.premultiply(glideStep)
  }
  // Premultiplied: a fall is in metres along the parent's up, whatever the root's own scale.
  this.matrix.elements[13] += lift
}

export function setRevealPose(object: Object3D, pivot: Vector3, scale: Vector3, lift = 0): void {
  let pose = poses.get(object)
  if (!pose) {
    pose = { pivot: new Vector3(), scale: new Vector3(), lift: 0, glide: null }
    poses.set(object, pose)
    object.updateMatrix = updateRevealedMatrix
  }
  pose.pivot.copy(pivot)
  pose.scale.copy(scale)
  pose.lift = lift
}

/**
 * A piece the agent moved shows where it was and travels to where it now is: `left` is the share of
 * the way still to go (1 at the start, 0 at rest), `hop` a lift in metres along the parent's up.
 * `from` and `yaw` are its old position and turn in its parent's frame; the root's own transform is
 * the new one, whenever the renderer writes it.
 */
export function setGlidePose(
  object: Object3D,
  from: Vector3,
  yaw: number,
  left: number,
  hop = 0,
): void {
  if (!poses.has(object)) setRevealPose(object, new Vector3(), new Vector3(1, 1, 1))
  const pose = poses.get(object)!
  pose.glide = { from: (pose.glide?.from ?? new Vector3()).copy(from), yaw, left }
  pose.lift = hop
}

export function clearRevealPose(object: Object3D): void {
  if (!poses.delete(object)) return
  delete (object as Partial<Pick<Object3D, 'updateMatrix'>>).updateMatrix
  if (object.matrixAutoUpdate) object.updateMatrix()
  object.matrixWorldNeedsUpdate = true
}

export function hasRevealPose(object: Object3D): boolean {
  return poses.has(object)
}

const MIN_SCALE = 1e-3
/** The share of a drop spent in the air; the rest is the landing. */
export const DROP_FALL = 0.68
/** The share of a drop a lead takes: a hair of lift before the fall. */
const DROP_LEAD = 0.14
/** A landing hops back up this share of the fall, at most `DROP_HOP_MAX` metres. */
const DROP_HOP = 0.012
const DROP_HOP_MAX = 0.05
const DROP_SQUASH = 0.08

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3

export type RevealPoseSample = { lift: number; scale: Vector3 }

export type RevealPoseOptions = {
  /**
   * A drop's anticipation: it lifts this share of its height before it falls (0.05 on a 4 m
   * drop is 20 cm), so the eye is told where it is about to fall from. None by default.
   */
  lead?: number
  /** A heavier drop lands with a bigger squash and hop; 1 by default. The last piece of a build is heavier. */
  weight?: number
}

/**
 * Where a `style` reveal holds its node at `t` in [0, 1]: a lift in metres
 * along the parent's up and a scale about the style's pivot. At `t >= 1` it
 * is exactly the rest pose (no lift, unit scale), so nothing settles off by a
 * rounding error.
 */
export function revealPoseAt(
  style: RevealStyle,
  t: number,
  height: number,
  out: RevealPoseSample = { lift: 0, scale: new Vector3() },
  options: RevealPoseOptions = {},
): RevealPoseSample {
  out.lift = 0
  out.scale.set(1, 1, 1)
  if (t >= 1 || style === 'assemble') return out
  const at = Math.max(0, t)
  switch (style) {
    case 'rise':
      out.scale.y = Math.max(MIN_SCALE, easeOutCubic(at))
      break
    case 'scale': {
      const f = Math.max(MIN_SCALE, easeOutCubic(at))
      out.scale.set(f, f, f)
      break
    }
    case 'settle':
      out.lift = height * (1 - easeOutCubic(at))
      break
    case 'drop': {
      const lead = Math.max(0, options.lead ?? 0)
      const weight = Math.max(0.5, options.weight ?? 1)
      const fallStart = lead > 0 ? DROP_LEAD : 0
      if (at < fallStart) {
        // A hair of lift, up and back to where it hangs: the fall is about to start.
        out.lift = height * (1 + lead * Math.sin((Math.PI * at) / fallStart))
        break
      }
      if (at < DROP_FALL) {
        // Gravity: slow off the hook, fastest at the impact.
        const fell = (at - fallStart) / (DROP_FALL - fallStart)
        out.lift = height * (1 - fell * fell)
        break
      }
      const u = (at - DROP_FALL) / (1 - DROP_FALL)
      out.lift = Math.min(DROP_HOP_MAX, height * DROP_HOP) * weight * 4 * u * (1 - u)
      // The squash at impact, a rebound past rest (follow-through), then still: it is zero, and flat,
      // exactly at the end.
      const squash = DROP_SQUASH * weight * (1 - u) ** 1.5 * Math.cos(1.5 * Math.PI * u)
      out.scale.set(1 + squash / 2, 1 - squash, 1 + squash / 2)
      break
    }
    case 'cut':
      // Through the wall only, along its normal (the opening's z): carved out, not popped in.
      out.scale.z = Math.max(MIN_SCALE, easeOutCubic(at))
      break
  }
  return out
}

export type RetractPoseSample = RevealPoseSample & {
  /** 1 while it is drawn whole; a piece that lifts away fades, and is 0 once gone. */
  opacity: number
}

/** A piece that fell in lifts away this share of the height it fell from, at least and at most this many metres. */
const RETRACT_LIFT_SHARE = 0.5
export const RETRACT_LIFT_MIN = 0.3
export const RETRACT_LIFT_MAX = 1.5

const smoothstep = (low: number, high: number, value: number) => {
  const x = Math.min(1, Math.max(0, (value - low) / (high - low)))
  return x * x * (3 - 2 * x)
}

/**
 * Where a `style` reveal holds its node as it is taken back, `p` in [0, 1] from whole to gone: the
 * build played in reverse for an undo. Whatever grew shrinks the way it grew (a wall sinks into
 * the ground, an opening closes through its wall), slowly at first and faster as it goes, which is
 * what a rewind looks like; whatever fell in lifts away and fades, quick off the mark, as a thing
 * thrown up does. At `p >= 1` it is gone: its scale at the least and its opacity 0.
 */
export function retractPoseAt(
  style: RevealStyle,
  p: number,
  height: number,
  out: RetractPoseSample = { lift: 0, scale: new Vector3(), opacity: 1 },
): RetractPoseSample {
  out.lift = 0
  out.scale.set(1, 1, 1)
  out.opacity = 1
  const at = Math.min(1, Math.max(0, p))
  const shrunk = Math.max(MIN_SCALE, 1 - at * at)
  switch (style) {
    case 'rise':
      out.scale.y = shrunk
      break
    case 'scale':
      out.scale.set(shrunk, shrunk, shrunk)
      break
    case 'cut':
      out.scale.z = shrunk
      break
    case 'settle':
    case 'drop':
    case 'assemble':
      out.lift =
        Math.min(RETRACT_LIFT_MAX, Math.max(RETRACT_LIFT_MIN, height * RETRACT_LIFT_SHARE)) *
        easeOutCubic(at)
      out.opacity = 1 - smoothstep(0.1, 0.8, at)
      break
  }
  if (at >= 1) {
    // Gone: what shrank is at its smallest already; what lifted away shrinks away with its last fade.
    if (out.lift > 0) out.scale.set(MIN_SCALE, MIN_SCALE, MIN_SCALE)
    out.opacity = 0
  }
  return out
}

/**
 * How far into its duration each style has arrived, the frame its contact or its last movement
 * lands on: a drop's impact, a rise's last centimetre. An assembled node holds still: its parts land.
 */
export const REVEAL_ARRIVAL: Record<RevealStyle, number> = {
  rise: 1,
  scale: 1,
  settle: 1,
  drop: DROP_FALL,
  cut: 1,
  assemble: 0,
}

/** Whether `style` has landed at `t`: a drop's impact, after which it only settles. */
export function revealHasLanded(style: RevealStyle, t: number): boolean {
  return style !== 'drop' || t >= DROP_FALL
}

const bounds = new Box3()
const part = new Box3()

/** The root's drawn bounds in its own frame, ignoring the reveal pose and hidden parts. */
export function revealLocalBounds(root: Object3D, out: Box3 = new Box3()): Box3 {
  bounds.makeEmpty()
  const visit = (object: Object3D, matrix: Matrix4) => {
    if (object.visible === false) return
    const geometry = (object as Mesh).isMesh ? (object as Mesh).geometry : undefined
    if (geometry?.getAttribute('position')) {
      if (!geometry.boundingBox) geometry.computeBoundingBox()
      if (geometry.boundingBox) bounds.union(part.copy(geometry.boundingBox).applyMatrix4(matrix))
    }
    for (const child of object.children) {
      if (child.matrixAutoUpdate) child.updateMatrix()
      visit(child, new Matrix4().multiplyMatrices(matrix, child.matrix))
    }
  }
  visit(root, new Matrix4())
  return out.copy(bounds)
}

/**
 * Where a reveal scales about, in the root's frame: under the origin at the
 * base of its drawn bounds for `rise` (a wall's frame already starts at its
 * base), the centre of the bounds for `cut`, and the base of their centre for
 * the rest.
 */
export function revealPivot(box: Box3, style: RevealStyle): Vector3 {
  if (box.isEmpty()) return new Vector3()
  const centre = box.getCenter(new Vector3())
  if (style === 'rise') return new Vector3(0, box.min.y, 0)
  if (style === 'cut') return centre
  return new Vector3(centre.x, box.min.y, centre.z)
}
