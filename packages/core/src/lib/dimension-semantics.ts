export interface DimensionSemantics {
  length?: number
  width?: number
  depth?: number
  height?: number
  diameter?: number
  radius?: number
  thickness?: number
}

interface DimensionMatch {
  key: keyof DimensionSemantics
  value: number
}

const UNIT_PATTERN = '(mm|毫米|cm|厘米|m|米|meter|meters|metre|metres)?'
const NUMBER_PATTERN = '(\\d+(?:\\.\\d+)?)'

function normalizeText(text: string): string {
  return text
    .replace(/[，。；：]/g, (char) => ({ '，': ',', '。': '.', '；': ';', '：': ':' })[char] ?? char)
    .replace(/[×＊]/g, 'x')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/\s+/g, ' ')
    .trim()
}

function toMeters(value: number, unit: string | undefined): number {
  const normalizedUnit = unit?.toLowerCase()
  if (normalizedUnit === 'mm' || unit === '毫米') return value / 1000
  if (normalizedUnit === 'cm' || unit === '厘米') return value / 100
  if (
    normalizedUnit === 'm' ||
    normalizedUnit === 'meter' ||
    normalizedUnit === 'meters' ||
    normalizedUnit === 'metre' ||
    normalizedUnit === 'metres' ||
    unit === '米'
  ) {
    return value
  }

  if (value >= 20) return value / 100
  return value
}

function parseValue(value: string, unit: string | undefined, sharedUnit?: string): number {
  return toMeters(Number(value), unit || sharedUnit)
}

function assignIfMissing(
  dimensions: DimensionSemantics,
  key: keyof DimensionSemantics,
  value: number,
): void {
  if (Number.isFinite(value) && value > 0 && dimensions[key] === undefined) {
    dimensions[key] = Number(value.toFixed(4))
  }
}

function labeledMatches(text: string): DimensionMatch[] {
  const patterns: Array<[keyof DimensionSemantics, RegExp]> = [
    ['length', new RegExp(`(?:长度|长|length|long|\\bl\\b)\\s*[:=]?\\s*${NUMBER_PATTERN}\\s*${UNIT_PATTERN}`, 'gi')],
    ['width', new RegExp(`(?:宽度|宽|width|\\bw\\b)\\s*[:=]?\\s*${NUMBER_PATTERN}\\s*${UNIT_PATTERN}`, 'gi')],
    ['depth', new RegExp(`(?:深度|深|depth|\\bd\\b)\\s*[:=]?\\s*${NUMBER_PATTERN}\\s*${UNIT_PATTERN}`, 'gi')],
    ['height', new RegExp(`(?:高度|高|height|\\bh\\b)\\s*[:=]?\\s*${NUMBER_PATTERN}\\s*${UNIT_PATTERN}`, 'gi')],
    ['diameter', new RegExp(`(?:直径|diameter|dia|φ|Φ)\\s*[:=]?\\s*${NUMBER_PATTERN}\\s*${UNIT_PATTERN}`, 'gi')],
    ['radius', new RegExp(`(?:半径|radius|\\br\\b)\\s*[:=]?\\s*${NUMBER_PATTERN}\\s*${UNIT_PATTERN}`, 'gi')],
    ['thickness', new RegExp(`(?:厚度|厚|thickness|\\bt\\b)\\s*[:=]?\\s*${NUMBER_PATTERN}\\s*${UNIT_PATTERN}`, 'gi')],
  ]
  const matches: DimensionMatch[] = []

  for (const [key, pattern] of patterns) {
    for (const match of text.matchAll(pattern)) {
      const rawValue = match[1]
      if (!rawValue) continue
      matches.push({ key, value: parseValue(rawValue, match[2]) })
    }
  }

  return matches
}

function applyCompactDimensions(text: string, dimensions: DimensionSemantics): void {
  const compactPattern = new RegExp(
    `${NUMBER_PATTERN}\\s*${UNIT_PATTERN}\\s*x\\s*${NUMBER_PATTERN}\\s*${UNIT_PATTERN}(?:\\s*x\\s*${NUMBER_PATTERN}\\s*${UNIT_PATTERN})?`,
    'gi',
  )

  for (const match of text.matchAll(compactPattern)) {
    const first = match[1]
    const firstUnit = match[2]
    const second = match[3]
    const secondUnit = match[4]
    const third = match[5]
    const thirdUnit = match[6]
    if (!first || !second) continue

    const sharedUnit = thirdUnit || secondUnit || firstUnit
    assignIfMissing(dimensions, 'length', parseValue(first, firstUnit, sharedUnit))
    assignIfMissing(dimensions, 'width', parseValue(second, secondUnit, sharedUnit))
    if (third) assignIfMissing(dimensions, 'height', parseValue(third, thirdUnit, sharedUnit))
    break
  }
}

export function parseDimensionSemantics(text: string | undefined): DimensionSemantics {
  if (!text) return {}
  const normalized = normalizeText(text)
  const dimensions: DimensionSemantics = {}

  for (const match of labeledMatches(normalized)) {
    assignIfMissing(dimensions, match.key, match.value)
  }
  applyCompactDimensions(normalized, dimensions)

  if (dimensions.diameter !== undefined && dimensions.radius === undefined) {
    assignIfMissing(dimensions, 'radius', dimensions.diameter / 2)
  }

  return dimensions
}

function objectText(input: { category?: unknown; name?: unknown; model?: unknown; style?: unknown }): string {
  return `${input.category ?? ''} ${input.name ?? ''} ${input.model ?? ''} ${input.style ?? ''}`.toLowerCase()
}

function isVehicleLike(input: { category?: unknown; name?: unknown; model?: unknown; style?: unknown }): boolean {
  return /(vehicle|car|sedan|suv|truck|汽车|车辆)/i.test(objectText(input))
}

function isFurnitureLike(input: { category?: unknown; name?: unknown; model?: unknown; style?: unknown }): boolean {
  return /(table|desk|chair|sofa|shelf|cabinet|monitor|keyboard|ac|桌|写字桌|书桌|椅|沙发|架|柜)/i.test(
    objectText(input),
  )
}

interface DimensionObjectInput {
  category?: string
  name?: string
  model?: string
  style?: string
  width?: number
  depth?: number
  length?: number
  height?: number
}

export function applyDimensionSemanticsToObjectInput<T extends DimensionObjectInput>(
  input: T,
  prompt: string | undefined,
): T & DimensionObjectInput {
  const dimensions = parseDimensionSemantics(prompt)
  if (Object.keys(dimensions).length === 0) return input

  const next = { ...input }
  if (dimensions.height !== undefined) next.height = dimensions.height

  if (isVehicleLike(input)) {
    if (dimensions.length !== undefined) next.length = dimensions.length
    if (dimensions.depth !== undefined && dimensions.length === undefined) next.length = dimensions.depth
    if (dimensions.width !== undefined) next.width = dimensions.width
    return next
  }

  if (isFurnitureLike(input)) {
    if (dimensions.length !== undefined) next.width = dimensions.length
    else if (dimensions.width !== undefined) next.width = dimensions.width

    if (dimensions.depth !== undefined) next.depth = dimensions.depth
    else if (dimensions.length !== undefined && dimensions.width !== undefined) next.depth = dimensions.width
    return next
  }

  if (dimensions.length !== undefined) next.length = dimensions.length
  if (dimensions.width !== undefined) next.width = dimensions.width
  if (dimensions.depth !== undefined) next.depth = dimensions.depth
  return next
}
