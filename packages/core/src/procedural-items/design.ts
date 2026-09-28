import { z } from 'zod'
import {
  type EvaluatedShape,
  type Evaluation,
  type Expr,
  ExpressionSchema,
  evaluateRecipe,
  parseRecipe,
  RECIPE_LIMITS,
  RECIPE_V2_LIMITS,
  type Recipe,
  RecipeSchema,
  shapeBounds,
  shapeTriangles,
  sweepRecipe,
  triangleCharge,
  type Vec3,
} from './recipe'
import { type Ring, sectionRings } from './section'

// Agent-facing design capabilities: the schema a design must follow and the validation that
// is the authority over it. Every surface (MCP, chat, scene programs) wraps these functions.

/** Bounds closer than this count as touching (metres). */
const CONTACT_TOLERANCE = 0.002
const ISSUE_LIMIT = 20
const LIST_LIMIT = 16

const vec2 = z.tuple([z.number(), z.number()])
const vec3 = z.tuple([z.number(), z.number(), z.number()])
const BoundsSchema = z.object({ min: vec3, max: vec3, dimensions: vec3 })

export const DesignDiagnosticSchema = z.object({
  severity: z.enum(['error', 'warning']),
  code: z.enum([
    'invalid_json',
    'schema',
    'rule',
    'parameters',
    'sweep',
    'floating_component',
    'unbalanced',
    'behind_wall',
    'draw_budget',
  ]),
  path: z.string().optional(),
  message: z.string(),
  /** How to fix it, for rule errors whose message alone does not say. */
  hint: z.string().optional(),
})

export const DesignMeasurementsSchema = z.object({
  parameters: z.record(z.string(), z.number()),
  bounds: BoundsSchema,
  shapes: z.number(),
  triangles: z.object({
    /** Triangles the renderer builds. */
    actual: z.number(),
    /** Triangles charged against the recipe budget. */
    budget: z.number(),
    limit: z.number(),
  }),
  /** One draw call per slot and motion group, in build order; `draw_budget` warns above `drawBudget`. */
  drawBudget: z.number(),
  drawGroups: z.array(
    z.object({
      slot: z.string(),
      motionGroup: z.string().nullable(),
      shapes: z.number(),
      triangles: z.number(),
    }),
  ),
  parts: z.array(
    z.object({
      id: z.string(),
      instances: z.number(),
      shapes: z.number(),
      triangles: z.number(),
      slots: z.array(z.string()),
      motion: z.enum(['hinge', 'slide', 'spin']).nullable(),
      lights: z.number(),
      bounds: BoundsSchema.nullable(),
    }),
  ),
  /**
   * The plane the design rests on or hangs from: the floor (y = 0), the wall-side reference
   * (z = its z, geometry in front) or the ceiling reference (y = its y, geometry below).
   * `gap` is the signed distance from the plane to the nearest geometry.
   */
  datum: z.object({
    kind: z.enum(['floor', 'wall', 'ceiling']),
    axis: z.enum(['y', 'z']),
    value: z.number(),
    gap: z.number(),
    /** Parts touching the datum and their bounds in the datum plane (x/z, or x/y on a wall). */
    contact: z
      .object({ parts: z.array(z.string()), shapes: z.number(), min: vec2, max: vec2 })
      .nullable(),
    /** Floor designs: whether the centre of mass lies over the contact region. */
    balanced: z.boolean().nullable(),
  }),
  /** Groups of shapes whose bounds touch, largest first. */
  components: z.object({
    count: z.number(),
    list: z.array(
      z.object({
        parts: z.array(z.string()),
        shapes: z.number(),
        bounds: BoundsSchema,
        touchesDatum: z.boolean(),
        datumGap: z.number(),
        /** Distance to the nearest shape outside this component. */
        nearestGap: z.number().nullable(),
      }),
    ),
  }),
  surfaces: z.array(z.string()),
  motions: z.number(),
  lights: z.number(),
})

export const DesignValidationSchema = z.object({
  valid: z.boolean(),
  diagnostics: z.array(DesignDiagnosticSchema),
  design: z
    .object({
      name: z.string(),
      mounting: z.enum(['floor', 'wall-side', 'ceiling']),
      parameters: z.array(
        z.object({
          id: z.string(),
          default: z.number(),
          min: z.number(),
          max: z.number(),
          step: z.number(),
          unit: z.string(),
        }),
      ),
      slots: z.array(z.string()),
    })
    .nullable(),
  sweep: z
    .object({
      cases: z.number(),
      failed: z.number(),
      failures: z.array(z.object({ values: z.record(z.string(), z.number()), error: z.string() })),
    })
    .nullable(),
  measurements: DesignMeasurementsSchema.nullable(),
})

export type DesignDiagnostic = z.infer<typeof DesignDiagnosticSchema>
export type DesignMeasurements = z.infer<typeof DesignMeasurementsSchema>
export type DesignValidation = z.infer<typeof DesignValidationSchema>

const DESIGN_RULES = [
  'Validation is the authority. It enforces these rules, which JSON Schema cannot express, and evaluates the defaults, each parameter at its min and max, and 20 seeded samples. Only a design without errors can be placed.',
  'version 1 covers box, roundedBox, cylinder and ellipsoid shapes, flat part motions and at most 16 parts of 24 shapes. Everything marked "v2" below needs "version": 2, and a v2 design stays under 24 KiB of JSON.',
  'Units are metres and radians, +Y is up. A shape position is its centre and size its full extent; rotation is XYZ Euler about the centre. Cylinders run along Y; an ellipsoid fills its size box.',
  'An expression is a number, a parameter id, "index" (the 0-based repeat inside part.count) or {op, args}. Arithmetic strings such as "width / 2" are not supported. Results stay finite and within ±10000, nesting depth ≤ 16, and mod needs a positive divisor. v2 adds {op: "select", args: [i, v0, …]}, which is v_i for an integral i from 0 to n - 1.',
  'IDs are lowercase snake_case. Parameter, slot, part and surface ids are unique; shape ids are unique within their part; "index" is not a parameter id.',
  'Each shape.slot names a declared slot; parameter.part and surface.part name declared parts. At most one parameter binds a resize handle (axis) per axis, per part or per design.',
  'Parameters need min ≤ default ≤ max. unit "count" needs integer min, max, default and step. v2: unit "bool" runs 0..1 and "choice" indexes its options (2–16 labels), both in steps of 1, with an integer default and no axis.',
  'v2: part.when and shape.when build a repeat or a shape only where they evaluate to nonzero; a repeat whose shapes are all skipped builds nothing (no light, motion or named surface).',
  'part.count evaluates to an integer from 0 to 64. Shape sizes evaluate to 0.001–30 m, and the design stays within 30 m of its origin.',
  'No geometry goes below y = 0, whatever the mounting. Without mounting the design stands on the floor at y = 0 and no motion may sweep below it.',
  'mounting "wall-side" needs a named surface without part whose normal is local -Z (rotation [-π/2, 0, 0]). It is the plane that meets the wall: keep geometry in front of it (larger z; geometry behind it passes into the wall and is warned about); no motion may cross behind it.',
  'mounting "ceiling" needs a named surface without part facing +Y (no rotation) at the highest point of the design. No motion may rise above it.',
  'radius applies to roundedBox (at most half the smallest size, default 0.02). topScale applies to cylinders only (0–1). support: true offers a shape top to hosted items; it must be an unrotated box, roundedBox or untapered, solid, full cylinder outside moving parts.',
  'v2 cylinders: segments (3–64 sides, default 24), open (no end caps), inner (hollow wall, inner radius as a fraction 0–1 of the outer) and arc (a partial sweep in (0, 2π] from local +Z toward +X).',
  'v2 extrude: a section in local x/y extruded along local z by length, centred. Sections: rectangle {width, depth, corner?}, round {radius, wall?}, oval {width, depth}, section {family I|C|L|T|Z|rect-tube, width, depth, web, flange} (web and flange thinner than the size; a rect-tube web under half its width) or polygon {outer, holes?} of 3–64 points that must not self-intersect. bevel ≤ min(length / 4, 5 cm, thinnest wall / 2.5).',
  'v2 revolve: profile [radius, height] points (2–64, radius ≥ 0) turned about local Y, with segments and arc as on cylinders. It is closed where the profile meets the axis at both ends over a full turn; otherwise it is a surface drawn from both sides.',
  "v2 part trees: part.parent makes a part move with its parent; it repeats once (riding the parent's repeat 0) or exactly as often as the parent (bound by index), at most 8 levels deep. part.frame {position, rotation} is where its shapes, light and joint are authored.",
  'v2 joints: at most one per part, keyed by joints[].child, with origin and axis in the part frame. fixed takes no values; revolute (radians) and prismatic (metres) need open and may give rest and a range [low, high] containing rest and open; continuous needs speed (radians per second) and no open, range or timing. A part has a flat motion or a joint, not both, and a part with a flat motion cannot sit in a tree.',
  'v2 base (floor designs only): the design-space height that rests on the floor; no geometry or motion may go below it.',
  'v2 cuts (ceiling designs): one rect {size, center?} or circle {diameter, center?} opening in the host ceiling, in the mounting reference plane. The design may rise above the reference only inside its cut, moving parts included.',
  'Motion: hinge 0 < |angle| ≤ π, slide 0 < |distance| ≤ 5 m, spin 0 < |radiansPerSecond| ≤ 20 (joints alike: |open - rest| and range ends within those of rest); delay 0–1 s and duration 0.1–2 s. At most 8 moving parts (flat motions and non-fixed joints) and 32 evaluated motion groups. Named surfaces cannot belong to moving parts or their children.',
  'Lights: at most 12 evaluated. Each light lies within its part instance at rest (±2 cm); lights sharing an emissiveSlot share one color.',
  'Surfaces evaluate to 0.001–30 m sizes within 30 m of the origin, at most 256 in all.',
  'Budgets: 256 expanded shapes (count × shapes, summed over parts; 512 in v2), 100000 budget triangles (v1 charges box 12, roundedBox 588, cylinder 96, ellipsoid 720; v2 charges what the renderer builds, reported as measurements.triangles.actual), 50000 expression evaluations, 131072 characters of JSON (24 KiB in v2), 12000 JSON values nested at most 24 deep, and 250 ms of evaluation in v2.',
  'constraints: each {left, relation, right} must hold (lte: left ≤ right; gte: left ≥ right); message is the error shown when it fails.',
]

// Legs sit at (±1, ±1) × (width / 2 − 0.03): x from index mod 2, z from floor(index / 2).
const legInset: Expr = { op: 'sub', args: [{ op: 'div', args: ['width', 2] }, 0.03] }
const legSign = (bit: Expr): Expr => ({ op: 'sub', args: [{ op: 'mul', args: [bit, 2] }, 1] })
const legOffset = (bit: Expr): Expr => ({ op: 'mul', args: [legSign(bit), legInset] })

/** A small valid design: a square side table with four legs. */
export const DESIGN_EXAMPLE: Recipe = {
  version: 1,
  name: 'Side table',
  description: 'Square side table with a solid top on four legs.',
  classification: { category: 'table', functionTags: ['side-table'], tags: ['living'] },
  parameters: [
    {
      id: 'width',
      label: 'Width',
      default: 0.5,
      min: 0.3,
      max: 0.9,
      step: 0.05,
      unit: 'm',
      axis: 'x',
    },
    {
      id: 'height',
      label: 'Height',
      default: 0.55,
      min: 0.4,
      max: 0.8,
      step: 0.05,
      unit: 'm',
      axis: 'y',
    },
  ],
  slots: [{ id: 'wood', label: 'Wood', color: '#a47148', finish: 'wood' }],
  parts: [
    {
      id: 'top',
      label: 'Top',
      count: 1,
      shapes: [
        {
          id: 'board',
          primitive: 'box',
          slot: 'wood',
          size: ['width', 0.03, 'width'],
          position: [0, { op: 'sub', args: ['height', 0.015] }, 0],
          support: true,
        },
      ],
    },
    {
      id: 'legs',
      label: 'Legs',
      count: 4,
      shapes: [
        {
          id: 'leg',
          primitive: 'box',
          slot: 'wood',
          size: [0.04, { op: 'sub', args: ['height', 0.03] }, 0.04],
          position: [
            legOffset({ op: 'mod', args: ['index', 2] }),
            { op: 'div', args: [{ op: 'sub', args: ['height', 0.03] }, 2] },
            legOffset({ op: 'floor', args: [{ op: 'div', args: ['index', 2] }] }),
          ],
        },
      ],
    },
  ],
  constraints: [],
}

export type DesignSchemaDescription = {
  /** The newest design version the schema covers; version 1 designs stay valid. */
  version: 2
  /** JSON Schema (2020-12) of a design; `$defs.Expr` is the recursive expression type. */
  schema: Record<string, unknown>
  limits: typeof RECIPE_LIMITS
  /** Version 2 caps that replace or add to `limits`. */
  limitsV2: typeof RECIPE_V2_LIMITS
  /** Rules JSON Schema cannot express; `validateDesign` enforces them. */
  rules: string[]
  example: Recipe
}

let jsonSchema: Record<string, unknown> | undefined

/** The design contract for agents, generated from `RecipeSchema` (not from the node, whose recipe is opaque). */
export function describeDesignSchema(): DesignSchemaDescription {
  if (!jsonSchema) {
    const registry = z.registry<{ id: string; description: string }>()
    registry.add(ExpressionSchema, {
      id: 'Expr',
      description:
        'A number, a parameter id, "index" (the 0-based repeat inside part.count) or {op, args}.',
    })
    jsonSchema = {
      title: 'Pascal design',
      description:
        'A procedural design: parameters, material slots and parts made of box, roundedBox, cylinder and ellipsoid shapes, and in version 2 extrude and revolve shapes, part trees and joints. Validation enforces rules this schema cannot express and is the authority.',
      ...(z.toJSONSchema(RecipeSchema, { io: 'input', metadata: registry }) as Record<
        string,
        unknown
      >),
    }
  }
  return structuredClone({
    version: 2,
    schema: jsonSchema,
    limits: RECIPE_LIMITS,
    limitsV2: RECIPE_V2_LIMITS,
    rules: DESIGN_RULES,
    example: DESIGN_EXAMPLE,
  })
}

const EXPRESSION_KEYS = new Set([
  'count',
  'size',
  'position',
  'rotation',
  'radius',
  'topScale',
  'pivot',
  'angle',
  'distance',
  'radiansPerSecond',
  'delay',
  'duration',
  'left',
  'right',
  'when',
  'base',
  'length',
  'bevel',
  'width',
  'depth',
  'corner',
  'wall',
  'web',
  'flange',
  'outer',
  'holes',
  'profile',
  'inner',
  'arc',
  'origin',
  'axis',
  'open',
  'rest',
  'range',
  'speed',
  'center',
  'diameter',
])

function formatPath(path: readonly PropertyKey[]) {
  return path.reduce<string>(
    (text, key) =>
      typeof key === 'number' ? `${text}[${key}]` : `${text}${text ? '.' : ''}${String(key)}`,
    '',
  )
}

function schemaDiagnostics(error: z.ZodError, raw: unknown): DesignDiagnostic[] {
  const diagnostics = error.issues.slice(0, ISSUE_LIMIT).map((issue): DesignDiagnostic => {
    let value = raw
    for (const key of issue.path)
      value = value && typeof value === 'object' ? Reflect.get(value, key) : undefined
    const got = (JSON.stringify(value) ?? 'nothing').slice(0, 80)
    let message = issue.message
    if (issue.code === 'invalid_format' && issue.format === 'regex')
      message =
        issue.path.at(-1) === 'color'
          ? 'colors are 6-digit hex strings like "#a47148"'
          : issue.path.some((key) => typeof key === 'string' && EXPRESSION_KEYS.has(key))
            ? 'expressions are a number, a parameter id, "index" or {op, args}; arithmetic strings are not supported'
            : 'IDs and references are lowercase snake_case matching ^[a-z][a-z0-9_]{0,47}$'
    return {
      severity: 'error',
      code: 'schema',
      path: formatPath(issue.path) || undefined,
      message: `${message} (got ${got})`,
      ...(/requires recipe version 2/.test(message) && {
        hint: 'Set "version": 2 (and keep the design under 24 KiB), or leave out the v2 feature.',
      }),
    }
  })
  if (error.issues.length > ISSUE_LIMIT)
    diagnostics.push({
      severity: 'error',
      code: 'schema',
      message: `${error.issues.length - ISSUE_LIMIT} more schema issues omitted; apply the same rules throughout`,
    })
  return diagnostics
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

const ids = (list: unknown) =>
  Array.isArray(list)
    ? list.flatMap((entry) => (typeof entry?.id === 'string' ? [entry.id] : [])).join(', ') ||
      'none'
    : 'none'

/** A concrete repair for the rule errors authors hit most, from the design they sent. */
function ruleHint(text: string, raw: unknown): string | undefined {
  const design = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const mounting = design.mounting as { attachTo?: string; reference?: string } | undefined
  if (/mounting reference|Mounting requires/i.test(text)) {
    const plain = Array.isArray(design.surfaces)
      ? design.surfaces.filter((s) => s && typeof s === 'object' && !('part' in s))
      : []
    const declared = `mounting.reference is ${JSON.stringify(mounting?.reference)}; surfaces without part: ${ids(plain)}.`
    return mounting?.attachTo === 'ceiling'
      ? `${declared} Declare surfaces: [{"id":"top","label":"Top","position":[0,<highest y of the geometry>,0],"size":[<w>,<d>]}] (no part, no rotation) and mounting: {"attachTo":"ceiling","reference":"top"}.`
      : `${declared} Declare surfaces: [{"id":"back","label":"Back","position":[0,<half height>,0],"rotation":[-1.5707963267948966,0,0],"size":[<width>,<height>]}] (no part) and mounting: {"attachTo":"wall-side","reference":"back"}; keep all geometry at z >= 0.`
  }
  if (/below the ground|below the floor/.test(text))
    return 'Every shape must stay at y >= 0 for every parameter value: an unrotated box rests at position.y = size.y / 2; use max/min expressions where a parameter moves a part down.'
  if (/^Unknown slot /.test(text)) return `Declared slots: ${ids(design.slots)}.`
  if (/^Unknown (part|surface part)/.test(text)) return `Declared parts: ${ids(design.parts)}.`
  if (/^Unknown expression reference /.test(text))
    return `Expressions may name declared parameters (${ids(design.parameters)}) or "index".`
  if (/^Invalid dimensions /.test(text))
    return 'Every size component must evaluate to 0.001–30 m at every parameter value.'
  if (/^Expanded shape budget/.test(text))
    return 'At most 256 shapes after repetition (count × shapes, summed over parts): merge repeated small pieces into fewer, larger shapes.'
  return undefined
}

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`
// `|| 0` folds -0 so results survive a JSON round trip unchanged.
const round = (value: number) => Math.round(value * 1e6) / 1e6 || 0
const roundVec = <T extends number[]>(values: T) => values.map(round) as T
const boundsFrom = (min: Vec3, max: Vec3) => ({
  min: roundVec(min),
  max: roundVec(max),
  dimensions: roundVec(max.map((v, i) => v - min[i]!) as Vec3),
})

function unionBounds(entries: { min: Vec3; max: Vec3 }[]) {
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const entry of entries)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k]!, entry.min[k]!)
      max[k] = Math.max(max[k]!, entry.max[k]!)
    }
  return boundsFrom(min, max)
}

const ringArea = (ring: Ring) =>
  Math.abs(
    ring.reduce((sum, [x, y], i) => {
      const [nx, ny] = ring[(i + 1) % ring.length]!
      return sum + x * ny - nx * y
    }, 0),
  ) / 2

/** Volume of a shape for the centre of mass (a tapered cylinder is a frustum). */
function shapeVolume(shape: EvaluatedShape) {
  const [w, h, d] = shape.size
  const sweep = (shape.arc ?? 2 * Math.PI) / (2 * Math.PI)
  switch (shape.primitive) {
    case 'cylinder': {
      const t = shape.topScale
      const hollow = shape.inner === undefined ? 1 : 1 - shape.inner ** 2
      return (((Math.PI / 4) * (1 + t + t * t)) / 3) * w * h * d * hollow * sweep
    }
    case 'ellipsoid':
      return (Math.PI / 6) * w * h * d
    case 'extrude': {
      const rings = sectionRings(shape.section!)
      const area =
        ringArea(rings.outer) - rings.holes.reduce((sum, hole) => sum + ringArea(hole), 0)
      return area * d
    }
    case 'revolve': {
      // Pappus over the profile closed along the axis: arc · Σ (r1² + r1 r2 + r2²) Δy / 6.
      const profile = shape.profile!
      let sum = 0
      for (let i = 1; i < profile.length; i++) {
        const [r1, y1] = profile[i - 1]!,
          [r2, y2] = profile[i]!
        sum += ((r1 * r1 + r1 * r2 + r2 * r2) * (y2 - y1)) / 6
      }
      return Math.abs(sum) * 2 * Math.PI * sweep
    }
    default:
      return w * h * d
  }
}

/** Draw calls per design above which rendering many instances gets costly. */
const DRAW_BUDGET = 16

function measureDesign(recipe: Recipe, evaluation: Evaluation, diagnostics: DesignDiagnostic[]) {
  const shapes = evaluation.shapes.map((shape) => ({
    shape,
    ...shapeBounds(shape),
    triangles: shapeTriangles(shape),
    charge: triangleCharge(recipe, shape),
  }))
  const reference = recipe.mounting
    ? evaluation.surfaces.find((surface) => surface.id === recipe.mounting!.reference)
    : undefined
  const kind =
    recipe.mounting?.attachTo === 'ceiling'
      ? 'ceiling'
      : recipe.mounting?.attachTo === 'wall-side'
        ? 'wall'
        : 'floor'
  const axis = kind === 'wall' ? 2 : 1
  const value = kind === 'floor' ? 0 : (reference?.position[axis] ?? 0)
  // Signed distance from the datum into the design: floor and wall designs grow away from
  // their plane (+Y, +Z), ceiling designs hang below theirs.
  const datumGap = (min: Vec3, max: Vec3) =>
    kind === 'ceiling' ? value - max[axis]! : min[axis]! - value
  // Real contact: the shape reaches the datum plane from the design side, within tolerance.
  // Geometry entirely beyond the plane (behind the wall, above the ceiling) does not touch it.
  const touches = (min: Vec3, max: Vec3) =>
    min[axis]! <= value + CONTACT_TOLERANCE && max[axis]! >= value - CONTACT_TOLERANCE
  const planeAxes = kind === 'wall' ? ([0, 1] as const) : ([0, 2] as const)

  const drawGroups = new Map<
    string,
    { slot: string; motionGroup: string | null; shapes: number; triangles: number }
  >()
  for (const { shape, triangles } of shapes) {
    const key = JSON.stringify([shape.motionGroup ?? null, shape.slot])
    const group = drawGroups.get(key) ?? {
      slot: shape.slot,
      motionGroup: shape.motionGroup ?? null,
      shapes: 0,
      triangles: 0,
    }
    group.shapes++
    group.triangles += triangles
    drawGroups.set(key, group)
  }

  if (drawGroups.size > DRAW_BUDGET)
    diagnostics.push({
      severity: 'warning',
      code: 'draw_budget',
      message: `${drawGroups.size} draw calls per instance (one per slot and motion group); the budget is ${DRAW_BUDGET}. Share slots across parts, or fold moving parts into fewer motion groups.`,
    })

  const parts = recipe.parts.map((part) => {
    const own = shapes.filter(({ shape }) => shape.partId === part.id)
    return {
      id: part.id,
      // Shape ids are `${part}:${index}:${shape}`; `when` may skip shapes or whole repeats.
      instances: new Set(own.map(({ shape }) => shape.id.split(':')[1])).size,
      shapes: own.length,
      triangles: own.reduce((sum, entry) => sum + entry.triangles, 0),
      slots: [...new Set(own.map(({ shape }) => shape.slot))],
      motion: evaluation.motions.find((motion) => motion.partId === part.id)?.kind ?? null,
      lights: evaluation.lights.filter((light) => light.partId === part.id).length,
      bounds: own.length ? unionBounds(own) : null,
    }
  })

  // Union shapes whose bounds touch into connected components.
  const gapBetween = (a: { min: Vec3; max: Vec3 }, b: { min: Vec3; max: Vec3 }) => {
    let sum = 0
    for (let k = 0; k < 3; k++) {
      const d = Math.max(0, a.min[k]! - b.max[k]!, b.min[k]! - a.max[k]!)
      sum += d * d
    }
    return Math.sqrt(sum)
  }
  const root = shapes.map((_, i) => i)
  const find = (i: number): number => {
    while (root[i] !== i) {
      root[i] = root[root[i]!]!
      i = root[i]!
    }
    return i
  }
  for (let a = 0; a < shapes.length; a++)
    for (let b = a + 1; b < shapes.length; b++)
      if (gapBetween(shapes[a]!, shapes[b]!) <= CONTACT_TOLERANCE) root[find(a)] = find(b)
  const componentOf = shapes.map((_, i) => find(i))
  const groups = new Map<number, number[]>()
  for (let i = 0; i < shapes.length; i++) {
    const group = groups.get(componentOf[i]!) ?? []
    group.push(i)
    groups.set(componentOf[i]!, group)
  }
  const components = [...groups.values()]
    .map((indices) => {
      const members = indices.map((i) => shapes[i]!)
      let nearest = Infinity
      for (const i of indices)
        for (let j = 0; j < shapes.length; j++)
          if (componentOf[j] !== componentOf[i])
            nearest = Math.min(nearest, gapBetween(shapes[i]!, shapes[j]!))
      return {
        parts: [...new Set(members.map(({ shape }) => shape.partId))],
        shapes: members.length,
        bounds: unionBounds(members),
        touchesDatum: members.some((entry) => touches(entry.min, entry.max)),
        datumGap: round(Math.min(...members.map((entry) => datumGap(entry.min, entry.max)))),
        nearestGap: Number.isFinite(nearest) ? round(nearest) : null,
      }
    })
    .sort((a, b) => b.shapes - a.shapes)
  const floating = new Map<string, typeof components>()
  for (const component of components.filter((c) => !c.touchesDatum)) {
    const key = component.parts.join(', ')
    floating.set(key, [...(floating.get(key) ?? []), component])
  }
  const datumName =
    kind === 'floor' ? 'the floor (y = 0)' : `the ${kind} reference "${recipe.mounting!.reference}"`
  for (const [parts, list] of floating) {
    const nearest = Math.min(...list.map((c) => c.nearestGap ?? Infinity))
    const subject =
      list.length === 1
        ? `${parts} (${plural(list[0]!.shapes, 'shape')}) touches`
        : `${list.length} separate groups of ${parts} touch`
    const distances = [
      ...(Number.isFinite(nearest) ? [`nearest other geometry ${nearest} m`] : []),
      `datum ${Math.min(...list.map((c) => c.datumGap))} m`,
    ]
    diagnostics.push({
      severity: 'warning',
      code: 'floating_component',
      message: `${subject} neither the rest of the design nor ${datumName} (${distances.join(', ')})`,
    })
  }

  if (kind === 'wall') {
    const behind = shapes.filter((entry) => datumGap(entry.min, entry.max) < -CONTACT_TOLERANCE)
    if (behind.length)
      diagnostics.push({
        severity: 'warning',
        code: 'behind_wall',
        message: `${[...new Set(behind.map(({ shape }) => shape.partId))].join(', ')} reach${behind.length === 1 ? 'es' : ''} ${round(-Math.min(...behind.map((e) => datumGap(e.min, e.max))))} m behind the wall reference "${recipe.mounting!.reference}" and would pass into the wall`,
      })
  }

  const contactShapes = shapes.filter((entry) => touches(entry.min, entry.max))
  const contact = contactShapes.length
    ? {
        parts: [...new Set(contactShapes.map(({ shape }) => shape.partId))],
        shapes: contactShapes.length,
        min: roundVec(planeAxes.map((k) => Math.min(...contactShapes.map((e) => e.min[k]!)))) as [
          number,
          number,
        ],
        max: roundVec(planeAxes.map((k) => Math.max(...contactShapes.map((e) => e.max[k]!)))) as [
          number,
          number,
        ],
      }
    : null
  let balanced: boolean | null = null
  if (kind === 'floor' && contact) {
    let mass = 0
    const centre: [number, number] = [0, 0]
    for (const { shape } of shapes) {
      const volume = shapeVolume(shape)
      mass += volume
      centre[0] += volume * shape.position[0]
      centre[1] += volume * shape.position[2]
    }
    balanced = [0, 1].every((i) => {
      const c = centre[i as 0 | 1] / mass
      return c >= contact.min[i]! - CONTACT_TOLERANCE && c <= contact.max[i]! + CONTACT_TOLERANCE
    })
    if (!balanced)
      diagnostics.push({
        severity: 'warning',
        code: 'unbalanced',
        message: `The centre of mass (x ${round(centre[0]! / mass)}, z ${round(centre[1]! / mass)}) lies outside the floor contact region; the design would tip over`,
      })
  }

  return {
    parameters: { ...evaluation.parameters },
    bounds: boundsFrom(evaluation.min, evaluation.max),
    shapes: shapes.length,
    triangles: {
      actual: shapes.reduce((sum, entry) => sum + entry.triangles, 0),
      budget: shapes.reduce((sum, entry) => sum + entry.charge, 0),
      limit: RECIPE_LIMITS.triangles,
    },
    drawGroups: [...drawGroups.values()],
    drawBudget: DRAW_BUDGET,
    parts,
    datum: {
      kind,
      axis: kind === 'wall' ? ('z' as const) : ('y' as const),
      value: round(value),
      gap: round(Math.min(...shapes.map((entry) => datumGap(entry.min, entry.max)))),
      contact,
      balanced,
    },
    components: { count: components.length, list: components.slice(0, LIST_LIMIT) },
    surfaces: evaluation.surfaces.map((surface) => surface.id),
    motions: evaluation.motions.length,
    lights: evaluation.lights.length,
  } satisfies DesignMeasurements
}

/**
 * Validate a design (an object or its JSON string) and measure it at `parameters`
 * (defaults otherwise). Never throws: problems come back as coded diagnostics.
 */
export function validateDesign(
  input: unknown,
  options: { parameters?: Record<string, number> } = {},
): DesignValidation {
  const failed = (diagnostics: DesignDiagnostic[]): DesignValidation => ({
    valid: false,
    diagnostics,
    design: null,
    sweep: null,
    measurements: null,
  })
  let raw = input
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input)
    } catch (error) {
      return failed([
        { severity: 'error', code: 'invalid_json', message: `Not valid JSON: ${message(error)}` },
      ])
    }
  }
  let recipe: Recipe
  try {
    recipe = parseRecipe(raw)
  } catch (error) {
    return failed(
      error instanceof z.ZodError
        ? schemaDiagnostics(error, raw)
        : [
            {
              severity: 'error',
              code: 'rule',
              message: message(error),
              ...(ruleHint(message(error), raw) && { hint: ruleHint(message(error), raw) }),
            },
          ],
    )
  }

  const diagnostics: DesignDiagnostic[] = []
  const cases = sweepRecipe(recipe)
  const failures = cases.filter((c) => !c.valid)
  const byError = new Map<string, typeof failures>()
  for (const failure of failures)
    byError.set(failure.error ?? '', [...(byError.get(failure.error ?? '') ?? []), failure])
  for (const [error, list] of byError)
    diagnostics.push({
      severity: 'error',
      code: 'sweep',
      message: `${error}: fails for ${list.length} of ${cases.length} parameter sets, e.g. ${JSON.stringify(list[0]!.values)}`,
      ...(ruleHint(error, raw) && { hint: ruleHint(error, raw) }),
    })

  let evaluation: Evaluation | undefined
  try {
    evaluation = evaluateRecipe(recipe, options.parameters ?? {})
  } catch (error) {
    diagnostics.push({
      severity: 'error',
      code: 'parameters',
      path: 'parameters',
      message: message(error),
    })
  }
  const measurements = evaluation ? measureDesign(recipe, evaluation, diagnostics) : null
  return {
    valid: !diagnostics.some((d) => d.severity === 'error'),
    diagnostics,
    design: {
      name: recipe.name,
      mounting: recipe.mounting?.attachTo ?? 'floor',
      parameters: recipe.parameters.map(({ id, default: value, min, max, step, unit }) => ({
        id,
        default: value,
        min,
        max,
        step,
        unit,
      })),
      slots: recipe.slots.map((slot) => slot.id),
    },
    sweep: {
      cases: cases.length,
      failed: failures.length,
      failures: failures
        .slice(0, 8)
        .map(({ values, error }) => ({ values, error: error ?? 'Invalid design' })),
    },
    measurements,
  }
}
