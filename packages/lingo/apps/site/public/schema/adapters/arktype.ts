// Ready-made ArkType schema for lingo's v3 wire JSON (@pascal-app/lingo).
// Generated from @pascal-app/lingo/schema — see docs. Validate JSON.stringify(lingo(...)).
import { type } from 'arktype'

export const span = type({ start: 'number.integer', end: 'number.integer', text: 'string' })
export const issue = type({
  code: 'string',
  severity: "'error' | 'warning' | 'info'",
  message: 'string',
  'span?': span,
  'suggestions?': 'string[]',
  'data?': 'Record<string, unknown>',
})
const bound = type({ value: 'number', unit: 'string', base: 'number', 'exclusive?': 'boolean' })
const ok = { schemaVersion: '3', ok: 'true', text: 'string', span, issues: issue.array(), confidence: 'number' }

export const quantity = type({ ...ok, type: "'quantity'", kind: 'string', value: 'number', unit: 'string', base: 'number', baseUnit: 'string', 'parts?': type({ value: 'number', unit: 'string' }).array(), 'approximate?': 'boolean' })
export const range = type({ ...ok, type: "'range'", kind: 'string', baseUnit: 'string', 'min?': bound, 'max?': bound, 'plusMinus?': type({ center: bound, delta: bound }), 'approximate?': 'boolean' })
export const conversion = type({ ...ok, type: "'conversion'", kind: 'string', source: 'Record<string, unknown>', converted: 'Record<string, unknown>' })
export const numberResult = type({ ...ok, type: "'number'", value: 'number', 'approximate?': 'boolean' })
export const failure = type({ schemaVersion: '3', ok: 'false', type: "'failure'", text: 'string', 'span?': span, issues: issue.array(), 'candidate?': 'Record<string, unknown>' })

export const lingoResult = quantity.or(range).or(conversion).or(numberResult).or(failure)
