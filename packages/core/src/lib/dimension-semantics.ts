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

const UNIT_PATTERN = '(mm|\u6beb\u7c73|cm|\u5398\u7c73|m|\u7c73|meter|meters|metre|metres)?'
const NUMBER_PATTERN =
  '(\\d+(?:\\.\\d+)?|[\u96f6\u4e00\u4e8c\u4e24\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e]+)'
const CHINESE_DIGITS: Record<string, number> = {
  '\u96f6': 0,
  '\u4e00': 1,
  '\u4e8c': 2,
  '\u4e24': 2,
  '\u4e09': 3,
  '\u56db': 4,
  '\u4e94': 5,
  '\u516d': 6,
  '\u4e03': 7,
  '\u516b': 8,
  '\u4e5d': 9,
}

function normalizeText(text: string): string {
  return text
    .replace(/[\uff0c\u3001]/g, ',')
    .replace(/[\u3002]/g, '.')
    .replace(/[\uff1b]/g, ';')
    .replace(/[\uff1a]/g, ':')
    .replace(/[\u00d7]/g, 'x')
    .replace(/\uff08/g, '(')
    .replace(/\uff09/g, ')')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseChineseInteger(value: string): number | undefined {
  if (
    !/[\u96f6\u4e00\u4e8c\u4e24\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e]/.test(value)
  )
    return undefined
  if (!value.includes('\u5341') && !value.includes('\u767e')) return CHINESE_DIGITS[value]

  let total = 0
  const [hundredHead, hundredTail = ''] = value.split('\u767e')
  if (value.includes('\u767e')) {
    total += (hundredHead ? (CHINESE_DIGITS[hundredHead] ?? 1) : 1) * 100
  }
  const target = value.includes('\u767e') ? hundredTail : value
  if (!target) return total
  const [tenHead, tenTail = ''] = target.split('\u5341')
  if (target.includes('\u5341')) {
    total += (tenHead ? (CHINESE_DIGITS[tenHead] ?? 1) : 1) * 10
    if (tenTail) total += CHINESE_DIGITS[tenTail] ?? 0
    return total
  }
  return total + (CHINESE_DIGITS[target] ?? 0)
}

function parseNumber(value: string): number | undefined {
  const numeric = Number(value)
  if (Number.isFinite(numeric)) return numeric
  return parseChineseInteger(value)
}

function toMeters(value: number, unit: string | undefined): number {
  const normalizedUnit = unit?.toLowerCase()
  if (normalizedUnit === 'mm' || unit === '\u6beb\u7c73') return value / 1000
  if (normalizedUnit === 'cm' || unit === '\u5398\u7c73') return value / 100
  if (
    normalizedUnit === 'm' ||
    normalizedUnit === 'meter' ||
    normalizedUnit === 'meters' ||
    normalizedUnit === 'metre' ||
    normalizedUnit === 'metres' ||
    unit === '\u7c73'
  ) {
    return value
  }

  if (value >= 20) return value / 100
  return value
}

function parseValue(value: string, unit: string | undefined, sharedUnit?: string): number {
  return toMeters(parseNumber(value) ?? Number.NaN, unit || sharedUnit)
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
    [
      'length',
      new RegExp(
        `(?:\u957f\u5ea6|\u957f|length|long|\\bl\\b)\\s*[:=]?\\s*${NUMBER_PATTERN}\\s*${UNIT_PATTERN}`,
        'gi',
      ),
    ],
    [
      'width',
      new RegExp(
        `(?:\u5bbd\u5ea6|\u5bbd|width|wide|\\bw\\b)\\s*[:=]?\\s*${NUMBER_PATTERN}\\s*${UNIT_PATTERN}`,
        'gi',
      ),
    ],
    [
      'depth',
      new RegExp(
        `(?:\u6df1\u5ea6|\u6df1|depth|deep|\\bd\\b)\\s*[:=]?\\s*${NUMBER_PATTERN}\\s*${UNIT_PATTERN}`,
        'gi',
      ),
    ],
    [
      'height',
      new RegExp(
        `(?:\u9ad8\u5ea6|\u9ad8|height|tall|\\bh\\b)\\s*[:=]?\\s*${NUMBER_PATTERN}\\s*${UNIT_PATTERN}`,
        'gi',
      ),
    ],
    [
      'diameter',
      new RegExp(
        `(?:\u76f4\u5f84|\u76f4\u5f91|diameter|dia|\u03c6|\u03a6)\\s*[:=]?\\s*${NUMBER_PATTERN}\\s*${UNIT_PATTERN}`,
        'gi',
      ),
    ],
    [
      'radius',
      new RegExp(
        `(?:\u534a\u5f84|\u534a\u5f91|radius|\\br\\b)\\s*[:=]?\\s*${NUMBER_PATTERN}\\s*${UNIT_PATTERN}`,
        'gi',
      ),
    ],
    [
      'thickness',
      new RegExp(
        `(?:\u539a\u5ea6|\u539a|thickness|\\bt\\b)\\s*[:=]?\\s*${NUMBER_PATTERN}\\s*${UNIT_PATTERN}`,
        'gi',
      ),
    ],
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

function objectText(input: {
  category?: unknown
  name?: unknown
  model?: unknown
  style?: unknown
}): string {
  return `${input.category ?? ''} ${input.name ?? ''} ${input.model ?? ''} ${input.style ?? ''}`.toLowerCase()
}

function isVehicleLike(input: {
  category?: unknown
  name?: unknown
  model?: unknown
  style?: unknown
}): boolean {
  return /(vehicle|car|sedan|suv|truck|\u6c7d\u8f66|\u8f66\u8f86)/i.test(objectText(input))
}

function isFurnitureLike(input: {
  category?: unknown
  name?: unknown
  model?: unknown
  style?: unknown
}): boolean {
  return /(table|desk|chair|sofa|shelf|cabinet|monitor|keyboard|ac|\u684c|\u4e66\u684c|\u67dc|\u6c99\u53d1)/i.test(
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
    if (dimensions.depth !== undefined && dimensions.length === undefined)
      next.length = dimensions.depth
    if (dimensions.width !== undefined) next.width = dimensions.width
    return next
  }

  if (isFurnitureLike(input)) {
    if (dimensions.length !== undefined) next.width = dimensions.length
    else if (dimensions.width !== undefined) next.width = dimensions.width

    if (dimensions.depth !== undefined) next.depth = dimensions.depth
    else if (dimensions.length !== undefined && dimensions.width !== undefined)
      next.depth = dimensions.width
    return next
  }

  if (dimensions.length !== undefined) next.length = dimensions.length
  if (dimensions.width !== undefined) next.width = dimensions.width
  if (dimensions.depth !== undefined) next.depth = dimensions.depth
  return next
}
