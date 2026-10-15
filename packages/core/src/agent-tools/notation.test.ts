import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { NOT_LENGTHS, NOTATION_CASES } from '../agent-operations/__fixtures__/notation-cases'
import { HOSTED_SERVICE_TOOL_CONTRACTS } from './hosted-services'
import {
  AGENT_TOOL_CONTRACTS,
  type AgentToolContract,
  measurement,
  roofPitch,
  straightenFacadePhotoTool,
} from './index'

const CONTRACTS: readonly AgentToolContract[] = [
  ...AGENT_TOOL_CONTRACTS,
  ...HOSTED_SERVICE_TOOL_CONTRACTS,
  straightenFacadePhotoTool,
]

const contract = (name: string) => CONTRACTS.find((candidate) => candidate.name === name)!

function unwrap(schema: z.ZodType): z.ZodType {
  if (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodDefault
  )
    return unwrap(schema.unwrap() as z.ZodType)
  return schema
}

/** The schema of one field, by its path: `patch.thickness`, `faces[].rows[].height`. */
function fieldOf(tool: string, path: string): z.ZodType {
  let schema: z.ZodType = z.object(contract(tool).input)
  for (const step of path.split('.')) {
    const [name, ...arrays] = step.split('[]')
    schema = (unwrap(schema) as z.ZodObject).shape[name!] as z.ZodType
    for (const _ of arrays) schema = (unwrap(schema) as z.ZodArray<z.ZodType>).element
  }
  return schema
}

type JsonSchema = {
  type?: string | string[]
  const?: unknown
  anyOf?: JsonSchema[]
  properties?: Record<string, JsonSchema>
  items?: JsonSchema
  additionalProperties?: JsonSchema | boolean
}

/** The paths of the plain numbers a schema takes by name (not in a list, not whole numbers). */
function namedNumbers(schema: JsonSchema, path: string): string[] {
  if (schema.anyOf) return schema.anyOf.flatMap((branch) => namedNumbers(branch, path))
  const types = [schema.type ?? []].flat()
  if (types.includes('number'))
    return types.includes('string') || schema.const !== undefined ? [] : [path]
  const fields = Object.entries(schema.properties ?? {}).flatMap(([key, field]) =>
    namedNumbers(field, path ? `${path}.${key}` : key),
  )
  const items = schema.items?.properties ? namedNumbers(schema.items, `${path}[]`) : []
  const values =
    typeof schema.additionalProperties === 'object'
      ? namedNumbers(schema.additionalProperties, `${path}{}`)
      : []
  return [...fields, ...items, ...values]
}

describe('one notation (N1): each length, angle and pitch reads in its own unit or any other', () => {
  for (const row of NOTATION_CASES)
    for (const [sent, received] of row.readings)
      test(`${row.tool}.${row.field}: ${JSON.stringify(sent)} → ${received}`, () => {
        expect(fieldOf(row.tool, row.field).parse(sent) as number).toBeCloseTo(received, 9)
      })
})

test('every other number a shared tool takes by name is a coordinate, a fraction or a ratio', () => {
  const plain = CONTRACTS.flatMap((tool) =>
    namedNumbers(z.toJSONSchema(z.object(tool.input), { io: 'input' }) as JsonSchema, '').map(
      (path) => `${tool.name}.${path}`,
    ),
  )
  expect(plain.filter((path) => !NOT_LENGTHS.has(path))).toEqual([])
  expect([...NOT_LENGTHS].filter((path) => !plain.includes(path))).toEqual([])
})

describe('roofPitch', () => {
  const degrees = roofPitch('deg', { min: 0, max: 85 })
  const twelfths = roofPitch('twelfths')

  test('a bare number is in the field’s unit', () => {
    expect(degrees.parse(30)).toBe(30)
    expect(degrees.parse('30')).toBe(30)
    expect(twelfths.parse(8)).toBe(8)
    expect(twelfths.parse('8')).toBe(8)
  })

  test('rise over run and degrees read in either unit', () => {
    for (const said of ['6:12', '6/12', '6 in 12', '6-in-12', '6 on 12', '6:12 pitch', '3:6'])
      expect(twelfths.parse(said)).toBe(6)
    expect(twelfths.parse('45°')).toBeCloseTo(12, 9)
    expect(twelfths.parse('26.565051177078 deg')).toBeCloseTo(6, 9)
    expect(degrees.parse('4.5:12')).toBeCloseTo(20.556045219583, 9)
  })

  test('what is not a pitch is refused with a message the model can act on', () => {
    for (const [schema, said, words] of [
      [degrees, 'steep', 'rise per 12'],
      [twelfths, '6:0', 'no run'],
      [twelfths, '90°', 'under 90°'],
      [degrees, '90°', 'at most 85'],
      [degrees, '-1', 'at least 0'],
    ] as const) {
      const parsed = schema.safeParse(said)
      expect(parsed.success).toBe(false)
      expect(parsed.error?.issues[0]?.message).toContain(words)
    }
  })

  test('its JSON schema is a number or a string, with both ways to say it', () => {
    const schema = z.toJSONSchema(twelfths, { io: 'input' }) as JsonSchema & {
      description: string
    }
    expect([schema.type ?? []].flat().sort()).toEqual(['number', 'string'])
    expect(schema.description).toContain('"6:12"')
    expect(schema.description).toContain('"26.6°"')
  })
})

test('measurement in inches and feet reads other units without float noise', () => {
  expect(measurement('length', 'in').parse('6')).toBe(6)
  expect(measurement('length', 'in').parse('1.5 ft')).toBe(18)
  expect(measurement('length', 'in').parse('1 ft 6 in')).toBe(18)
  expect(measurement('length', 'ft').parse('72 in')).toBe(6)
  expect(measurement('length', 'm').parse('6 in')).toBe(0.1524)
  expect(z.toJSONSchema(measurement('length', 'in'), { io: 'input' }).description).toContain(
    'In inches, or text with a unit',
  )
})
