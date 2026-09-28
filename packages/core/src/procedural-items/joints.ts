import type { EvaluatedMotion, EvaluatedShape, Expr, Recipe, Vec3 } from './recipe'
import {
  type Bounds,
  boundsOf,
  boxCorners,
  composePoses,
  eulerPose,
  hingePose,
  IDENTITY_POSE,
  type Pose,
  poseDirection,
  posePoint,
  sweptHingeBounds,
} from './spatial'

// v2 part trees and joints (AK-04). A part may hang from a parent part (moving with it) and be
// authored in its own frame; a joint turns or slides it relative to that parent. Joints
// evaluate to the same EvaluatedMotion records as flat `part.motion`, with the joint id equal
// to the child part id, so controllers, clips and baked extras keep their contract. Nested
// groups carry `parent`; axes off the principal directions carry `direction`.

type Part = Recipe['parts'][number]
type Joint = NonNullable<Recipe['joints']>[number]
export type PartPlacement = {
  /** Rest pose of the part's frame in design space, joint included. */
  pose: Pose
  /** The motion group the part's shapes and light ride in, if any. */
  group?: string
  /** The group's motion, on the instance that owns the joint. */
  motion?: EvaluatedMotion
}
const LIMITS = { hinge: Math.PI, slide: 5, spin: 20 } as const
const KIND = { revolute: 'hinge', prismatic: 'slide', continuous: 'spin' } as const

export function usesPartTree(recipe: Recipe): boolean {
  // An explicitly present joints array, even empty, is v2 content.
  return Boolean(
    recipe.joints !== undefined || recipe.parts.some((part) => part.parent || part.frame),
  )
}

/** Structural checks that need no parameter values. */
export function validatePartTree(recipe: Recipe) {
  const parts = new Map(recipe.parts.map((part) => [part.id, part]))
  const joints = new Map<string, Joint>()
  for (const joint of recipe.joints ?? []) {
    const part = parts.get(joint.child)
    if (!part) throw new Error(`Unknown joint part ${joint.child}`)
    if (joints.has(joint.child)) throw new Error(`Part ${joint.child} has more than one joint`)
    if (part.motion) throw new Error(`Part ${joint.child} has both a motion and a joint`)
    joints.set(joint.child, joint)
    const timed = [joint.delay, joint.duration, joint.easing].some((v) => v !== undefined)
    const valued = [joint.open, joint.rest, joint.range].some((v) => v !== undefined)
    if (joint.kind === 'fixed' && (valued || timed || joint.speed !== undefined))
      throw new Error(`Fixed joint ${joint.child} takes no values, speed or timing`)
    if (
      (joint.kind === 'revolute' || joint.kind === 'prismatic') &&
      (joint.open === undefined || joint.speed !== undefined)
    )
      throw new Error(`Joint ${joint.child} needs an open value and no speed`)
    if (
      joint.kind === 'continuous' &&
      (joint.speed === undefined || joint.open !== undefined || joint.range || timed)
    )
      throw new Error(
        `Continuous joint ${joint.child} needs a speed and no open value, range or timing`,
      )
  }
  for (const part of recipe.parts) {
    if (part.motion && (part.parent || part.frame))
      throw new Error(`Part ${part.id} with a flat motion cannot sit in a part tree`)
    if (!part.parent) continue
    if (part.parent === part.id || !parts.has(part.parent))
      throw new Error(`Unknown parent ${part.parent} for ${part.id}`)
    if (parts.get(part.parent)!.motion)
      throw new Error(`Part ${part.id} cannot hang from ${part.parent}, which has a flat motion`)
    let depth = 0
    for (let at: Part | undefined = part; at?.parent; at = parts.get(at.parent))
      if (++depth > 8) throw new Error(`Part tree around ${part.id} is cyclic or deeper than 8`)
  }
  return joints
}

/** True when the part or an ancestor moves (so it cannot carry supports or surfaces). */
export function partMoves(recipe: Recipe, partId: string): boolean {
  const parts = new Map(recipe.parts.map((part) => [part.id, part]))
  for (let at = parts.get(partId); at; at = at.parent ? parts.get(at.parent) : undefined) {
    if (at.motion) return true
    const joint = recipe.joints?.find((j) => j.child === at!.id)
    if (joint && joint.kind !== 'fixed') return true
  }
  return false
}

function unit(axis: Vec3, part: string): Vec3 {
  const length = Math.hypot(...axis)
  if (!(length > 1e-9)) throw new Error(`Joint ${part} needs a nonzero axis`)
  return axis.map((v) => v / length) as Vec3
}

/**
 * Rest poses, groups and motions of every part instance of a v2 part tree, keyed
 * `${part}:${index}`. A missing key means the instance is not built (its own or an
 * ancestor's `when` is zero).
 */
export function placeParts(
  recipe: Recipe,
  value: (e: Expr, index: number) => number,
): Map<string, PartPlacement> {
  const parts = new Map(recipe.parts.map((part) => [part.id, part]))
  const joints = new Map((recipe.joints ?? []).map((joint) => [joint.child, joint]))
  const counts = new Map(recipe.parts.map((part) => [part.id, value(part.count, 0)]))
  const placed = new Map<string, PartPlacement | null>()
  const vec = (v: readonly Expr[], i: number) => v.map((e) => value(e, i)) as Vec3
  const place = (part: Part, i: number): PartPlacement | null => {
    const key = `${part.id}:${i}`
    if (placed.has(key)) return placed.get(key)!
    let parent: PartPlacement | null = { pose: IDENTITY_POSE }
    if (part.parent) {
      const host = parts.get(part.parent)!
      // A single child rides repeat 0 of its parent; equal counts bind by index.
      const single = counts.get(part.id) === 1
      if (!single && counts.get(part.id) !== counts.get(host.id))
        throw new Error(
          `Part ${part.id} must repeat once or exactly as often as its parent ${host.id}`,
        )
      parent = place(host, single ? 0 : i)
    }
    if (!parent || (part.when !== undefined && value(part.when, i) === 0)) {
      placed.set(key, null)
      return null
    }
    const frame = part.frame
      ? composePoses(
          parent.pose,
          eulerPose(vec(part.frame.position, i), vec(part.frame.rotation ?? [0, 0, 0], i)),
        )
      : parent.pose
    const joint = joints.get(part.id)
    let result: PartPlacement = { pose: frame, group: parent.group }
    if (joint) {
      const origin = vec(joint.origin, i)
      const axis = unit(vec(joint.axis, i), part.id)
      const rest = joint.rest === undefined ? 0 : value(joint.rest, i)
      const move = (amount: number): Pose =>
        joint.kind === 'prismatic'
          ? { r: IDENTITY_POSE.r, t: axis.map((v) => v * amount) as Vec3 }
          : hingePose(origin, axis, amount)
      result = {
        pose: joint.kind === 'fixed' || rest === 0 ? frame : composePoses(frame, move(rest)),
        group: parent.group,
      }
      if (joint.kind !== 'fixed') {
        const kind = KIND[joint.kind]
        const open = joint.kind === 'continuous' ? value(joint.speed!, i) : value(joint.open!, i)
        const range = joint.range?.map((e) => value(e, i))
        if (
          range &&
          !(
            range[0]! <= range[1]! &&
            [rest, open].every((v) => v >= range[0]! - 1e-9 && v <= range[1]! + 1e-9)
          )
        )
          throw new Error(`Joint ${part.id} rest and open values must lie within its range`)
        if (
          range &&
          joint.kind !== 'continuous' &&
          range.some((end) => Math.abs(end - rest) > LIMITS[kind] + 1e-9)
        )
          throw new Error(
            `Joint ${part.id} range must lie within ${LIMITS[kind]} of its rest value`,
          )
        let amount = joint.kind === 'continuous' ? open : open - rest
        if (!(Math.abs(amount) > 0 && Math.abs(amount) <= LIMITS[kind]))
          throw new Error(
            `Invalid ${kind} amount for ${part.id}: expected 0 < absolute value <= ${LIMITS[kind]}`,
          )
        const delay = joint.kind === 'continuous' ? 0 : value(joint.delay ?? 0, i)
        const duration = joint.kind === 'continuous' ? 0 : value(joint.duration ?? 0.45, i)
        const easing = joint.kind === 'continuous' ? 'linear' : (joint.easing ?? 'smooth')
        if (
          !Number.isFinite(delay) ||
          !Number.isFinite(duration) ||
          delay < 0 ||
          delay > 1 ||
          (joint.kind !== 'continuous' && (duration < 0.1 || duration > 2))
        )
          throw new Error(`Invalid timing for ${part.id}`)
        // Design-space axis at rest; a principal axis keeps today's flat form exactly.
        let direction = unit(poseDirection(frame, axis), part.id)
        const principal = direction.findIndex((v) => Math.abs(v) > 1 - 1e-9)
        const flipped = principal >= 0 && direction[principal]! < 0
        if (flipped) amount = -amount
        const letter = (['x', 'y', 'z'] as const)[
          principal >= 0
            ? principal
            : direction.map(Math.abs).indexOf(Math.max(...direction.map(Math.abs)))
        ]!
        if (principal >= 0) direction = [0, 0, 0].map((_, k) => (k === principal ? 1 : 0)) as Vec3
        const id = i ? `${part.id}~${i}` : part.id
        result.group = id
        result.motion = {
          id,
          partId: part.id,
          kind,
          axis: letter,
          pivot: kind === 'slide' ? [0, 0, 0] : posePoint(frame, origin),
          amount,
          delay,
          duration,
          easing,
          ...(principal < 0 && { direction }),
          ...(parent.group && { parent: parent.group }),
          // Relative to rest, and about the stored (positive) axis when the joint's was negative.
          ...(range && {
            range: (flipped
              ? [rest - range[1]!, rest - range[0]!]
              : [range[0]! - rest, range[1]! - rest]) as [number, number],
          }),
        }
      }
    }
    placed.set(key, result)
    return result
  }
  const out = new Map<string, PartPlacement>()
  for (const part of recipe.parts)
    for (let i = 0; i < counts.get(part.id)!; i++) {
      const at = place(part, i)
      if (at) out.set(`${part.id}:${i}`, at)
    }
  return out
}

/**
 * Where each root joint group can reach: its shapes' box, grown by every nested group's
 * reach, swept over its own travel (and range) interval. Intervals compose per joint, so
 * nesting never multiplies samples.
 */
export function jointReach(
  motions: readonly EvaluatedMotion[],
  shapes: readonly EvaluatedShape[],
  shapeBounds: (shape: EvaluatedShape) => Bounds,
): { motion: EvaluatedMotion; bounds: Bounds }[] {
  const own = new Map<string, Vec3[]>()
  for (const shape of shapes) {
    if (!shape.motionGroup) continue
    const b = shapeBounds(shape)
    own.set(shape.motionGroup, [...(own.get(shape.motionGroup) ?? []), b.min, b.max])
  }
  const reach = (motion: EvaluatedMotion): Bounds | null => {
    const points = [...(own.get(motion.id) ?? [])]
    for (const child of motions)
      if (child.parent === motion.id) {
        const b = reach(child)
        if (b) points.push(b.min, b.max)
      }
    if (!points.length) return null
    const box = boundsOf(points)
    const axis =
      motion.direction ??
      ([0, 1, 2].map((k) => (['x', 'y', 'z'][k] === motion.axis ? 1 : 0)) as Vec3)
    const travel = [0, motion.amount, ...(motion.range ?? [])]
    const [from, to] = [Math.min(...travel), Math.max(...travel)]
    if (motion.kind === 'slide') {
      const corners = boxCorners(box.min, box.max)
      return boundsOf(
        [from, to].flatMap((d) => corners.map((c) => c.map((v, k) => v + axis[k]! * d) as Vec3)),
      )
    }
    return motion.kind === 'spin'
      ? sweptHingeBounds(box, motion.pivot, axis, 0, 2 * Math.PI)
      : sweptHingeBounds(box, motion.pivot, axis, from, to)
  }
  return motions
    .filter((motion) => !motion.parent)
    .flatMap((motion) => {
      const bounds = reach(motion)
      return bounds ? [{ motion, bounds }] : []
    })
}
