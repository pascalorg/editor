import type { PrimitiveMaterialInput, PrimitiveShapeInput } from './primitive-compose'

export type AssemblyObjectFamily =
  | 'vehicle'
  | 'fan'
  | 'pump'
  | 'conveyor'
  | 'machine_tool'
  | 'outdoor_ac'
  | 'tank'
  | 'distillation_tower'
  | 'reactor'
  | 'compressor'
  | 'grate_cooler'
  | 'valve'
  | 'electrical'
  | 'robot_arm'
  | 'unknown'

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

export function inferAssemblyFamily(prompt: string, args?: Record<string, unknown>): AssemblyObjectFamily {
  const text = `${prompt} ${textOf(args)}`.toLowerCase()
  if (/(outdoor.?ac|air.?conditioner|condenser|\u7a7a\u8c03\u5916\u673a|\u7a7a\u8abf\u5916\u6a5f|\u7a7a\u8c03|\u7a7a\u8abf)/i.test(text)) return 'outdoor_ac'
  if (/(grate[_\s-]?cooler|clinker[_\s-]?cooler|\u7be6\u51b7\u673a|\u7be6\u51b7\u6a5f)/i.test(text)) return 'grate_cooler'
  if (/(reactor|reaction[_\s-]?(kettle|vessel)|stirred[_\s-]?tank|\u53cd\u5e94\u91dc|\u53cd\u61c9\u91dc|\u53cd\u5e94\u5668|\u53cd\u61c9\u5668)/i.test(text)) return 'reactor'
  if (/(compressor|air[_\s-]?compressor|gas[_\s-]?engine|gas[_\s-]?turbine|combustion[_\s-]?engine|internal[_\s-]?combustion|\u538b\u7f29\u673a|\u58d3\u7e2e\u6a5f|\u71c3\u6c14\u673a|\u71c3\u6c14\u8f6e\u673a|\u5185\u71c3\u673a|\u53d1\u52a8\u673a)/i.test(text)) return 'compressor'
  if (/(distillation[_\s-]?(tower|column)|fractionat(?:ion|or)|rectification[_\s-]?(tower|column)|chemical[_\s-]?tower|process[_\s-]?tower|\u84b8\u998f\u5854|\u84b8\u992e\u5854|\u7cbe\u998f\u5854|\u7cbe\u992e\u5854|\u5854\u5668|\u5316\u5de5\u5854)/i.test(text)) return 'distillation_tower'
  if (/(robot[_\s-]?arm|industrial.?robot|cobot|manipulator|fanuc|m-710ic|m-710i|\u673a\u68b0\u81c2|\u6a5f\u68b0\u81c2|\u673a\u5668\u4eba|\u6a5f\u5668\u4eba|\u516d\u8f74|\u516d\u8ef8)/i.test(text)) return 'robot_arm'
  if (/(car|sedan|suv|truck|vehicle|汽车|汽車|小汽车|小汽車|轿车|轎車)/i.test(text)) return 'vehicle'
  if (/(outdoor.?ac|air.?conditioner|condenser|空调外机|空調外機|空调|空調)/i.test(text)) return 'outdoor_ac'
  if (/(cnc|lathe|milling|mill|grinder|grinding|planer|drill|drilling|machining.?center|machine.?tool|\u673a\u5e8a|\u6a5f\u5e8a|\u8f66\u5e8a|\u8eca\u5e8a|\u94e3\u5e8a|\u92d1\u5e8a|\u78e8\u5e8a|\u5228\u5e8a|\u947d\u5e8a|\u94bb\u5e8a|\u52a0\u5de5\u4e2d\u5fc3)/i.test(text))
    return 'machine_tool'
  if (/(pump|blower|centrifugal|泵|风机|風機)/i.test(text)) return 'pump'
  if (/(conveyor|belt.?conveyor|\u8f93\u9001\u673a|\u8f38\u9001\u6a5f|\u4f20\u9001\u5e26|\u50b3\u9001\u5e36|\u8f93\u9001\u5e26|\u8f38\u9001\u5e36)/i.test(text)) return 'conveyor'
  if (/(fan|ventilator|风扇|風扇)/i.test(text)) return 'fan'
  if (/(tank|vessel|\u7f50|\u50a8\u7f50|\u5132\u7f50|\u5bb9\u5668)/i.test(text)) return 'tank'
  if (/(valve|阀|閥)/i.test(text)) return 'valve'
  if (/(electrical.?cabinet|control.?cabinet|电柜|電櫃|控制柜)/i.test(text)) return 'electrical'
  return 'unknown'
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
  const normalized = value.replaceAll('兩', '两')
  const digitMap: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  }
  if (normalized === '十') return 10
  if (normalized.includes('十')) {
    const [tensRaw, onesRaw] = normalized.split('十')
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
  [/(红色|紅色|red)/i, '#ef4444'],
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
  const patterns: Array<[string, RegExp]> = [
    ['length', /(?:长度|長度|车长|車長|长|長|length|long)\s*(?:为|是|约|約|:|：)?\s*([0-9]+(?:\.[0-9]+)?|[一二两兩三四五六七八九十]+)\s*(mm|毫米|cm|厘米|m|米)/i],
    ['width', /(?:宽度|寬度|宽|寬|width|wide)\s*(?:为|是|约|約|:|：)?\s*([0-9]+(?:\.[0-9]+)?|[一二两兩三四五六七八九十]+)\s*(mm|毫米|cm|厘米|m|米)/i],
    ['width', /(?:直径|直徑|diameter|dia\.?)\s*(?:为|是|约|約|:|：)?\s*([0-9]+(?:\.[0-9]+)?|[一二两兩三四五六七八九十]+)\s*(mm|毫米|cm|厘米|m|米)/i],
    ['height', /(?:高度|高|height|tall)\s*(?:为|是|约|約|:|：)?\s*([0-9]+(?:\.[0-9]+)?|[一二两兩三四五六七八九十]+)\s*(mm|毫米|cm|厘米|m|米)/i],
  ]
  for (const [key, pattern] of patterns) {
    const dimension = parseDimensionMatch(prompt.match(pattern))
    if (dimension != null) dimensions[key] = dimension
  }
  if (family !== 'unknown' && family !== 'distillation_tower' && dimensions.length == null) {
    const dimension = parseDimensionMatch(
      prompt.match(/([0-9]+(?:\.[0-9]+)?|[一二两兩三四五六七八九十]+)\s*(mm|毫米|cm|厘米|m|米)/i),
    )
    if (dimension != null) dimensions.length = dimension
  }
  if (family === 'outdoor_ac') {
    const ordered = Array.from(
      prompt.matchAll(/([0-9]+(?:\.[0-9]+)?)\s*(mm|cm|m)\b/gi),
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

function normalizeDimensionValue(value: number | undefined, family: AssemblyObjectFamily): number | undefined {
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

function stringArg(args: Record<string, unknown>, params: Record<string, unknown>, ...keys: string[]) {
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
  const length = normalizeDimensionValue(numberArg(args, params, 'length') ?? explicitDimensions.length ?? dimensions.length, family)
  const width = normalizeDimensionValue(numberArg(args, params, 'width') ?? numberArg(args, params, 'diameter') ?? explicitDimensions.width ?? dimensions.width, family)
  const height = normalizeDimensionValue(numberArg(args, params, 'height') ?? explicitDimensions.height ?? dimensions.height, family)
  const color = stringArg(args, params, 'primaryColor', 'color') ?? promptColor(prompt)
  if (length != null) constraints.length = hardNumber(length, numberArg(args, params, 'length') != null ? 'args' : 'prompt')
  if (width != null) constraints.width = hardNumber(width, numberArg(args, params, 'width') != null || numberArg(args, params, 'diameter') != null ? 'args' : 'prompt')
  if (height != null) constraints.height = hardNumber(height, numberArg(args, params, 'height') != null ? 'args' : 'prompt')
  if (color) constraints.primaryColor = hardString(color, stringArg(args, params, 'primaryColor', 'color') ? 'args' : 'prompt')
  return constraints
}

function shapeColor(shape: PrimitiveShapeInput): string | undefined {
  return shape.material?.properties?.color
}

function isPrimaryShape(shape: PrimitiveShapeInput, family: AssemblyObjectFamily): boolean {
  if (family === 'vehicle') return shape.semanticRole === 'vehicle_body'
  if (family === 'outdoor_ac') return shape.semanticRole === 'rounded_machine_body'
  if (family === 'machine_tool') return shape.semanticRole === 'machine_enclosure'
  if (family === 'distillation_tower') return shape.semanticRole === 'distillation_column_shell'
  if (family === 'reactor') return shape.semanticRole === 'reactor_vessel_shell'
  if (family === 'compressor') return shape.semanticRole === 'compressor_casing' || shape.semanticRole === 'motor_body'
  if (family === 'grate_cooler') return shape.semanticRole === 'cooler_grate_bed'
  if (family === 'robot_arm') return shape.semanticRole === 'upper_arm' || shape.semanticRole === 'forearm'
  return /body|shell|enclosure|cabinet|tank|frame/.test(
    `${shape.semanticRole ?? ''} ${shape.sourcePartKind ?? ''} ${shape.name ?? ''}`,
  )
}

export function materialFromColor(color?: string): PrimitiveMaterialInput | undefined {
  return color ? { properties: { color } } : undefined
}

function primaryDimension(shape: PrimitiveShapeInput, dimension: 'length' | 'width' | 'height'): number | undefined {
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
  if (constraints.length != null) {
    const candidates = shapes.filter((shape) => isPrimaryShape(shape, constraints.family))
    const actual =
      candidates[0] && constraints.family === 'distillation_tower'
        ? primaryDimension(candidates[0], 'length')
        : candidates[0]?.length
    if (typeof actual === 'number' && Math.abs(actual - constraints.length.value) > Math.max(0.03, constraints.length.value * 0.04)) {
      issues.push(`Hard constraint failed: expected primary length ${constraints.length.value}m, got ${actual}m.`)
    }
  }
  if (constraints.family === 'distillation_tower' && constraints.width != null) {
    const candidates = shapes.filter((shape) => isPrimaryShape(shape, constraints.family))
    const actual = candidates[0] ? primaryDimension(candidates[0], 'width') : undefined
    if (typeof actual === 'number' && Math.abs(actual - constraints.width.value) > Math.max(0.03, constraints.width.value * 0.04)) {
      issues.push(`Hard constraint failed: expected primary width ${constraints.width.value}m, got ${actual}m.`)
    }
  }
  if (constraints.family === 'distillation_tower' && constraints.height != null) {
    const candidates = shapes.filter((shape) => isPrimaryShape(shape, constraints.family))
    const actual = candidates[0] ? primaryDimension(candidates[0], 'height') : undefined
    if (typeof actual === 'number' && Math.abs(actual - constraints.height.value) > Math.max(0.03, constraints.height.value * 0.04)) {
      issues.push(`Hard constraint failed: expected primary height ${constraints.height.value}m, got ${actual}m.`)
    }
  }
  if (constraints.primaryColor) {
    const candidates = shapes.filter((shape) => isPrimaryShape(shape, constraints.family))
    const actual = candidates.map(shapeColor).find(Boolean)
    if (actual && actual.toLowerCase() !== constraints.primaryColor.value.toLowerCase()) {
      issues.push(`Hard constraint failed: expected primary color ${constraints.primaryColor.value}, got ${actual}.`)
    }
  }
  return { ok: issues.length === 0, issues }
}
