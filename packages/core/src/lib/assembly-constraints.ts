import { type FamilyId, getFamilyDefinition, inferFamilyDefinition } from './family-registry'
import type { PrimitiveMaterialInput, PrimitiveShapeInput } from './primitive-compose'

export type AssemblyObjectFamily = FamilyId | 'unknown'

export type HardGeometryConstraint = {
  source: 'prompt' | 'args'
  priority: 'hard'
}

export type HardNumberConstraint = HardGeometryConstraint & {
  value: number
}

export type HardColorConstraint = HardGeometryConstraint & {
  value: string
}

export type UserGeometryConstraints = {
  family: AssemblyObjectFamily
  style?: string
  length?: HardNumberConstraint
  width?: HardNumberConstraint
  height?: HardNumberConstraint
  primaryColor?: HardColorConstraint
}

export type AssemblyConstraintValidation = {
  ok: boolean
  issues: string[]
}

const PROMPT_COLOR_AS_PART_DETAIL_FAMILIES = new Set<AssemblyObjectFamily>([
  'conveyor',
  'pump',
  'tank',
  'reactor',
  'compressor',
  'heat_exchanger',
  'machine_tool',
  'forming_machine',
  'material_handling',
  'fluid_machine',
  'process_equipment',
  'distillation_tower',
  'robot_arm',
])

const RAW_PRIMARY_LENGTH_UNRELIABLE_FAMILIES = new Set<AssemblyObjectFamily>([
  'aircraft',
  'robot_arm',
  'tank',
  'reactor',
  'compressor',
  'process_equipment',
  'distillation_tower',
])

function textOf(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(textOf).join(' ')
  if (typeof value === 'object' && value !== null) return Object.values(value).map(textOf).join(' ')
  return ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hardNumber(value: number, source: HardGeometryConstraint['source']): HardNumberConstraint {
  return { value, source, priority: 'hard' }
}

function hardString(value: string, source: HardGeometryConstraint['source']): HardColorConstraint {
  return { value, source, priority: 'hard' }
}

export function inferAssemblyFamily(
  prompt: string,
  args?: Record<string, unknown>,
): AssemblyObjectFamily {
  return (inferFamilyDefinition({
    ...(args ?? {}),
    prompt,
    object: args?.object,
    name: args?.name,
  })?.id ?? 'unknown') as AssemblyObjectFamily
}

function unitScale(unit: unknown): number {
  if (typeof unit !== 'string') return 1
  switch (unit.trim().toLowerCase()) {
    case 'mm':
    case '毫米':
      return 0.001
    case 'cm':
    case '厘米':
      return 0.01
    default:
      return 1
  }
}

function parseChineseNumber(value: string): number | undefined {
  const numeric = Number(value)
  if (Number.isFinite(numeric)) return numeric

  const normalized = value.replaceAll('\u5169', '\u4e8c')
  const digitMap: Record<string, number> = {
    '\u4e00': 1,
    '\u4e8c': 2,
    '\u4e09': 3,
    '\u56db': 4,
    '\u4e94': 5,
    '\u516d': 6,
    '\u4e03': 7,
    '\u516b': 8,
    '\u4e5d': 9,
  }

  if (normalized === '\u5341') return 10
  if (normalized.includes('\u5341')) {
    const [tensRaw, onesRaw] = normalized.split('\u5341')
    const tens = tensRaw ? digitMap[tensRaw] : 1
    const ones = onesRaw ? digitMap[onesRaw] : 0
    return tens != null && ones != null ? tens * 10 + ones : undefined
  }
  return digitMap[normalized]
}

function parseDimensionMatch(match: RegExpMatchArray | null): number | undefined {
  if (!match?.[1]) return undefined
  const value = parseChineseNumber(match[1])
  if (value == null) return undefined
  return Number((value * unitScale(match[2])).toFixed(4))
}

const COLOR_HEX: Array<[RegExp, string]> = [
  [/(绿色|綠色|green)/i, '#22c55e'],
  [/(红色|紅色|\bred\b)/i, '#ef4444'],
  [/(蓝色|藍色|blue)/i, '#2563eb'],
  [/(黄色|黃色|yellow)/i, '#facc15'],
  [/(黑色|black)/i, '#111827'],
  [/(白色|white)/i, '#f8fafc'],
  [/(灰色|grey|gray)/i, '#64748b'],
  [/(紫色|purple)/i, '#8b5cf6'],
  [/(橙色|orange)/i, '#f97316'],
  [/(粉色|pink)/i, '#ec4899'],
]

function promptColor(prompt: string): string | undefined {
  return COLOR_HEX.find(([pattern]) => pattern.test(prompt))?.[1]
}

function promptDimensions(prompt: string, family: AssemblyObjectFamily): Record<string, number> {
  const dimensions: Record<string, number> = {}
  const numberPattern =
    '([0-9]+(?:\\.[0-9]+)?|[\\u4e00\\u4e8c\\u4e24\\u5169\\u4e09\\u56db\\u4e94\\u516d\\u4e03\\u516b\\u4e5d\\u5341]+)'
  const requiredUnitPattern = '(mm|\\u6beb\\u7c73|cm|\\u5398\\u7c73|m|\\u7c73)'
  const unitPattern = '(mm|\\u6beb\\u7c73|cm|\\u5398\\u7c73|m|\\u7c73)?'
  const dimensionPattern = (labels: string) =>
    new RegExp(
      `(?:${labels})\\s*(?:\\u4e3a|\\u662f|\\u7ea6|\\u7d04|:)?\\s*${numberPattern}\\s*${unitPattern}`,
      'i',
    )
  const patterns: Array<[string, RegExp]> = [
    [
      'length',
      dimensionPattern('\\u957f\\u5ea6|\\u9577\\u5ea6|\\u8f66\\u957f|\\u8eca\\u9577|length|long'),
    ],
    ['width', dimensionPattern('\\u5bbd\\u5ea6|\\u5bec\\u5ea6|width|wide')],
    ['width', dimensionPattern('\\u76f4\\u5f84|\\u76f4\\u5f91|diameter|dia\\.?')],
    ['height', dimensionPattern('\\u9ad8\\u5ea6|height|tall')],
  ]

  for (const [key, pattern] of patterns) {
    const dimension = parseDimensionMatch(prompt.match(pattern))
    if (dimension != null) dimensions[key] = dimension
  }

  if (family !== 'unknown' && family !== 'distillation_tower' && dimensions.length == null) {
    const dimension = parseDimensionMatch(
      prompt.match(new RegExp(`${numberPattern}\\s*${requiredUnitPattern}`, 'i')),
    )
    if (dimension != null) dimensions.length = dimension
  }

  if (family === 'outdoor_ac') {
    const ordered = Array.from(
      prompt.matchAll(new RegExp(`([0-9]+(?:\\.[0-9]+)?)\\s*${requiredUnitPattern}\\b`, 'gi')),
    )
      .map((match) => parseDimensionMatch(match))
      .filter((value): value is number => value != null)
    const length = dimensions.length ?? dimensions.width ?? ordered[0]
    const width =
      dimensions.depth ??
      (ordered.length >= 3 ? ordered[1] : undefined) ??
      (dimensions.length != null && dimensions.width != null ? dimensions.width : undefined) ??
      ordered[1] ??
      dimensions.width
    const height = dimensions.height ?? ordered[2]
    return {
      ...(length ? { length } : {}),
      ...(width ? { width } : {}),
      ...(height ? { height } : {}),
    }
  }

  return dimensions
}

function numberArg(args: Record<string, unknown>, params: Record<string, unknown>, key: string) {
  const value = args[key] ?? params[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function normalizeDimensionValue(
  value: number | undefined,
  family: AssemblyObjectFamily,
): number | undefined {
  if (value == null) return undefined
  if (family !== 'unknown' && value > 50) return Number((value * 0.001).toFixed(4))
  return value
}

function scaledNumber(value: unknown, scale: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Number((value * scale).toFixed(4))
    : undefined
}

function dimensionArgs(
  args: Record<string, unknown>,
  family: AssemblyObjectFamily,
): Record<string, number> {
  const dimensions = isRecord(args.dimensions) ? args.dimensions : undefined
  if (!dimensions) return {}
  const scale = unitScale(dimensions.units ?? args.units)
  if (family === 'outdoor_ac') {
    return {
      ...(scaledNumber(dimensions.length ?? dimensions.width, scale) != null
        ? { length: scaledNumber(dimensions.length ?? dimensions.width, scale) }
        : {}),
      ...(scaledNumber(dimensions.depth ?? dimensions.width, scale) != null
        ? { width: scaledNumber(dimensions.depth ?? dimensions.width, scale) }
        : {}),
      ...(scaledNumber(dimensions.height, scale) != null
        ? { height: scaledNumber(dimensions.height, scale) }
        : {}),
    }
  }
  return {
    ...(scaledNumber(dimensions.length, scale) != null
      ? { length: scaledNumber(dimensions.length, scale) }
      : {}),
    ...(scaledNumber(dimensions.width ?? dimensions.depth ?? dimensions.diameter, scale) != null
      ? { width: scaledNumber(dimensions.width ?? dimensions.depth ?? dimensions.diameter, scale) }
      : {}),
    ...(scaledNumber(dimensions.height, scale) != null
      ? { height: scaledNumber(dimensions.height, scale) }
      : {}),
  }
}

function stringArg(
  args: Record<string, unknown>,
  params: Record<string, unknown>,
  ...keys: string[]
) {
  for (const key of keys) {
    const value = args[key] ?? params[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return undefined
}

export function extractUserGeometryConstraints(
  prompt: string,
  args: Record<string, unknown> = {},
): UserGeometryConstraints {
  const params = isRecord(args.params) ? args.params : {}
  const family = inferAssemblyFamily(prompt, args)
  const dimensions = promptDimensions(`${prompt} ${textOf(args)}`, family)
  const explicitDimensions = dimensionArgs(args, family)
  const constraints: UserGeometryConstraints = {
    family,
    style: stringArg(args, params, 'vehicleStyle', 'style', 'variant'),
  }
  const length = normalizeDimensionValue(
    numberArg(args, params, 'length') ?? explicitDimensions.length ?? dimensions.length,
    family,
  )
  const width = normalizeDimensionValue(
    numberArg(args, params, 'width') ??
      numberArg(args, params, 'diameter') ??
      explicitDimensions.width ??
      dimensions.width,
    family,
  )
  const height = normalizeDimensionValue(
    numberArg(args, params, 'height') ?? explicitDimensions.height ?? dimensions.height,
    family,
  )
  const color = stringArg(args, params, 'primaryColor', 'color') ?? promptColor(prompt)
  if (length != null)
    constraints.length = hardNumber(
      length,
      numberArg(args, params, 'length') != null ? 'args' : 'prompt',
    )
  if (width != null)
    constraints.width = hardNumber(
      width,
      numberArg(args, params, 'width') != null || numberArg(args, params, 'diameter') != null
        ? 'args'
        : 'prompt',
    )
  if (height != null)
    constraints.height = hardNumber(
      height,
      numberArg(args, params, 'height') != null ? 'args' : 'prompt',
    )
  if (color && !PROMPT_COLOR_AS_PART_DETAIL_FAMILIES.has(family))
    constraints.primaryColor = hardString(
      color,
      stringArg(args, params, 'primaryColor', 'color') ? 'args' : 'prompt',
    )
  return constraints
}

function shapeColor(shape: PrimitiveShapeInput): string | undefined {
  return shape.material?.properties?.color
}

function primaryShapeText(shape: PrimitiveShapeInput): string {
  return `${shape.semanticRole ?? ''} ${shape.sourcePartKind ?? ''} ${shape.name ?? ''}`
    .trim()
    .toLowerCase()
}

function primaryShapeRoles(family: AssemblyObjectFamily): readonly string[] {
  return getFamilyDefinition(family)?.primarySemanticRoles ?? []
}

function isPrimaryShape(shape: PrimitiveShapeInput, family: AssemblyObjectFamily): boolean {
  const roles = primaryShapeRoles(family)
  if (roles.length === 0) return false
  const text = primaryShapeText(shape)
  return roles.some((role) => text.includes(role.toLowerCase()))
}

function primaryShapePriority(shape: PrimitiveShapeInput, family: AssemblyObjectFamily): number {
  const text = primaryShapeText(shape)
  const index = primaryShapeRoles(family).findIndex((role) => text.includes(role.toLowerCase()))
  return index < 0 ? Number.MAX_SAFE_INTEGER : index
}

function primaryLengthValue(
  candidates: readonly PrimitiveShapeInput[],
  family: AssemblyObjectFamily,
): number | undefined {
  const values = candidates
    .map((candidate) =>
      family === 'distillation_tower'
        ? primaryDimension(candidate, 'length')
        : (candidate.length ?? primaryDimension(candidate, 'length')),
    )
    .filter((value): value is number => typeof value === 'number')
  if (values.length === 0) return undefined
  if (
    family === 'pump' ||
    family === 'conveyor' ||
    family === 'material_handling' ||
    family === 'fluid_machine' ||
    family === 'process_equipment' ||
    family === 'tank' ||
    family === 'reactor' ||
    family === 'compressor' ||
    family === 'heat_exchanger' ||
    family === 'machine_tool' ||
    family === 'forming_machine' ||
    family === 'robot_arm'
  ) {
    return Math.max(...values)
  }
  return values[0]
}

function primaryShapes(
  shapes: readonly PrimitiveShapeInput[],
  family: AssemblyObjectFamily,
): PrimitiveShapeInput[] {
  return shapes
    .filter((shape) => isPrimaryShape(shape, family))
    .sort((left, right) => primaryShapePriority(left, family) - primaryShapePriority(right, family))
}

export function materialFromColor(color?: string): PrimitiveMaterialInput | undefined {
  return color ? { properties: { color } } : undefined
}

function primaryDimension(
  shape: PrimitiveShapeInput,
  dimension: 'length' | 'width' | 'height',
): number | undefined {
  if (dimension === 'length') {
    if (typeof shape.length === 'number') return shape.length
    if (shape.axis === 'x' && typeof shape.height === 'number') return shape.height
    if (typeof shape.radius === 'number') return shape.radius * 2
  }
  if (dimension === 'width') {
    if (typeof shape.width === 'number') return shape.width
    if (typeof shape.radius === 'number') return shape.radius * 2
  }
  if (dimension === 'height') {
    if (typeof shape.height === 'number') return shape.height
    if (typeof shape.radius === 'number') return shape.radius * 2
  }
  return undefined
}

export function validateAssemblyConstraints(
  shapes: PrimitiveShapeInput[],
  constraints: UserGeometryConstraints,
): AssemblyConstraintValidation {
  const issues: string[] = []
  if (
    constraints.length != null &&
    !RAW_PRIMARY_LENGTH_UNRELIABLE_FAMILIES.has(constraints.family)
  ) {
    const candidates = primaryShapes(shapes, constraints.family)
    const actual = primaryLengthValue(candidates, constraints.family)
    if (candidates.length === 0 && constraints.family !== 'unknown') {
      issues.push(
        `Hard constraint failed: no primary shape found for family ${constraints.family}.`,
      )
    } else if (actual == null && constraints.family !== 'unknown') {
      issues.push(
        `Hard constraint failed: primary shape for family ${constraints.family} has no measurable length.`,
      )
    } else if (
      actual != null &&
      Math.abs(actual - constraints.length.value) > Math.max(0.03, constraints.length.value * 0.04)
    ) {
      issues.push(
        `Hard constraint failed: expected primary length ${constraints.length.value}m, got ${actual}m.`,
      )
    }
  }
  if (constraints.family === 'distillation_tower' && constraints.width != null) {
    const candidates = primaryShapes(shapes, constraints.family)
    const actual = candidates[0] ? primaryDimension(candidates[0], 'width') : undefined
    if (
      typeof actual === 'number' &&
      Math.abs(actual - constraints.width.value) > Math.max(0.03, constraints.width.value * 0.04)
    ) {
      issues.push(
        `Hard constraint failed: expected primary width ${constraints.width.value}m, got ${actual}m.`,
      )
    }
  }
  if (constraints.family === 'distillation_tower' && constraints.height != null) {
    const candidates = primaryShapes(shapes, constraints.family)
    const actual = candidates[0] ? primaryDimension(candidates[0], 'height') : undefined
    if (
      typeof actual === 'number' &&
      Math.abs(actual - constraints.height.value) > Math.max(0.03, constraints.height.value * 0.04)
    ) {
      issues.push(
        `Hard constraint failed: expected primary height ${constraints.height.value}m, got ${actual}m.`,
      )
    }
  }
  if (constraints.primaryColor) {
    const candidates = primaryShapes(shapes, constraints.family)
    const actual = candidates.map(shapeColor).find(Boolean)
    if (actual && actual.toLowerCase() !== constraints.primaryColor.value.toLowerCase()) {
      issues.push(
        `Hard constraint failed: expected primary color ${constraints.primaryColor.value}, got ${actual}.`,
      )
    }
  }
  return { ok: issues.length === 0, issues }
}
