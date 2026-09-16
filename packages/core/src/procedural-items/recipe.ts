import { z } from 'zod'
import { rotateVector } from './spatial'

export type Expr =
  | number
  | string
  | { op: 'add' | 'sub' | 'mul' | 'div' | 'min' | 'max'; args: Expr[] }
  | { op: 'floor' | 'ceil' | 'round' | 'abs'; args: [Expr] }
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
      op: z.enum(['floor', 'ceil', 'round', 'abs']),
      args: z.tuple([expression]),
    }),
    z.strictObject({
      op: z.literal('mod'),
      args: z.tuple([expression, expression]),
    }),
  ]),
)
const vector = z.tuple([expression, expression, expression])
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
        unit: z.enum(['m', 'count', 'rad']),
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
        shapes: z
          .array(
            z.strictObject({
              id,
              primitive: z.enum(['box', 'roundedBox', 'cylinder']),
              slot: id,
              size: vector,
              position: vector,
              rotation: vector.optional(),
              radius: expression.optional(),
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
  primitive: 'box' | 'roundedBox' | 'cylinder'
  slot: string
  size: Vec3
  position: Vec3
  rotation: Vec3
  radius: number
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
    for (const shape of part.shapes)
      if (!recipe.slots.some((s) => s.id === shape.slot))
        throw new Error(`Unknown slot ${shape.slot}`)
  }
  const surfaceIds = (recipe.surfaces ?? []).map((s) => s.id)
  if (new Set(surfaceIds).size !== surfaceIds.length) throw new Error('Duplicate surface ID')
  for (const surface of recipe.surfaces ?? [])
    if (surface.part && !recipe.parts.some((p) => p.id === surface.part))
      throw new Error('Unknown surface part')
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

export function evaluateRecipe(recipe: Recipe, values: Record<string, number> = {}): Evaluation {
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
    surfaces: Surface[] = []
  const min: Vec3 = [Infinity, Infinity, Infinity],
    max: Vec3 = [-Infinity, -Infinity, -Infinity]
  let triangles = 0
  for (const part of recipe.parts) {
    const count = expr(part.count)
    if (!Number.isInteger(count) || count < 0 || count > 64)
      throw new Error(`Invalid repeat count for ${part.label}`)
    for (let i = 0; i < count; i++)
      for (const s of part.shapes) {
        if (shapes.length >= RECIPE_LIMITS.shapes) throw new Error('Expanded shape budget exceeded')
        const vec = (v: Expr[]): Vec3 => v.map((x) => expr(x, i)) as Vec3
        const size = vec(s.size),
          position = vec(s.position),
          rotation = vec(s.rotation ?? [0, 0, 0])
        if (size.some((x) => x < 0.001 || x > RECIPE_LIMITS.dimension))
          throw new Error(`Invalid dimensions for ${part.id}/${s.id}`)
        const radius = s.primitive === 'roundedBox' ? expr(s.radius ?? 0.02, i) : 0
        if (radius < 0 || radius > Math.min(...size) / 2)
          throw new Error(`Invalid rounding for ${s.id}`)
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
        })
        triangles += s.primitive === 'roundedBox' ? 588 : s.primitive === 'cylinder' ? 96 : 12
        if (triangles > RECIPE_LIMITS.triangles) throw new Error('Triangle budget exceeded')
        // XYZ Euler rotations match Three.js; bounding corners remain pure domain math.
        for (const x of [-size[0] / 2, size[0] / 2])
          for (const y of [-size[1] / 2, size[1] / 2])
            for (const z of [-size[2] / 2, size[2] / 2]) {
              const [rx, ry, rz] = rotation
              const x1 = x * Math.cos(rz) - y * Math.sin(rz),
                y1 = x * Math.sin(rz) + y * Math.cos(rz)
              const x2 = x1 * Math.cos(ry) + z * Math.sin(ry),
                z2 = -x1 * Math.sin(ry) + z * Math.cos(ry)
              const point = [
                x2 + position[0],
                y1 * Math.cos(rx) - z2 * Math.sin(rx) + position[1],
                y1 * Math.sin(rx) + z2 * Math.cos(rx) + position[2],
              ]
              for (let k = 0; k < 3; k++) {
                min[k] = Math.min(min[k]!, point[k]!)
                max[k] = Math.max(max[k]!, point[k]!)
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
  if (!shapes.length) throw new Error('The item must contain geometry')
  const dimensions = max.map((x, i) => x - min[i]!) as Vec3
  if (dimensions.some((x) => x > 30) || [...min, ...max].some((x) => Math.abs(x) > 30))
    throw new Error('Item exceeds 30 m bounds')
  if (min[1] < -0.001) throw new Error('Geometry extends below the ground; base must be at y=0')
  return { shapes, surfaces, min, max, dimensions, parameters, triangles }
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
