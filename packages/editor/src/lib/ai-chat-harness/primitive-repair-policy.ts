import { planGeometryCapabilities } from './capability-planner'

export const SIMPLE_PRIMITIVE_REPAIR_CALL_BUDGET = 1
export const DEFAULT_PRIMITIVE_REPAIR_CALL_BUDGET = 2
export const COMPLEX_PRIMITIVE_REPAIR_CALL_BUDGET = 3
export const DEFAULT_PRIMITIVE_REPAIR_STAGNATION_LIMIT = 2

export type PrimitiveRepairBudgetInput = {
  userPrompt: string
  harnessContext?: string
  hasRevisionTarget?: boolean
}

export type PrimitiveRepairRetryMessage = {
  role: string
  content: string
}

export type PrimitiveRepairStagnationState = {
  bestIssueCount: number
  lastFailureSignature: string
  lastFailureResults: string[]
  stagnantAttempts: number
}

export const INITIAL_PRIMITIVE_REPAIR_STAGNATION_STATE: PrimitiveRepairStagnationState = {
  bestIssueCount: Number.POSITIVE_INFINITY,
  lastFailureSignature: '',
  lastFailureResults: [],
  stagnantAttempts: 0,
}

const SIMPLE_ONE_SHAPE_TERMS = [
  'box',
  'cube',
  'cuboid',
  'cylinder',
  'sphere',
  'ball',
  'cone',
  'torus',
  'ring',
  '盒子',
  '方块',
  '立方体',
  '长方体',
  '圆柱',
  '圆筒',
  '球',
  '圆锥',
  '圆环',
]

const COMPLEX_TERMS = [
  'assembly',
  'vehicle',
  'car',
  'fan',
  'pump',
  'conveyor',
  'tank',
  'tower',
  'reactor',
  'compressor',
  'grate cooler',
  'machine tool',
  'robot arm',
  'aircraft',
  '工厂',
  '设备',
  '汽车',
  '风扇',
  '泵',
  '输送机',
  '储罐',
  '塔',
  '反应',
  '压缩机',
  '机床',
  '机器人',
  '飞机',
]

function includesAny(text: string, terms: readonly string[]) {
  return terms.some((term) => text.includes(term))
}

function compactText(value: string, limit: number) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= limit) return normalized
  return `${normalized.slice(0, limit)} ...<truncated ${normalized.length - limit} chars>`
}

function isTooComplexFailure(failureResults: readonly string[]): boolean {
  return failureResults.some((r) =>
    /too complex|shape.*(limit|limit is)|limit is \d+ shape/i.test(r),
  )
}

function extractShapeCount(failureResults: readonly string[]): number {
  for (const result of failureResults) {
    const match = result.match(/generated\s+(\d+)\s+shape/i)
    if (match?.[1]) return parseInt(match[1], 10)
  }
  return Infinity
}

function normalizeFailureText(value: string) {
  return (
    value
      .toLowerCase()
      // Keep shape counts as-is so "115 shapes" vs "81 shapes" are treated as different signatures
      // (normalizing all numbers would make stagnation mis-fire when shape count is decreasing)
      .replace(/"[^"]+"/g, '"<quoted>"')
      .replace(/\s+/g, ' ')
      .trim()
  )
}

export function primitiveRepairFailureSignature(failureResults: readonly string[]) {
  return failureResults.map(normalizeFailureText).filter(Boolean).join('\n').slice(0, 1600)
}

export function primitiveRepairIssueCount(failureResults: readonly string[]) {
  const issueLines = failureResults
    .join('\n')
    .split(/\r?\n/)
    .filter((line) => /^\s*(-|warning:|recommendation:)/i.test(line))
  return Math.max(1, issueLines.length)
}

export function nextPrimitiveRepairStagnationState(
  state: PrimitiveRepairStagnationState,
  failureResults: readonly string[],
): PrimitiveRepairStagnationState {
  const signature = primitiveRepairFailureSignature(failureResults)
  const issueCount = primitiveRepairIssueCount(failureResults)
  // For "too complex" errors, also treat a decreasing shape count as improvement
  const shapeCountImproved =
    isTooComplexFailure(failureResults) &&
    extractShapeCount(failureResults) < extractShapeCount(state.lastFailureResults ?? [])
  const improved = issueCount < state.bestIssueCount || shapeCountImproved
  const repeated = Boolean(signature) && signature === state.lastFailureSignature
  return {
    bestIssueCount: improved ? issueCount : state.bestIssueCount,
    lastFailureSignature: signature,
    lastFailureResults: [...failureResults],
    stagnantAttempts: improved ? 0 : repeated ? state.stagnantAttempts + 1 : state.stagnantAttempts,
  }
}

export function primitiveRepairCallBudget({
  userPrompt,
  harnessContext = '',
  hasRevisionTarget = false,
}: PrimitiveRepairBudgetInput) {
  if (hasRevisionTarget || harnessContext.includes('Latest generated geometry artifact')) {
    return COMPLEX_PRIMITIVE_REPAIR_CALL_BUDGET
  }

  const text = `${userPrompt} ${harnessContext}`.toLowerCase()
  const capabilityPlan = planGeometryCapabilities(userPrompt)
  if (capabilityPlan.route === 'assembly' || capabilityPlan.route === 'mixer_parts') {
    return COMPLEX_PRIMITIVE_REPAIR_CALL_BUDGET
  }

  if (includesAny(text, COMPLEX_TERMS)) {
    return COMPLEX_PRIMITIVE_REPAIR_CALL_BUDGET
  }

  if (includesAny(text, SIMPLE_ONE_SHAPE_TERMS)) {
    return SIMPLE_PRIMITIVE_REPAIR_CALL_BUDGET
  }

  return DEFAULT_PRIMITIVE_REPAIR_CALL_BUDGET
}

export function primitiveToolExecutionAttemptLimit(input: PrimitiveRepairBudgetInput) {
  return 1 + primitiveRepairCallBudget(input)
}

export function buildPrimitiveRepairRetryMessages<T extends PrimitiveRepairRetryMessage>({
  baseMessages,
  repairCallNumber,
  repairCallBudget,
  failedToolSummary,
  failureResults,
}: {
  baseMessages: readonly T[]
  repairCallNumber: number
  repairCallBudget: number
  failedToolSummary: string
  failureResults: readonly string[]
}): T[] {
  const compactFailures = failureResults
    .slice(-4)
    .map((result, index) => `${index + 1}. ${compactText(result, 900)}`)
    .join('\n')

  const tooComplex = isTooComplexFailure(failureResults)
  const shapeCount = extractShapeCount(failureResults)

  const guidance = tooComplex
    ? [
        `The object has too many shapes (${shapeCount} generated, limit is 80). Reduce complexity:`,
        '- Merge repeated small details into a single array shape or remove them entirely.',
        '- Replace window strips with a single wide window panel instead of individual windows.',
        '- For aircraft, prefer compose_parts with parts:[{kind:"aircraft_fuselage"}] and let aircraft defaults add wings, engines, tail, windows, and landing gear.',
        '- Use 2-3 blades instead of 4+; use one aircraft_landing_gear part instead of separate wheel/strut assemblies.',
        '- Drop non-essential decorative parts (bolts, seams, warning labels, detailed fins).',
        '- Aim for 30-60 shapes total for a complex object like an aircraft.',
        'Return one simplified compose_parts call with fewer parts.',
      ].join('\n')
    : 'Return one complete replacement geometry tool call. Do not repeat the same invalid call.'

  return [
    ...baseMessages,
    {
      role: 'user',
      content: [
        `Repair attempt ${repairCallNumber} of ${repairCallBudget}.`,
        'The previous geometry tool call failed validation or execution.',
        '',
        'Failed tool call summary:',
        compactText(failedToolSummary, 1200) || 'No geometry tool call was selected.',
        '',
        'Failure results:',
        compactFailures || 'No failure details were returned.',
        '',
        guidance,
      ].join('\n'),
    } as T,
  ]
}
