import { z } from 'zod'
import type { ResolvedSectionProfile } from '../schema/types'
import { jointReach, partMoves, placeParts, usesPartTree, validatePartTree } from './joints'
import { extrusionTriangles, sectionRings, sectionThickness } from './section'
import {
  boundsOf,
  boxCorners,
  composePoses,
  eulerPose,
  frame,
  IDENTITY_POSE,
  matrixEuler,
  posePoint,
  rotateVector,
  transformPoint,
} from './spatial'

export type Expr =
  | number
  | string
  | { op: 'add' | 'sub' | 'mul' | 'div' | 'min' | 'max'; args: Expr[] }
  | { op: 'floor' | 'ceil' | 'round' | 'abs' | 'sin' | 'cos'; args: [Expr] }
  | { op: 'mod'; args: [Expr, Expr] }
/**
 * Version 2 expressions: Expr plus select(i, v0, …, vn-1), which is v_i for an integral i in
 * [0, n). Recipe fields stay typed as the v1 Expr so v1 consumers keep compiling; v2 content
 * may carry these at runtime.
 */
export type ExprV2 =
  | number
  | string
  | { op: 'add' | 'sub' | 'mul' | 'div' | 'min' | 'max'; args: ExprV2[] }
  | { op: 'floor' | 'ceil' | 'round' | 'abs' | 'sin' | 'cos'; args: [ExprV2] }
  | { op: 'mod'; args: [ExprV2, ExprV2] }
  | { op: 'select'; args: ExprV2[] }
export type Vec3 = [number, number, number]
const id = z.string().regex(/^[a-z][a-z0-9_]{0,47}$/)
const finite = z.number().finite().min(-1000).max(1000)
const expressionV2: z.ZodType<ExprV2> = z.lazy(() =>
  z.union([
    finite,
    id,
    z.strictObject({
      op: z.enum(['add', 'sub', 'mul', 'div', 'min', 'max']),
      args: z.array(expressionV2).min(2).max(8),
    }),
    z.strictObject({
      op: z.enum(['floor', 'ceil', 'round', 'abs', 'sin', 'cos']),
      args: z.tuple([expressionV2]),
    }),
    z.strictObject({
      op: z.literal('mod'),
      args: z.tuple([expressionV2, expressionV2]),
    }),
    z.strictObject({
      op: z.literal('select'),
      args: z.array(expressionV2).min(2).max(65),
    }),
  ]),
)
// The schema reads v2 expressions; the public Recipe type keeps the v1 Expr (R1).
const expression = expressionV2 as unknown as z.ZodType<Expr>
const vector = z.tuple([expression, expression, expression])
const sectionRing = z
  .array(z.tuple([expression, expression]))
  .min(3)
  .max(64)
// An F1 section whose numbers may be expressions; it evaluates to a ResolvedSectionProfile.
const section = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('rectangle'),
    width: expression,
    depth: expression,
    corner: expression.optional(),
  }),
  z.strictObject({ kind: z.literal('round'), radius: expression, wall: expression.optional() }),
  z.strictObject({ kind: z.literal('oval'), width: expression, depth: expression }),
  z.strictObject({
    kind: z.literal('section'),
    family: z.enum(['I', 'C', 'L', 'T', 'Z', 'rect-tube']),
    width: expression,
    depth: expression,
    web: expression,
    flange: expression,
  }),
  z.strictObject({
    kind: z.literal('polygon'),
    outer: sectionRing,
    holes: z.array(sectionRing).max(16).optional(),
  }),
])
const timing = {
  delay: expression.optional(),
  duration: expression.optional(),
  easing: z.enum(['linear', 'smooth', 'soft']).optional(),
}
const cutCenter = z.tuple([expression, expression]).optional()
const cut = z.discriminatedUnion('shape', [
  z.strictObject({
    shape: z.literal('rect'),
    size: z.tuple([expression, expression]),
    center: cutCenter,
  }),
  z.strictObject({ shape: z.literal('circle'), diameter: expression, center: cutCenter }),
])
const motion = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('hinge'),
    pivot: vector,
    axis: z.enum(['x', 'y', 'z']),
    angle: expression,
    ...timing,
  }),
  z.strictObject({
    kind: z.literal('slide'),
    axis: z.enum(['x', 'y', 'z']),
    distance: expression,
    ...timing,
  }),
  z.strictObject({
    kind: z.literal('spin'),
    pivot: vector,
    axis: z.enum(['x', 'y', 'z']),
    radiansPerSecond: expression,
  }),
])
// Version 2 lifts the part caps; triangles (counted as three.js builds them), bytes, the
// structural budget and evaluation time bound the rest.
// Inline v2 designs stay under R7's 24 KiB until pinned definitions (P-05) store larger ones;
// one evaluation may take at most `milliseconds` (a guard, far above real recipes' cost).
export const RECIPE_V2_LIMITS = {
  parts: 64,
  partShapes: 512,
  shapes: 512,
  bytes: 24 * 1024,
  milliseconds: 250,
} as const
export const RECIPE_LIMITS = {
  bytes: 131072,
  depth: 24,
  expressions: 50000,
  shapes: 256,
  triangles: 100000,
  dimension: 30,
  motionParts: 8,
  motionGroups: 32,
  lights: 12,
} as const
// Shape keys keep v1's order (id, primitive, slot, size, position, …), so parsed v1 recipes
// serialize byte for byte as before.
const shapeTail = {
  support: z.boolean().optional(),
  // v2: the shape is built only where this evaluates to nonzero.
  when: expression.optional(),
}
// Sized primitives keep a required size (R1: v1 consumers narrow on primitive and read it).
const solidShape = z.strictObject({
  id,
  primitive: z.enum(['box', 'roundedBox', 'cylinder', 'ellipsoid']),
  slot: id,
  size: vector,
  position: vector,
  rotation: vector.optional(),
  radius: expression.optional(),
  topScale: expression.optional(),
  // v2 cylinders: side count (absent = 24), no end caps, hollow wall (inner radius as a
  // fraction of the outer), and a partial sweep in radians from local +Z toward +X, closed
  // by flat wedge sides unless open.
  segments: z.number().int().min(3).max(64).optional(),
  open: z.boolean().optional(),
  inner: expression.optional(),
  arc: expression.optional(),
  ...shapeTail,
})
// v2 extrude: a section in local x/y, extruded along local z by length, centred.
const extrudeShape = z.strictObject({
  id,
  primitive: z.literal('extrude'),
  slot: id,
  section,
  length: expression,
  bevel: expression.optional(),
  position: vector,
  rotation: vector.optional(),
  ...shapeTail,
})
// v2 revolve: [radius, height] points turned about local Y (segments and arc as on
// cylinders); the shape is closed where the profile meets the axis at both ends.
const revolveShape = z.strictObject({
  id,
  primitive: z.literal('revolve'),
  slot: id,
  profile: z
    .array(z.tuple([expression, expression]))
    .min(2)
    .max(64),
  segments: z.number().int().min(3).max(64).optional(),
  arc: expression.optional(),
  position: vector,
  rotation: vector.optional(),
  ...shapeTail,
})
type RecipeShape =
  | z.infer<typeof solidShape>
  | z.infer<typeof extrudeShape>
  | z.infer<typeof revolveShape>
/** The sized-primitive fields of a shape (none for an extrude). */
function solidFields(
  shape: RecipeShape,
): Partial<
  Pick<
    z.infer<typeof solidShape>,
    'size' | 'radius' | 'topScale' | 'segments' | 'open' | 'inner' | 'arc'
  >
> {
  if (shape.primitive === 'extrude') return {}
  if (shape.primitive === 'revolve') return { segments: shape.segments, arc: shape.arc }
  return shape
}
const RecipeObject = z.strictObject({
  // Version 2 marks content that older readers cannot evaluate; v2-only fields require it.
  version: z.union([z.literal(1), z.literal(2)]),
  name: z.string().min(1).max(100),
  description: z.string().max(600),
  classification: z
    .strictObject({
      category: id,
      functionTags: z.array(z.string().min(1).max(80)).max(16),
      tags: z.array(z.string().min(1).max(80)).max(16),
    })
    .optional(),
  mounting: z
    .strictObject({ attachTo: z.enum(['wall-side', 'ceiling']), reference: id })
    .optional(),
  // v2, floor designs: the design-space height that rests on the host floor.
  base: expression.optional(),
  // v2, ceiling designs: an opening in the host ceiling, drawn in the mounting reference's x/z
  // plane around it. The design may rise above the reference only inside its cut.
  cuts: z.array(cut).min(1).max(1).optional(),
  surfaces: z
    .array(
      z.strictObject({
        id,
        label: z.string().min(1).max(60),
        part: id.optional(),
        position: vector,
        rotation: vector.optional(),
        size: z.tuple([expression, expression]),
      }),
    )
    .max(24)
    .optional(),
  parameters: z
    .array(
      z.strictObject({
        id,
        label: z.string().min(1).max(60),
        default: finite,
        min: finite,
        max: finite,
        step: z.number().positive().max(100),
        // v2: 'bool' is 0 | 1; 'choice' is an index into `options`.
        unit: z.enum(['m', 'count', 'rad', 's', 'bool', 'choice']),
        options: z.array(z.string().min(1).max(60)).min(2).max(16).optional(),
        part: id.optional(),
        axis: z.enum(['x', 'y', 'z']).optional(),
      }),
    )
    .min(1)
    .max(16),
  slots: z
    .array(
      z.strictObject({
        id,
        label: z.string().min(1).max(60),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        finish: z.enum(['glass', 'metal', 'wood']).optional(),
      }),
    )
    .min(1)
    .max(8),
  parts: z
    .array(
      z.strictObject({
        id,
        label: z.string().min(1).max(60),
        count: expression,
        // v2 part tree: the part moves with `parent` (repeating once, or exactly as often,
        // bound by index) and its shapes, light and joint are authored in `frame`.
        parent: id.optional(),
        frame: z.strictObject({ position: vector, rotation: vector.optional() }).optional(),
        // v2: a repeat is built only where this evaluates to nonzero.
        when: expression.optional(),
        motion: motion.optional(),
        light: z
          .strictObject({
            position: vector,
            color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
            intensity: z.number().finite().gt(0).max(10).optional(),
            distance: z.number().finite().min(0.1).max(10).optional(),
            emissiveSlot: id.optional(),
          })
          .optional(),
        shapes: z
          .array(z.discriminatedUnion('primitive', [solidShape, extrudeShape, revolveShape]))
          .min(1)
          .max(RECIPE_V2_LIMITS.partShapes),
      }),
    )
    .min(1)
    .max(RECIPE_V2_LIMITS.parts),
  // v2: at most one joint per part, keyed by the child part; origin and axis are in the part's
  // frame. Values are radians (revolute, continuous speed per second) or metres (prismatic).
  joints: z
    .array(
      z.strictObject({
        child: id,
        kind: z.enum(['fixed', 'revolute', 'continuous', 'prismatic']),
        origin: vector,
        axis: vector,
        open: expression.optional(),
        rest: expression.optional(),
        range: z.tuple([expression, expression]).optional(),
        speed: expression.optional(),
        ...timing,
      }),
    )
    .max(64)
    .optional(),
  constraints: z
    .array(
      z.strictObject({
        left: expression,
        relation: z.enum(['lte', 'gte']),
        right: expression,
        message: z.string().max(120),
      }),
    )
    .max(24),
})
export const RecipeSchema = RecipeObject.superRefine((recipe, ctx) => {
  const issue = versionIssue(recipe)
  if (issue) ctx.addIssue({ code: 'custom', message: issue })
})
export type Recipe = z.infer<typeof RecipeSchema>
export type EvaluatedShape = {
  id: string
  partId: string
  primitive: 'box' | 'roundedBox' | 'cylinder' | 'ellipsoid' | 'extrude' | 'revolve'
  slot: string
  size: Vec3
  position: Vec3
  rotation: Vec3
  radius: number
  topScale: number
  segments?: number
  open?: boolean
  inner?: number
  arc?: number
  /** Extrude: the evaluated section, centred on the shape; its length is size[2]. */
  section?: ResolvedSectionProfile
  bevel?: number
  /** Revolve: [radius, height] points, centred vertically on the shape. */
  profile?: [number, number][]
  motionGroup?: string
}
export type EvaluatedMotion = {
  id: string
  partId: string
  kind: 'hinge' | 'slide' | 'spin'
  axis: 'x' | 'y' | 'z'
  pivot: Vec3
  amount: number
  delay: number
  duration: number
  easing: 'linear' | 'smooth' | 'soft'
  /** v2 joints: the unit design-space axis when it is not a principal one (`axis` is nearest). */
  direction?: Vec3
  /** v2 joints: the motion group this one rides in. */
  parent?: string
  /** v2 joints: the joint's range relative to its rest value. */
  range?: [number, number]
}
export type EvaluatedLight = {
  id: string
  partId: string
  index: number
  motionGroup?: string
  position: Vec3
  color: string
  intensity: number
  distance: number
  emissiveSlot?: string
}
export type EvaluatedCut = {
  host: 'ceiling'
  /** Closed ring in design-space [x, z], at the mounting reference. */
  ring: [number, number][]
}
export type Surface = {
  id: string
  label: string
  position: Vec3
  rotation: Vec3
  normal: Vec3
  size: [number, number]
}
export type Evaluation = {
  shapes: EvaluatedShape[]
  motions: EvaluatedMotion[]
  lights: EvaluatedLight[]
  motionGroupByInstance: Record<string, string>
  surfaces: Surface[]
  cuts: EvaluatedCut[]
  min: Vec3
  max: Vec3
  dimensions: Vec3
  parameters: Record<string, number>
  triangles: number
  /** Recessed ceiling designs with motion: the rest bounds grown by every motion sample. */
  reach?: { min: Vec3; max: Vec3 }
}

function guardTree(value: unknown, depth = 0, budget = { count: 0 }) {
  if (++budget.count > 12000 || depth > RECIPE_LIMITS.depth)
    throw new Error('Recipe exceeds structural budget')
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Reserved key')
      guardTree(child, depth + 1, budget)
    }
  }
}
function movingParts(recipe: Recipe) {
  return (
    recipe.parts.filter((part) => part.motion).length +
    (recipe.joints ?? []).filter((joint) => joint.kind !== 'fixed').length
  )
}
function findV2Feature(recipe: Recipe): string | null {
  for (const primitive of ['extrude', 'revolve'] as const)
    if (recipe.parts.some((part) => part.shapes.some((shape) => shape.primitive === primitive)))
      return primitive
  if (
    recipe.parts.some((part) =>
      part.shapes.some((shape) =>
        [
          solidFields(shape).segments,
          solidFields(shape).open,
          solidFields(shape).inner,
          solidFields(shape).arc,
        ].some((v) => v !== undefined),
      ),
    )
  )
    return 'Cylinder segments, open, inner and arc'
  if (usesPartTree(recipe)) return 'Part trees and joints'
  if (recipe.parameters.some((p) => p.unit === 'bool' || p.unit === 'choice' || p.options))
    return 'Bool and choice parameters'
  if (
    recipe.parts.some(
      (part) => part.when !== undefined || part.shapes.some((s) => s.when !== undefined),
    )
  )
    return 'when'
  const selects = (value: unknown): boolean =>
    Array.isArray(value)
      ? value.some(selects)
      : Boolean(value && typeof value === 'object') &&
        ((value as { op?: unknown }).op === 'select' ||
          Object.values(value as object).some(selects))
  return selects(recipe) ? 'select' : null
}
/**
 * Version rules the exported schema, parseRecipe and evaluateRecipe all enforce: content
 * only a v2 reader understands must say `version: 2`.
 */
function versionIssue(recipe: Recipe): string | null {
  if (recipe.base !== undefined) {
    if (recipe.version !== 2) return 'A declared base requires recipe version 2'
    if (recipe.mounting)
      return 'A declared base applies to floor designs; mounted designs use their reference'
  }
  if (recipe.version === 1) {
    const feature = findV2Feature(recipe)
    if (feature) return `${feature} requires recipe version 2`
  }
  if (recipe.version === 1 && recipe.parts.length > 16)
    return 'More than 16 parts requires recipe version 2'
  if (recipe.version === 1 && recipe.parts.some((part) => part.shapes.length > 24))
    return 'More than 24 shapes in a part requires recipe version 2'
  if (recipe.version === 2 && JSON.stringify(recipe).length > RECIPE_V2_LIMITS.bytes)
    return 'A version 2 recipe above 24 KiB needs a pinned definition (P-05); keep it inline under 24 KiB'
  if (recipe.cuts !== undefined) {
    if (recipe.version !== 2) return 'Cuts require recipe version 2'
    if (recipe.mounting?.attachTo !== 'ceiling') return 'Cuts need a ceiling-mounted design'
  }
  return null
}
export function parseRecipe(input: unknown): Recipe {
  guardTree(input)
  if (JSON.stringify(input).length > RECIPE_LIMITS.bytes) throw new Error('Recipe is too large')
  const recipe = RecipeSchema.parse(input)
  if (usesPartTree(recipe)) validatePartTree(recipe)
  for (const list of [recipe.parameters, recipe.slots, recipe.parts]) {
    if (new Set(list.map((x) => x.id)).size !== list.length)
      throw new Error('IDs must be unique within each section')
  }
  for (const p of recipe.parameters) {
    if (p.id === 'index' || p.min > p.max || p.default < p.min || p.default > p.max)
      throw new Error(`Invalid parameter ${p.id}`)
    if (p.unit === 'count' && ![p.min, p.max, p.default, p.step].every(Number.isInteger))
      throw new Error(`Count ${p.id} must be integral`)
    if (
      (p.unit === 'bool' || p.unit === 'choice') &&
      (p.min !== 0 ||
        p.step !== 1 ||
        p.axis ||
        !Number.isInteger(p.default) ||
        p.max !== (p.unit === 'bool' ? 1 : (p.options?.length ?? 0) - 1))
    )
      throw new Error(
        `${p.unit === 'bool' ? 'Bool' : 'Choice'} ${p.id} must run 0..${p.unit === 'bool' ? 1 : 'options - 1'} in steps of 1 with no handle`,
      )
    if (p.options && p.unit !== 'choice')
      throw new Error(`Only choice parameters have options (${p.id})`)
    if (p.part && !recipe.parts.some((part) => part.id === p.part))
      throw new Error(`Unknown part ${p.part}`)
  }
  for (const part of recipe.parts) {
    if (new Set(part.shapes.map((s) => s.id)).size !== part.shapes.length)
      throw new Error(`Duplicate shape in ${part.id}`)
    for (const shape of part.shapes) {
      if (!recipe.slots.some((s) => s.id === shape.slot))
        throw new Error(`Unknown slot ${shape.slot}`)
      const f = solidFields(shape)
      if (f.topScale !== undefined && shape.primitive !== 'cylinder')
        throw new Error(`topScale is only allowed on cylinders (${part.id}/${shape.id})`)
      if ((shape.primitive === 'extrude' || shape.primitive === 'revolve') && shape.support)
        throw new Error(`${shape.primitive} ${part.id}/${shape.id} cannot be a support surface`)
      const cylinderOptions = [f.segments, f.open, f.inner, f.arc]
      if (cylinderOptions.some((option) => option !== undefined)) {
        if (shape.primitive !== 'cylinder' && shape.primitive !== 'revolve')
          throw new Error(
            `segments, open, inner and arc apply to cylinders (${part.id}/${shape.id})`,
          )
        if (shape.support && (f.inner !== undefined || f.arc !== undefined || f.open))
          throw new Error(`Support shape ${part.id}/${shape.id} cannot be hollow, open or partial`)
      }
      if (shape.support && partMoves(recipe, part.id))
        throw new Error(`Moving part ${part.id} cannot contain support shapes`)
      if (shape.primitive === 'ellipsoid' && shape.support)
        throw new Error(`Ellipsoid ${part.id}/${shape.id} cannot be a support surface`)
    }
  }
  if (movingParts(recipe) > RECIPE_LIMITS.motionParts)
    throw new Error(`Recipe exceeds ${RECIPE_LIMITS.motionParts} moving parts`)
  const surfaceIds = (recipe.surfaces ?? []).map((s) => s.id)
  if (new Set(surfaceIds).size !== surfaceIds.length) throw new Error('Duplicate surface ID')
  for (const surface of recipe.surfaces ?? []) {
    if (surface.part && !recipe.parts.some((p) => p.id === surface.part))
      throw new Error('Unknown surface part')
    if (surface.part && partMoves(recipe, surface.part))
      throw new Error(`Named surface ${surface.id} cannot belong to moving part ${surface.part}`)
  }
  if (
    recipe.mounting &&
    !(recipe.surfaces ?? []).some((s) => s.id === recipe.mounting!.reference && !s.part)
  )
    throw new Error('Mounting requires one named, non-repeated reference surface')
  const axes = recipe.parameters.flatMap((p) => (p.axis ? [`${p.part ?? 'design'}:${p.axis}`] : []))
  if (new Set(axes).size !== axes.length)
    throw new Error('Only one handle binding per axis in each part')
  evaluateRecipe(recipe)
  return recipe
}

function shapeCorners(size: Vec3, position: Vec3, rotation: Vec3): Vec3[] {
  const localMin = size.map((v) => -v / 2) as Vec3
  const localMax = size.map((v) => v / 2) as Vec3
  const shapeFrame = frame(position, rotation)
  return boxCorners(localMin, localMax).map((point) => transformPoint(shapeFrame, point))
}

function shapeBounds(shape: Pick<EvaluatedShape, 'primitive' | 'size' | 'position' | 'rotation'>) {
  if (shape.primitive !== 'ellipsoid')
    return boundsOf(shapeCorners(shape.size, shape.position, shape.rotation))
  const axes = [0, 1, 2].map((axis) =>
    rotateVector([0, 1, 2].map((j) => (j === axis ? 1 : 0)) as Vec3, shape.rotation),
  )
  const extent = [0, 1, 2].map((k) =>
    Math.hypot(...axes.map((axis, j) => (axis[k]! * shape.size[j]!) / 2)),
  ) as Vec3
  return boundsOf([
    shape.position.map((v, k) => v - extent[k]!) as Vec3,
    shape.position.map((v, k) => v + extent[k]!) as Vec3,
  ])
}

// Points whose hull contains the shape: a cylinder's rim vertices (as rendered), otherwise the
// corners of its oriented box (exact for boxes, conservative for the rest).
function shapeFootprint(shape: EvaluatedShape): Vec3[] {
  if (shape.primitive === 'revolve') {
    // Each profile point's ring as rendered, along the arc.
    const f = frame(shape.position, shape.rotation)
    const n = shape.segments ?? 24,
      arc = shape.arc ?? 2 * Math.PI
    const steps = arc < 2 * Math.PI - 1e-9 ? n + 1 : n
    return shape.profile!.flatMap(([r, y]) =>
      Array.from({ length: steps }, (_, k) => {
        const theta = (arc * k) / n
        return transformPoint(f, [r * Math.sin(theta), y, r * Math.cos(theta)])
      }),
    )
  }
  if (shape.primitive !== 'cylinder')
    return shapeCorners(shape.size, shape.position, shape.rotation)
  const f = frame(shape.position, shape.rotation)
  const n = shape.segments ?? 24,
    arc = shape.arc ?? 2 * Math.PI
  const partial = arc < 2 * Math.PI - 1e-9
  // Rim vertices as rendered, along the arc; a hollow arc adds its inner rim; a closed
  // partial solid (wedge sides through the axis) adds the axis.
  const rims = shape.inner === undefined ? [1] : [1, shape.inner]
  return [-0.5, 0.5].flatMap((y) => {
    const r = y > 0 ? 0.5 * shape.topScale : 0.5
    const points = rims.flatMap((scale) =>
      Array.from({ length: partial ? n + 1 : n }, (_, k) => {
        const theta = (arc * k) / n
        return transformPoint(f, [
          scale * r * Math.sin(theta) * shape.size[0],
          y * shape.size[1],
          scale * r * Math.cos(theta) * shape.size[2],
        ])
      }),
    )
    return partial && shape.inner === undefined && !shape.open
      ? [...points, transformPoint(f, [0, y * shape.size[1], 0])]
      : points
  })
}

function movedPoint(point: Vec3, motion: EvaluatedMotion, fraction: number): Vec3 {
  if (motion.kind === 'slide')
    return point.map(
      (value, i) => value + (['x', 'y', 'z'][i] === motion.axis ? motion.amount * fraction : 0),
    ) as Vec3
  const angle = motion.kind === 'spin' ? 2 * Math.PI * fraction : motion.amount * fraction
  const rotation: Vec3 = [0, 0, 0]
  rotation[{ x: 0, y: 1, z: 2 }[motion.axis]] = angle
  const offset = point.map((value, i) => value - motion.pivot[i]!) as Vec3
  return rotateVector(offset, rotation).map((value, i) => value + motion.pivot[i]!) as Vec3
}

const LEGACY_TRIANGLE_CHARGE = { box: 12, roundedBox: 588, cylinder: 96, ellipsoid: 720 } as const
/** A revolve that meets the axis at both ends over a full turn encloses a solid. */
export function revolveIsClosed(shape: Pick<EvaluatedShape, 'profile' | 'arc'>): boolean {
  const profile = shape.profile!
  return (
    profile[0]![0] <= 1e-9 &&
    profile.at(-1)![0] <= 1e-9 &&
    (shape.arc === undefined || shape.arc >= 2 * Math.PI - 1e-9)
  )
}
type RecipeSection = z.infer<typeof section>
/** Triangles of the geometry the renderer builds for an evaluated shape (non-indexed). */
export function shapeTriangles(
  shape: Pick<
    EvaluatedShape,
    | 'primitive'
    | 'topScale'
    | 'segments'
    | 'open'
    | 'inner'
    | 'arc'
    | 'section'
    | 'bevel'
    | 'profile'
  >,
): number {
  switch (shape.primitive) {
    case 'box':
      return 12
    case 'roundedBox':
      return 300 // RoundedBoxGeometry(…, 2): a 5 × 5 grid on each face
    case 'cylinder': {
      // Per side: one torso triangle per nonzero radius, one cap triangle per nonzero radius
      // (two for a tube's ring), plus two triangles per wedge side of a closed partial sweep.
      const n = shape.segments ?? 24,
        ends = shape.topScale > 0 ? 2 : 1
      const wedges = shape.arc !== undefined && shape.arc < 2 * Math.PI - 1e-9 && !shape.open
      // A hollow wall draws its inner face; an open solid draws its back face instead, since
      // materials are front-sided.
      const walls = shape.inner !== undefined || shape.open ? 2 : 1
      const caps = shape.open ? 0 : (shape.inner === undefined ? 1 : 2) * n * ends
      return walls * n * ends + caps + (wedges ? 4 : 0)
    }
    case 'ellipsoid':
      return 720 // SphereGeometry(…, 24, 16) without the degenerate pole triangles
    case 'extrude':
      return extrusionTriangles(sectionRings(shape.section!), shape.bevel ? 2 : 0)
    case 'revolve': {
      // LatheGeometry: two per segment per profile edge; an open surface also draws its back.
      const n = shape.segments ?? 24,
        profile = shape.profile!
      return 2 * n * (profile.length - 1) * (revolveIsClosed(shape) ? 1 : 2)
    }
  }
}
function resolveSection(
  section: RecipeSection,
  value: (e: Expr) => number,
): ResolvedSectionProfile {
  const length = (e: Expr, what: string) => {
    const v = value(e)
    if (!(v >= 0.001 && v <= RECIPE_LIMITS.dimension)) throw new Error(`Invalid section ${what}`)
    return v
  }
  switch (section.kind) {
    case 'rectangle': {
      const width = length(section.width, 'width'),
        depth = length(section.depth, 'depth')
      const corner = section.corner === undefined ? 0 : value(section.corner)
      if (!(corner >= 0 && corner <= Math.min(width, depth) / 2))
        throw new Error('A section corner must be within 0..half its smaller side')
      return corner
        ? { kind: 'rectangle', width, depth, corner }
        : { kind: 'rectangle', width, depth }
    }
    case 'round': {
      const radius = length(section.radius, 'radius')
      const wall = section.wall === undefined ? undefined : value(section.wall)
      if (wall !== undefined && !(wall > 0 && wall < radius))
        throw new Error('A round section wall must be within (0, radius)')
      return wall === undefined ? { kind: 'round', radius } : { kind: 'round', radius, wall }
    }
    case 'oval':
      return {
        kind: 'oval',
        width: length(section.width, 'width'),
        depth: length(section.depth, 'depth'),
      }
    case 'section':
      return {
        kind: 'section',
        family: section.family,
        width: length(section.width, 'width'),
        depth: length(section.depth, 'depth'),
        web: length(section.web, 'web'),
        flange: length(section.flange, 'flange'),
      }
    case 'polygon': {
      const point = ([x, y]: [Expr, Expr]) => {
        const p = [value(x), value(y)] as const
        if (p.some((v) => Math.abs(v) > RECIPE_LIMITS.dimension))
          throw new Error('Invalid section point')
        return p
      }
      return {
        kind: 'polygon',
        outer: section.outer.map(point),
        ...(section.holes && { holes: section.holes.map((hole) => hole.map(point)) }),
      }
    }
  }
}
export function evaluateRecipe(
  recipe: Recipe,
  values: Record<string, number> = {},
  { now = () => performance.now() }: { now?: () => number } = {},
): Evaluation {
  const started = now()
  const inTime = () => {
    if (recipe.version === 2 && now() - started > RECIPE_V2_LIMITS.milliseconds)
      throw new Error(
        `Recipe evaluation exceeded its ${RECIPE_V2_LIMITS.milliseconds} ms time budget`,
      )
  }
  const issue = versionIssue(recipe)
  if (issue) throw new Error(issue)
  const slotColors = new Map<string, string>()
  for (const part of recipe.parts) {
    const light = part.light
    if (!light) continue
    if (
      !/^#[0-9a-fA-F]{6}$/.test(light.color) ||
      (light.intensity !== undefined &&
        (!Number.isFinite(light.intensity) || light.intensity <= 0 || light.intensity > 10)) ||
      (light.distance !== undefined &&
        (!Number.isFinite(light.distance) || light.distance < 0.1 || light.distance > 10))
    )
      throw new Error(`Invalid light for ${part.id}`)
    if (!light.emissiveSlot) continue
    if (!recipe.slots.some((slot) => slot.id === light.emissiveSlot))
      throw new Error(`Unknown emissive slot ${light.emissiveSlot}`)
    const previous = slotColors.get(light.emissiveSlot)
    // v2 checks the lights it actually builds (below), so exclusive variants may differ.
    if (recipe.version === 1 && previous && previous !== light.color.toLowerCase())
      throw new Error(`Conflicting light colors on ${light.emissiveSlot}`)
    slotColors.set(light.emissiveSlot, light.color.toLowerCase())
  }
  if (movingParts(recipe) > RECIPE_LIMITS.motionParts)
    throw new Error(`Recipe exceeds ${RECIPE_LIMITS.motionParts} moving parts`)
  for (const surface of recipe.surfaces ?? [])
    if (surface.part && partMoves(recipe, surface.part))
      throw new Error(`Named surface ${surface.id} cannot belong to moving part ${surface.part}`)
  const parameters: Record<string, number> = Object.create(null)
  for (const key of Object.keys(values))
    if (!recipe.parameters.some((p) => p.id === key)) throw new Error(`Unknown parameter ${key}`)
  for (const p of recipe.parameters) {
    const v = values[p.id] ?? p.default
    if (
      !Number.isFinite(v) ||
      v < p.min ||
      v > p.max ||
      ((p.unit === 'count' || p.unit === 'bool' || p.unit === 'choice') && !Number.isInteger(v))
    )
      throw new Error(`${p.label} must be between ${p.min} and ${p.max}`)
    parameters[p.id] = v
  }
  let work = 0
  const expr = (e: ExprV2, index = 0, depth = 0): number => {
    if (++work > RECIPE_LIMITS.expressions || depth > 16)
      throw new Error('Expression budget exceeded')
    if (typeof e === 'number') return e
    if (typeof e === 'string') {
      if (e === 'index') return index
      if (!Object.hasOwn(parameters, e)) throw new Error(`Unknown expression reference ${e}`)
      return parameters[e]!
    }
    if (e.op === 'select') {
      const i = expr(e.args[0]!, index, depth + 1)
      if (!Number.isInteger(i) || i < 0 || i >= e.args.length - 1)
        throw new Error(`select index ${i} is outside 0..${e.args.length - 2}`)
      return expr(e.args[i + 1]!, index, depth + 1)
    }
    const a = e.args.map((x) => expr(x, index, depth + 1))
    let result: number
    switch (e.op) {
      case 'add':
        result = a.reduce((x, y) => x + y)
        break
      case 'sub':
        result = a.reduce((x, y) => x - y)
        break
      case 'mul':
        result = a.reduce((x, y) => x * y)
        break
      case 'div':
        result = a.reduce((x, y) => x / y)
        break
      case 'floor':
        result = Math.floor(a[0]!)
        break
      case 'ceil':
        result = Math.ceil(a[0]!)
        break
      case 'round':
        result = Math.round(a[0]!)
        break
      case 'abs':
        result = Math.abs(a[0]!)
        break
      case 'sin':
        result = Math.sin(a[0]!)
        break
      case 'cos':
        result = Math.cos(a[0]!)
        break
      case 'mod': {
        const divisor = a[1]!
        if (divisor <= 0) throw new Error('Modulo divisor must be positive')
        const remainder = a[0]! % divisor
        result = remainder < 0 ? remainder + divisor : remainder === 0 ? 0 : remainder
        break
      }
      case 'min':
        result = Math.min(...a)
        break
      case 'max':
        result = Math.max(...a)
        break
      default:
        throw new Error('Unsupported operation')
    }
    if (!Number.isFinite(result) || Math.abs(result) > 10000)
      throw new Error('Invalid expression result')
    return result
  }
  for (const c of recipe.constraints) {
    const a = expr(c.left),
      b = expr(c.right)
    if (c.relation === 'lte' ? a > b + 1e-8 : a < b - 1e-8) throw new Error(c.message)
  }
  // The datum that rests on the host: design y = 0, or a v2 floor design's declared base.
  // v2 ceiling designs hang from their top reference; their host bounds them against the floor.
  const base = recipe.version === 2 && recipe.base !== undefined ? expr(recipe.base) : 0
  const hangsFromCeiling = recipe.version === 2 && recipe.mounting?.attachTo === 'ceiling'
  const shapes: EvaluatedShape[] = [],
    motions: EvaluatedMotion[] = [],
    lights: EvaluatedLight[] = [],
    surfaces: Surface[] = []
  const motionGroupByInstance: Record<string, string> = Object.create(null)
  const motionSignatures = new Map<string, string>()
  const min: Vec3 = [Infinity, Infinity, Infinity],
    max: Vec3 = [-Infinity, -Infinity, -Infinity]
  let triangles = 0,
    charged = 0
  const shapeLimit = recipe.version === 2 ? RECIPE_V2_LIMITS.shapes : RECIPE_LIMITS.shapes
  const placements = recipe.version === 2 && usesPartTree(recipe) ? placeParts(recipe, expr) : null
  const jointGroups = new Set<string>()
  for (const part of recipe.parts) {
    inTime()
    const count = expr(part.count)
    if (!Number.isInteger(count) || count < 0 || count > 64)
      throw new Error(`Invalid repeat count for ${part.label}`)
    for (let i = 0; i < count; i++) {
      if (part.when !== undefined && expr(part.when, i) === 0) continue
      // `when` is settled before any group or light is allocated, so a repeat whose shapes
      // are all skipped leaves nothing behind.
      const kept = part.shapes.filter((s) => s.when === undefined || expr(s.when, i) !== 0)
      if (!kept.length) continue
      const placement = placements?.get(`${part.id}:${i}`)
      if (placements && !placement) continue
      // A part-tree pose re-expresses the part's frame in design space.
      const pose = placement?.pose ?? IDENTITY_POSE
      const place = (position: Vec3, rotation: Vec3) => {
        if (pose === IDENTITY_POSE) return { position, rotation }
        const placed = composePoses(pose, eulerPose(position, rotation))
        return { position: placed.t, rotation: matrixEuler(placed.r) }
      }
      const vec = (v: Expr[]): Vec3 => v.map((x) => expr(x, i)) as Vec3
      const instanceMin: Vec3 = [Infinity, Infinity, Infinity]
      const instanceMax: Vec3 = [-Infinity, -Infinity, -Infinity]
      let motionGroup: string | undefined = placement?.group
      if (placement?.motion) {
        if (motions.length >= RECIPE_LIMITS.motionGroups)
          throw new Error(`Recipe exceeds ${RECIPE_LIMITS.motionGroups} evaluated motion groups`)
        motions.push(placement.motion)
        jointGroups.add(placement.motion.id)
        motionGroupByInstance[`${part.id}:${i}`] = placement.motion.id
      }
      if (part.motion) {
        const motion = part.motion
        const pivot: Vec3 = motion.kind === 'slide' ? [0, 0, 0] : vec(motion.pivot)
        const amount = expr(
          motion.kind === 'hinge'
            ? motion.angle
            : motion.kind === 'slide'
              ? motion.distance
              : motion.radiansPerSecond,
          i,
        )
        const limit = motion.kind === 'hinge' ? Math.PI : motion.kind === 'slide' ? 5 : 20
        if (Math.abs(amount) <= 0 || Math.abs(amount) > limit)
          throw new Error(
            `Invalid ${motion.kind} amount for ${part.id}: expected 0 < absolute value <= ${limit}`,
          )
        const rounded = (n: number) => Math.round(n * 1e6) / 1e6
        const delay = motion.kind === 'spin' ? 0 : expr(motion.delay ?? 0, i)
        const duration = motion.kind === 'spin' ? 0 : expr(motion.duration ?? 0.45, i)
        const easing = motion.kind === 'spin' ? 'linear' : (motion.easing ?? 'smooth')
        if (
          !Number.isFinite(delay) ||
          !Number.isFinite(duration) ||
          delay < 0 ||
          delay > 1 ||
          !['linear', 'smooth', 'soft'].includes(easing) ||
          (motion.kind !== 'spin' && (duration < 0.1 || duration > 2))
        )
          throw new Error(`Invalid timing for ${part.id}`)
        const signature = JSON.stringify([
          part.id,
          motion.kind,
          motion.axis,
          ...pivot.map(rounded),
          rounded(amount),
          delay,
          duration,
          easing,
        ])
        // A part gated by `when` names groups by repeat index, so skipped repeats never
        // renumber the survivors.
        const gated =
          part.when !== undefined || part.shapes.some((shape) => shape.when !== undefined)
        motionGroup = gated ? undefined : motionSignatures.get(signature)
        if (!motionGroup) {
          if (motions.length >= RECIPE_LIMITS.motionGroups)
            throw new Error(`Recipe exceeds ${RECIPE_LIMITS.motionGroups} evaluated motion groups`)
          const ordinal = gated ? i : motions.filter((m) => m.partId === part.id).length
          motionGroup = ordinal ? `${part.id}~${ordinal}` : part.id
          motionSignatures.set(signature, motionGroup)
          motions.push({
            id: motionGroup,
            partId: part.id,
            kind: motion.kind,
            axis: motion.axis,
            pivot,
            amount,
            delay,
            duration,
            easing,
          })
        }
        motionGroupByInstance[`${part.id}:${i}`] = motionGroup
      }
      for (const s of kept) {
        if (shapes.length >= shapeLimit) throw new Error('Expanded shape budget exceeded')
        inTime()
        let position = vec(s.position)
        let rotation = vec(s.rotation ?? [0, 0, 0])
        let size: Vec3
        let extrusion: Pick<EvaluatedShape, 'section' | 'bevel' | 'profile'> = {}
        if (s.primitive === 'revolve') {
          // Points that coincide with the previous one (a feature collapsed to zero) are dropped.
          const points: [number, number][] = []
          for (const [re, ye] of s.profile) {
            const [r, y] = [expr(re, i), expr(ye, i)]
            if (
              !(
                r >= 0 &&
                r <= RECIPE_LIMITS.dimension / 2 &&
                Math.abs(y) <= RECIPE_LIMITS.dimension
              )
            )
              throw new Error(`Invalid revolve profile for ${part.id}/${s.id}`)
            const last = points.at(-1)
            if (!last || Math.hypot(r - last[0], y - last[1]) > 1e-6) points.push([r, y])
          }
          if (points.length < 2) throw new Error(`Invalid revolve profile for ${part.id}/${s.id}`)
          const radius = Math.max(...points.map(([r]) => r))
          const low = Math.min(...points.map(([, y]) => y)),
            high = Math.max(...points.map(([, y]) => y))
          size = [2 * radius, high - low, 2 * radius]
          const middle = (low + high) / 2
          position = position.map((v, k) => v + rotateVector([0, middle, 0], rotation)[k]!) as Vec3
          extrusion = { profile: points.map(([r, y]) => [r, y - middle]) }
          if (!(size[0] >= 0.001))
            throw new Error(`Revolve profile for ${part.id}/${s.id} needs a radius`)
        } else if (s.primitive === 'extrude') {
          const resolved = resolveSection(s.section, (e) => expr(e, i))
          const rings = sectionRings(resolved)
          const b = boundsOf(rings.outer.map(([x, y]) => [x, y, 0] as Vec3))
          const center = b.min.map((v, k) => (v + b.max[k]!) / 2) as Vec3
          const length = expr(s.length, i)
          const bevel = s.bevel === undefined ? 0 : expr(s.bevel, i)
          // The bevel insets every contour, so it must stay under the section's thinnest wall.
          if (
            !(
              bevel >= 0 &&
              bevel <= Math.min(length / 4, 0.05) &&
              (bevel === 0 || bevel <= sectionThickness(rings) / 2.5 + 1e-9)
            )
          )
            throw new Error(
              `bevel for ${part.id}/${s.id} must be within 0..min(length / 4, 5 cm, thinnest wall / 2.5)`,
            )
          size = [b.dimensions[0], b.dimensions[1], length]
          // Evaluated shapes are centred in their box, so bounds and handles read them as boxes.
          position = position.map((v, k) => v + rotateVector(center, rotation)[k]!) as Vec3
          extrusion = {
            section:
              resolved.kind === 'polygon'
                ? {
                    kind: 'polygon',
                    outer: resolved.outer.map(([x, y]) => [x - center[0], y - center[1]] as const),
                    ...(resolved.holes && {
                      holes: resolved.holes.map((hole) =>
                        hole.map(([x, y]) => [x - center[0], y - center[1]] as const),
                      ),
                    }),
                  }
                : resolved,
            ...(bevel > 0 && { bevel }),
          }
        } else size = vec(s.size)
        const f = solidFields(s)
        if (size.some((x) => x < 0.001 || x > RECIPE_LIMITS.dimension))
          throw new Error(`Invalid dimensions for ${part.id}/${s.id}`)
        const radius = s.primitive === 'roundedBox' ? expr(f.radius ?? 0.02, i) : 0
        if (radius < 0 || radius > Math.min(...size) / 2)
          throw new Error(`Invalid rounding for ${s.id}`)
        if (f.topScale !== undefined && s.primitive !== 'cylinder')
          throw new Error(`topScale is only allowed on cylinders (${part.id}/${s.id})`)
        const topScale = f.topScale === undefined ? 1 : expr(f.topScale, i)
        if (topScale < 0 || topScale > 1)
          throw new Error(`topScale for ${part.id}/${s.id} must be within [0, 1]`)
        if (s.support && (s.primitive === 'ellipsoid' || topScale < 1))
          throw new Error(
            `Support surface ${part.id}/${s.id} cannot be ellipsoid or tapered cylinder`,
          )
        if (s.support && motionGroup)
          throw new Error(`Moving part ${part.id} cannot contain support shapes`)
        const inner = f.inner === undefined ? undefined : expr(f.inner, i)
        if (inner !== undefined && !(inner > 0 && inner < 1))
          throw new Error(`inner for ${part.id}/${s.id} must be within (0, 1)`)
        const arc = f.arc === undefined ? undefined : expr(f.arc, i)
        if (arc !== undefined && !(arc > 0 && arc <= 2 * Math.PI + 1e-9))
          throw new Error(`arc for ${part.id}/${s.id} must be within (0, 2π]`)
        ;({ position, rotation } = place(position, rotation))
        const shapeId = `${part.id}:${i}:${s.id}`
        shapes.push({
          id: shapeId,
          partId: part.id,
          primitive: s.primitive,
          slot: s.slot,
          size,
          position,
          rotation,
          radius,
          topScale,
          ...(f.segments === undefined ? {} : { segments: f.segments }),
          ...(f.open ? { open: true } : {}),
          ...(inner === undefined ? {} : { inner }),
          ...(arc === undefined ? {} : { arc }),
          ...extrusion,
          motionGroup,
        })
        const built = shapeTriangles(shapes.at(-1)!)
        triangles += built
        // v1 keeps its original, conservative charges so its acceptance never changes.
        charged +=
          recipe.version === 1
            ? LEGACY_TRIANGLE_CHARGE[s.primitive as keyof typeof LEGACY_TRIANGLE_CHARGE]
            : built
        if (charged > RECIPE_LIMITS.triangles) throw new Error('Triangle budget exceeded')
        if (s.primitive === 'ellipsoid') {
          const axes = [0, 1, 2].map((axis) =>
            rotateVector([0, 1, 2].map((j) => (j === axis ? 1 : 0)) as Vec3, rotation),
          )
          for (let k = 0; k < 3; k++) {
            const extent = Math.hypot(...axes.map((axis, j) => (axis[k]! * size[j]!) / 2))
            min[k] = Math.min(min[k]!, position[k]! - extent)
            max[k] = Math.max(max[k]!, position[k]! + extent)
            instanceMin[k] = Math.min(instanceMin[k]!, position[k]! - extent)
            instanceMax[k] = Math.max(instanceMax[k]!, position[k]! + extent)
          }
        } else {
          for (const point of shapeCorners(size, position, rotation))
            for (let k = 0; k < 3; k++) {
              min[k] = Math.min(min[k]!, point[k]!)
              max[k] = Math.max(max[k]!, point[k]!)
              instanceMin[k] = Math.min(instanceMin[k]!, point[k]!)
              instanceMax[k] = Math.max(instanceMax[k]!, point[k]!)
            }
        }
        if (s.support) {
          if (surfaces.length >= 256) throw new Error('Surface budget exceeded')
          if (rotation.some((v) => v !== 0))
            throw new Error('Support surfaces must be horizontal and unrotated in v1')
          surfaces.push({
            id: `${shapeId}:top`,
            label: part.label,
            rotation: [0, 0, 0],
            normal: [0, 1, 0],
            position: [position[0], position[1] + size[1] / 2, position[2]],
            size: [size[0], size[2]],
          })
        }
      }
      // A repeat whose shapes `when` all skipped builds no light either.
      if (part.light && instanceMin[0] !== Infinity) {
        if (lights.length >= RECIPE_LIMITS.lights)
          throw new Error('Evaluated light budget exceeded')
        const position =
          pose === IDENTITY_POSE
            ? vec(part.light.position)
            : posePoint(pose, vec(part.light.position))
        if (position.some((value) => !Number.isFinite(value)))
          throw new Error(`Invalid light position for ${part.id}`)
        if (
          position.some(
            (value, axis) => value < instanceMin[axis]! - 0.02 || value > instanceMax[axis]! + 0.02,
          )
        )
          throw new Error(`Light for ${part.id}:${i} is outside its resting bounds`)
        lights.push({
          id: `${part.id}:${i}`,
          partId: part.id,
          index: i,
          motionGroup,
          position,
          color: part.light.color,
          intensity: part.light.intensity ?? 2,
          distance: part.light.distance ?? 5,
          emissiveSlot: part.light.emissiveSlot,
        })
      }
    }
  }
  for (const surface of recipe.surfaces ?? []) {
    const part = recipe.parts.find((p) => p.id === surface.part)
    const count = part ? expr(part.count) : 1
    for (let i = 0; i < count; i++) {
      if (part?.when !== undefined && expr(part.when, i) === 0) continue
      if (surfaces.length >= 256) throw new Error('Surface budget exceeded')
      const rotation = (surface.rotation ?? [0, 0, 0]).map((e) => expr(e, i)) as Vec3
      const size = surface.size.map((e) => expr(e, i)) as [number, number]
      const position = surface.position.map((e) => expr(e, i)) as Vec3
      // Bounded where consumers read it: design space with the resting datum at y = 0.
      if (
        size.some((v) => v < 0.001 || v > 30) ||
        position.some((v, k) => Math.abs(k === 1 ? v - base : v) > 30)
      )
        throw new Error('Invalid surface region')
      surfaces.push({
        id: part ? `${surface.id}:${i}` : surface.id,
        label: part ? `${surface.label} ${i + 1}` : surface.label,
        position,
        rotation,
        normal: rotateVector([0, 1, 0], rotation),
        size,
      })
    }
  }
  const cuts: EvaluatedCut[] = []
  // Recessed designs: whether a design-space [x, z] lies inside one of their cuts.
  let insideCut: ((x: number, z: number) => boolean) | null = null
  if (recipe.mounting) {
    const reference = surfaces.find((s) => s.id === recipe.mounting!.reference)
    if (!reference || reference.id.includes(':')) throw new Error('Missing mounting reference')
    if (recipe.mounting.attachTo === 'ceiling') {
      if (Math.abs(reference.normal[1] - 1) > 1e-6)
        throw new Error('Ceiling mounting reference must face local +Y')
      const recessed = recipe.version === 2 && recipe.cuts !== undefined
      if (
        recessed
          ? reference.position[1] > max[1] + 1e-6
          : Math.abs(reference.position[1] - max[1]) > 1e-6
      )
        throw new Error('Ceiling mounting reference must lie at the top of the design')
      if (recessed) {
        const u = rotateVector([1, 0, 0], reference.rotation),
          v = rotateVector([0, 0, 1], reference.rotation)
        const inside: ((x: number, z: number) => boolean)[] = []
        for (const c of recipe.cuts!) {
          const [cu, cv] = (c.center ?? [0, 0]).map((e) => expr(e)) as [number, number]
          const cx = reference.position[0] + u[0] * cu + v[0] * cv,
            cz = reference.position[2] + u[2] * cu + v[2] * cv
          const half =
            c.shape === 'rect'
              ? (c.size.map((e) => expr(e) / 2) as [number, number])
              : ([expr(c.diameter) / 2, expr(c.diameter) / 2] as [number, number])
          if (half.some((h) => !(h >= 0.005 && h <= 15))) throw new Error('Invalid cut size')
          const local: [number, number][] =
            c.shape === 'rect'
              ? [
                  [-half[0], -half[1]],
                  [half[0], -half[1]],
                  [half[0], half[1]],
                  [-half[0], half[1]],
                ]
              : Array.from({ length: 32 }, (_, k) => [
                  half[0] * Math.cos((k * Math.PI) / 16),
                  half[0] * Math.sin((k * Math.PI) / 16),
                ])
          cuts.push({
            host: 'ceiling',
            ring: local.map(([a, b]) => [cx + u[0] * a + v[0] * b, cz + u[2] * a + v[2] * b]),
          })
          inside.push((x, z) => {
            const a = (x - cx) * u[0] + (z - cz) * u[2],
              b = (x - cx) * v[0] + (z - cz) * v[2]
            return c.shape === 'rect'
              ? Math.abs(a) <= half[0] + 1e-6 && Math.abs(b) <= half[1] + 1e-6
              : Math.hypot(a, b) <= half[0] + 1e-6
          })
        }
        for (const shape of shapes) {
          if (shapeBounds(shape).max[1] <= reference.position[1] + 1e-6) continue
          const footprint = shapeFootprint(shape)
          if (!inside.some((test) => footprint.every(([x, , z]) => test(x, z))))
            throw new Error(`${shape.partId} rises above the ceiling reference outside its cut`)
        }
        insideCut = (x, z) => inside.some((test) => test(x, z))
      }
    } else if (Math.abs(reference.normal[2] + 1) > 1e-6)
      throw new Error('Wall-side mounting reference must face local -Z')
  }
  const reference = recipe.mounting && surfaces.find((s) => s.id === recipe.mounting!.reference)
  const reach = insideCut ? { min: [...min] as Vec3, max: [...max] as Vec3 } : undefined
  for (const { motion, bounds } of jointReach(
    motions.filter((m) => jointGroups.has(m.id)),
    shapes,
    shapeBounds,
  )) {
    if (!recipe.mounting && bounds.min[1] < base - 0.001)
      throw new Error(`Motion envelope for ${motion.partId} extends below the floor`)
    if (
      recipe.mounting?.attachTo === 'wall-side' &&
      reference &&
      bounds.min[2] < reference.position[2] - 0.001
    )
      throw new Error(`Motion envelope for ${motion.partId} crosses behind the wall reference`)
    if (
      recipe.mounting?.attachTo === 'ceiling' &&
      reference &&
      bounds.max[1] > reference.position[1] + 0.001
    )
      throw new Error(`Motion envelope for ${motion.partId} rises above the ceiling reference`)
  }
  for (const shape of shapes) {
    if (!shape.motionGroup || jointGroups.has(shape.motionGroup)) continue
    const motion = motions.find((m) => m.id === shape.motionGroup)!
    const steps = motion.kind === 'slide' ? 1 : motion.kind === 'hinge' ? 8 : 16
    // Inside a cut, sample the rendered footprint so round parts may turn in round cuts.
    const points = insideCut
      ? shapeFootprint(shape)
      : shapeCorners(shape.size, shape.position, shape.rotation)
    for (const corner of points)
      for (let step = 0; step <= steps; step++) {
        const point = movedPoint(corner, motion, step / steps)
        if (reach)
          for (let k = 0; k < 3; k++) {
            reach.min[k] = Math.min(reach.min[k]!, point[k]!)
            reach.max[k] = Math.max(reach.max[k]!, point[k]!)
          }
        if (!recipe.mounting && point[1] < base - 0.001)
          throw new Error(`Motion envelope for ${shape.partId} extends below the floor`)
        if (
          recipe.mounting?.attachTo === 'wall-side' &&
          reference &&
          point[2] < reference.position[2] - 0.001
        )
          throw new Error(`Motion envelope for ${shape.partId} crosses behind the wall reference`)
        if (
          recipe.mounting?.attachTo === 'ceiling' &&
          reference &&
          point[1] > reference.position[1] + 0.001 &&
          !insideCut?.(point[0], point[2])
        )
          throw new Error(`Motion envelope for ${shape.partId} rises above the ceiling reference`)
      }
  }
  if (!shapes.length) throw new Error('The item must contain geometry')
  const emitted = new Map<string, string>()
  for (const light of lights) {
    if (!light.emissiveSlot) continue
    const previous = emitted.get(light.emissiveSlot)
    if (previous && previous !== light.color.toLowerCase())
      throw new Error(`Conflicting light colors on ${light.emissiveSlot}`)
    emitted.set(light.emissiveSlot, light.color.toLowerCase())
  }
  if (base !== 0) {
    // Consumers keep reading design space with the resting datum at y = 0.
    const lower = (point: Vec3): Vec3 => [point[0], point[1] - base, point[2]]
    for (const shape of shapes) shape.position = lower(shape.position)
    for (const light of lights) light.position = lower(light.position)
    for (const surface of surfaces) surface.position = lower(surface.position)
    // A slide's pivot is the origin of its group, not a point of the design.
    for (const motion of motions) if (motion.kind !== 'slide') motion.pivot = lower(motion.pivot)
    min[1] -= base
    max[1] -= base
  }
  const dimensions = max.map((x, i) => x - min[i]!) as Vec3
  if (dimensions.some((x) => x > 30) || [...min, ...max].some((x) => Math.abs(x) > 30))
    throw new Error('Item exceeds 30 m bounds')
  if (!hangsFromCeiling && min[1] < -0.001)
    throw new Error(
      recipe.base === undefined
        ? 'Geometry extends below the ground; base must be at y=0'
        : 'Geometry extends below the declared base',
    )
  return {
    shapes,
    motions,
    lights,
    motionGroupByInstance,
    surfaces,
    cuts,
    min,
    max,
    dimensions,
    parameters,
    triangles,
    ...(reach && motions.length > 0 && { reach }),
  }
}

export const EASINGS = {
  linear: (u: number) => u,
  smooth: (u: number) => 3 * u * u - 2 * u * u * u,
  soft: (u: number) => 6 * u ** 5 - 15 * u ** 4 + 10 * u ** 3,
}

export function finitePoseFraction(motion: EvaluatedMotion, time: number): number {
  const u = Math.max(0, Math.min(1, (time - motion.delay) / motion.duration))
  return EASINGS[motion.easing](u)
}

export function motionTimeline(evaluation: Pick<Evaluation, 'motions'>): {
  T: number
  perPart: Record<string, { A: number; B: number }>
} {
  const perPart: Record<string, { A: number; B: number }> = Object.create(null)
  let T = 0
  for (const motion of evaluation.motions) {
    if (motion.kind === 'spin') continue
    const end = motion.delay + motion.duration
    T = Math.max(T, end)
    const part = perPart[motion.partId]
    perPart[motion.partId] = {
      A: Math.min(part?.A ?? Infinity, motion.delay),
      B: Math.max(part?.B ?? 0, end),
    }
  }
  return { T, perPart }
}

export function sweepRecipe(recipe: Recipe) {
  const cases: Record<string, number>[] = [{}]
  for (const p of recipe.parameters) cases.push({ [p.id]: p.min }, { [p.id]: p.max })
  let seed = 731
  for (let i = 0; i < 20; i++) {
    const values: Record<string, number> = {}
    for (const p of recipe.parameters) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      const n = Math.floor((p.max - p.min) / p.step)
      values[p.id] = Math.min(p.max, p.min + Math.floor((seed / 4294967296) * (n + 1)) * p.step)
    }
    cases.push(values)
  }
  return cases.map((values, index) => {
    try {
      evaluateRecipe(recipe, values)
      return { index, values, valid: true, error: null }
    } catch (error) {
      return {
        index,
        values,
        valid: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  })
}
