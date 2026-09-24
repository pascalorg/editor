import { z } from 'zod'
import { boxCorners, frame, rotateVector, transformPoint } from './spatial'

export type Expr =
  | number
  | string
  | { op: 'add' | 'sub' | 'mul' | 'div' | 'min' | 'max'; args: Expr[] }
  | { op: 'floor' | 'ceil' | 'round' | 'abs' | 'sin' | 'cos'; args: [Expr] }
  | { op: 'mod'; args: [Expr, Expr] }
export type Vec3 = [number, number, number]
const id = z.string().regex(/^[a-z][a-z0-9_]{0,47}$/)
const finite = z.number().finite().min(-1000).max(1000)
const expression: z.ZodType<Expr> = z.lazy(() =>
  z.union([
    finite,
    id,
    z.strictObject({
      op: z.enum(['add', 'sub', 'mul', 'div', 'min', 'max']),
      args: z.array(expression).min(2).max(8),
    }),
    z.strictObject({
      op: z.enum(['floor', 'ceil', 'round', 'abs', 'sin', 'cos']),
      args: z.tuple([expression]),
    }),
    z.strictObject({
      op: z.literal('mod'),
      args: z.tuple([expression, expression]),
    }),
  ]),
)
const vector = z.tuple([expression, expression, expression])
const timing = {
  delay: expression.optional(),
  duration: expression.optional(),
  easing: z.enum(['linear', 'smooth', 'soft']).optional(),
}
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
export const RecipeSchema = z.strictObject({
  version: z.literal(1),
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
        unit: z.enum(['m', 'count', 'rad', 's']),
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
          .array(
            z.strictObject({
              id,
              primitive: z.enum(['box', 'roundedBox', 'cylinder', 'ellipsoid']),
              slot: id,
              size: vector,
              position: vector,
              rotation: vector.optional(),
              radius: expression.optional(),
              topScale: expression.optional(),
              support: z.boolean().optional(),
            }),
          )
          .min(1)
          .max(24),
      }),
    )
    .min(1)
    .max(16),
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
export type Recipe = z.infer<typeof RecipeSchema>
export type EvaluatedShape = {
  id: string
  partId: string
  primitive: 'box' | 'roundedBox' | 'cylinder' | 'ellipsoid'
  slot: string
  size: Vec3
  position: Vec3
  rotation: Vec3
  radius: number
  topScale: number
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
  min: Vec3
  max: Vec3
  dimensions: Vec3
  parameters: Record<string, number>
  triangles: number
}
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
export function parseRecipe(input: unknown): Recipe {
  guardTree(input)
  if (JSON.stringify(input).length > RECIPE_LIMITS.bytes) throw new Error('Recipe is too large')
  const recipe = RecipeSchema.parse(input)
  for (const list of [recipe.parameters, recipe.slots, recipe.parts]) {
    if (new Set(list.map((x) => x.id)).size !== list.length)
      throw new Error('IDs must be unique within each section')
  }
  for (const p of recipe.parameters) {
    if (p.id === 'index' || p.min > p.max || p.default < p.min || p.default > p.max)
      throw new Error(`Invalid parameter ${p.id}`)
    if (p.unit === 'count' && ![p.min, p.max, p.default, p.step].every(Number.isInteger))
      throw new Error(`Count ${p.id} must be integral`)
    if (p.part && !recipe.parts.some((part) => part.id === p.part))
      throw new Error(`Unknown part ${p.part}`)
  }
  for (const part of recipe.parts) {
    if (new Set(part.shapes.map((s) => s.id)).size !== part.shapes.length)
      throw new Error(`Duplicate shape in ${part.id}`)
    for (const shape of part.shapes) {
      if (!recipe.slots.some((s) => s.id === shape.slot))
        throw new Error(`Unknown slot ${shape.slot}`)
      if (shape.topScale !== undefined && shape.primitive !== 'cylinder')
        throw new Error(`topScale is only allowed on cylinders (${part.id}/${shape.id})`)
      if (part.motion && shape.support)
        throw new Error(`Moving part ${part.id} cannot contain support shapes`)
      if (shape.primitive === 'ellipsoid' && shape.support)
        throw new Error(`Ellipsoid ${part.id}/${shape.id} cannot be a support surface`)
    }
  }
  if (recipe.parts.filter((part) => part.motion).length > RECIPE_LIMITS.motionParts)
    throw new Error(`Recipe exceeds ${RECIPE_LIMITS.motionParts} moving parts`)
  const surfaceIds = (recipe.surfaces ?? []).map((s) => s.id)
  if (new Set(surfaceIds).size !== surfaceIds.length) throw new Error('Duplicate surface ID')
  for (const surface of recipe.surfaces ?? []) {
    if (surface.part && !recipe.parts.some((p) => p.id === surface.part))
      throw new Error('Unknown surface part')
    if (surface.part && recipe.parts.some((p) => p.id === surface.part && p.motion))
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

export function evaluateRecipe(recipe: Recipe, values: Record<string, number> = {}): Evaluation {
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
    if (previous && previous !== light.color.toLowerCase())
      throw new Error(`Conflicting light colors on ${light.emissiveSlot}`)
    slotColors.set(light.emissiveSlot, light.color.toLowerCase())
  }
  if (recipe.parts.filter((part) => part.motion).length > RECIPE_LIMITS.motionParts)
    throw new Error(`Recipe exceeds ${RECIPE_LIMITS.motionParts} moving parts`)
  for (const surface of recipe.surfaces ?? [])
    if (surface.part && recipe.parts.some((part) => part.id === surface.part && part.motion))
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
      (p.unit === 'count' && !Number.isInteger(v))
    )
      throw new Error(`${p.label} must be between ${p.min} and ${p.max}`)
    parameters[p.id] = v
  }
  let work = 0
  const expr = (e: Expr, index = 0, depth = 0): number => {
    if (++work > RECIPE_LIMITS.expressions || depth > 16)
      throw new Error('Expression budget exceeded')
    if (typeof e === 'number') return e
    if (typeof e === 'string') {
      if (e === 'index') return index
      if (!Object.hasOwn(parameters, e)) throw new Error(`Unknown expression reference ${e}`)
      return parameters[e]!
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
  const shapes: EvaluatedShape[] = [],
    motions: EvaluatedMotion[] = [],
    lights: EvaluatedLight[] = [],
    surfaces: Surface[] = []
  const motionGroupByInstance: Record<string, string> = Object.create(null)
  const motionSignatures = new Map<string, string>()
  const min: Vec3 = [Infinity, Infinity, Infinity],
    max: Vec3 = [-Infinity, -Infinity, -Infinity]
  let triangles = 0
  for (const part of recipe.parts) {
    const count = expr(part.count)
    if (!Number.isInteger(count) || count < 0 || count > 64)
      throw new Error(`Invalid repeat count for ${part.label}`)
    for (let i = 0; i < count; i++) {
      const vec = (v: Expr[]): Vec3 => v.map((x) => expr(x, i)) as Vec3
      const instanceMin: Vec3 = [Infinity, Infinity, Infinity]
      const instanceMax: Vec3 = [-Infinity, -Infinity, -Infinity]
      let motionGroup: string | undefined
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
        motionGroup = motionSignatures.get(signature)
        if (!motionGroup) {
          if (motions.length >= RECIPE_LIMITS.motionGroups)
            throw new Error(`Recipe exceeds ${RECIPE_LIMITS.motionGroups} evaluated motion groups`)
          const ordinal = motions.filter((m) => m.partId === part.id).length
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
      for (const s of part.shapes) {
        if (shapes.length >= RECIPE_LIMITS.shapes) throw new Error('Expanded shape budget exceeded')
        const size = vec(s.size),
          position = vec(s.position),
          rotation = vec(s.rotation ?? [0, 0, 0])
        if (size.some((x) => x < 0.001 || x > RECIPE_LIMITS.dimension))
          throw new Error(`Invalid dimensions for ${part.id}/${s.id}`)
        const radius = s.primitive === 'roundedBox' ? expr(s.radius ?? 0.02, i) : 0
        if (radius < 0 || radius > Math.min(...size) / 2)
          throw new Error(`Invalid rounding for ${s.id}`)
        if (s.topScale !== undefined && s.primitive !== 'cylinder')
          throw new Error(`topScale is only allowed on cylinders (${part.id}/${s.id})`)
        const topScale = s.topScale === undefined ? 1 : expr(s.topScale, i)
        if (topScale < 0 || topScale > 1)
          throw new Error(`topScale for ${part.id}/${s.id} must be within [0, 1]`)
        if (s.support && (s.primitive === 'ellipsoid' || topScale < 1))
          throw new Error(
            `Support surface ${part.id}/${s.id} cannot be ellipsoid or tapered cylinder`,
          )
        if (s.support && motionGroup)
          throw new Error(`Moving part ${part.id} cannot contain support shapes`)
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
          motionGroup,
        })
        triangles +=
          s.primitive === 'roundedBox'
            ? 588
            : s.primitive === 'cylinder'
              ? 96
              : s.primitive === 'ellipsoid'
                ? 720
                : 12
        if (triangles > RECIPE_LIMITS.triangles) throw new Error('Triangle budget exceeded')
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
      if (part.light) {
        if (lights.length >= RECIPE_LIMITS.lights)
          throw new Error('Evaluated light budget exceeded')
        const position = vec(part.light.position)
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
      if (surfaces.length >= 256) throw new Error('Surface budget exceeded')
      const rotation = (surface.rotation ?? [0, 0, 0]).map((e) => expr(e, i)) as Vec3
      const size = surface.size.map((e) => expr(e, i)) as [number, number]
      const position = surface.position.map((e) => expr(e, i)) as Vec3
      if (size.some((v) => v < 0.001 || v > 30) || position.some((v) => Math.abs(v) > 30))
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
  if (recipe.mounting) {
    const reference = surfaces.find((s) => s.id === recipe.mounting!.reference)
    if (!reference || reference.id.includes(':')) throw new Error('Missing mounting reference')
    if (recipe.mounting.attachTo === 'ceiling') {
      if (Math.abs(reference.normal[1] - 1) > 1e-6)
        throw new Error('Ceiling mounting reference must face local +Y')
      if (Math.abs(reference.position[1] - max[1]) > 1e-6)
        throw new Error('Ceiling mounting reference must lie at the top of the design')
    } else if (Math.abs(reference.normal[2] + 1) > 1e-6)
      throw new Error('Wall-side mounting reference must face local -Z')
  }
  const reference = recipe.mounting && surfaces.find((s) => s.id === recipe.mounting!.reference)
  for (const shape of shapes) {
    if (!shape.motionGroup) continue
    const motion = motions.find((m) => m.id === shape.motionGroup)!
    const steps = motion.kind === 'slide' ? 1 : motion.kind === 'hinge' ? 8 : 16
    for (const corner of shapeCorners(shape.size, shape.position, shape.rotation))
      for (let step = 0; step <= steps; step++) {
        const point = movedPoint(corner, motion, step / steps)
        if (!recipe.mounting && point[1] < -0.001)
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
          point[1] > reference.position[1] + 0.001
        )
          throw new Error(`Motion envelope for ${shape.partId} rises above the ceiling reference`)
      }
  }
  if (!shapes.length) throw new Error('The item must contain geometry')
  const dimensions = max.map((x, i) => x - min[i]!) as Vec3
  if (dimensions.some((x) => x > 30) || [...min, ...max].some((x) => Math.abs(x) > 30))
    throw new Error('Item exceeds 30 m bounds')
  if (min[1] < -0.001) throw new Error('Geometry extends below the ground; base must be at y=0')
  return {
    shapes,
    motions,
    lights,
    motionGroupByInstance,
    surfaces,
    min,
    max,
    dimensions,
    parameters,
    triangles,
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
