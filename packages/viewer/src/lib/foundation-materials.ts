import { FrontSide } from 'three'
import {
  attribute,
  color,
  float,
  floor,
  fract,
  mix,
  mod,
  mx_noise_float,
  normalLocal,
  positionWorld,
  smoothstep,
  step,
  vec3,
} from 'three/tsl'
import { MeshLambertNodeMaterial } from 'three/webgpu'

/**
 * How bare structure looks: courses of block, and cast concrete. The generic foundation under a
 * building draws them (nodes `generic-foundation.tsx`), and a wall whose assembly has no cladding
 * over a masonry or concrete core shows the same on its exterior face (`wall-materials.ts`), so a
 * basement's walls above grade read as the foundation under them.
 */
const INCH = 0.0254
/** A nominal 8 × 8 × 16 in block: the course is 8 in with its joint, a block 16 in long. */
const COURSE = 8 * INCH
const BLOCK_LENGTH = 16 * INCH
const JOINT = (3 / 8) * INCH
const JOINT_SOFTNESS = 0.05
const BLOCK_COLORS = { light: '#97978f', dark: '#827f78' } as const
const MORTAR_COLOR = '#b5b3aa'
const CONCRETE_COLORS = { light: '#8a8a86', dark: '#6f6e6a' } as const

/** The flat colour each structure reads as where only a colour is wanted (the cutaway palette). */
export const STRUCTURE_COLORS = {
  cmu: BLOCK_COLORS.light,
  concrete: CONCRETE_COLORS.light,
} as const

// TSL's own typings widen a float to a vec4 here, so the pieces are untyped.
function jointMask(inside: any, joint: number) {
  const edge = joint / 2
  return smoothstep(float(edge), float(edge + JOINT_SOFTNESS), inside).mul(
    smoothstep(float(edge), float(edge + JOINT_SOFTNESS), float(1).sub(inside)),
  )
}

export type Masonry = {
  course: number
  length: number
  joint: number
  colors: { light: string; dark: string }
  mortar: string
}

export const BLOCK_MASONRY: Masonry = {
  course: COURSE,
  length: BLOCK_LENGTH,
  joint: JOINT,
  colors: BLOCK_COLORS,
  mortar: MORTAR_COLOR,
}

/**
 * Courses of running bond: each course half a unit over the one under it, mortar between. The
 * courses are the world's (`positionWorld.y`), so a wall above a foundation bonds on its courses;
 * `along` is the metres along the run, the foundation's own attribute by default, a wall's
 * world-planar U where the geometry has none.
 */
export function masonryMaterial(
  { course: courseHeight, length, joint, colors, mortar }: Masonry,
  along: any = attribute<'float'>('along', 'float'),
) {
  const material = new MeshLambertNodeMaterial({ side: FrontSide })
  const rows = positionWorld.y.div(courseHeight)
  const course = floor(rows)
  const columns = along.div(length).add(mod(course, 2).mul(0.5))
  const face: any = jointMask(fract(rows), joint / courseHeight).mul(
    jointMask(fract(columns), joint / length),
  )
  const shade: any = mx_noise_float(vec3(floor(columns), course, 0.5))
    .mul(0.5)
    .add(0.5)
  const block = mix(color(colors.dark), color(colors.light), shade)
  const patterned = mix(color(mortar), block, face)
  // The top of a run is the plain block, whatever course the shader finds there.
  const flat = step(float(0.5), normalLocal.y.abs())
  material.colorNode = mix(patterned, block, flat)
  return material
}

export function concreteMaterial() {
  const material = new MeshLambertNodeMaterial({ side: FrontSide })
  const grain = mx_noise_float(positionWorld.mul(vec3(2.5, 2.5, 2.5)))
    .mul(0.5)
    .add(0.5)
  material.colorNode = mix(color(CONCRETE_COLORS.dark), color(CONCRETE_COLORS.light), grain)
  return material
}
