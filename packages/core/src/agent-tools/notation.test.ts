import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { NOT_LENGTHS, NOTATION_CASES } from '../agent-operations/__fixtures__/notation-cases'
import { HOSTED_SERVICE_TOOL_CONTRACTS } from './hosted-services'
import {
  AGENT_TOOL_CONTRACTS,
  type AgentToolContract,
  bareNumberPaths,
  fieldSchema,
  type MeasurementOptions,
  measurement,
  roofPitch,
  straightenFacadePhotoTool,
  unshownDefaultPaths,
} from './index'

const CONTRACTS: readonly AgentToolContract[] = [
  ...AGENT_TOOL_CONTRACTS,
  ...HOSTED_SERVICE_TOOL_CONTRACTS,
  straightenFacadePhotoTool,
]

const contract = (name: string) => CONTRACTS.find((candidate) => candidate.name === name)!

describe('one notation (N1): each length, angle and pitch reads in its own unit or any other', () => {
  for (const row of NOTATION_CASES)
    for (const [sent, received] of row.readings)
      test(`${row.tool}.${row.field}: ${JSON.stringify(sent)} → ${received}`, () => {
        expect(fieldSchema(contract(row.tool), row.field).parse(sent) as number).toBeCloseTo(
          received,
          9,
        )
      })
})

test('every other number a shared tool takes by name is a coordinate, a fraction or a ratio', () => {
  const plain = bareNumberPaths(CONTRACTS)
  expect(plain.filter((path) => !NOT_LENGTHS.has(path))).toEqual([])
  expect([...NOT_LENGTHS].filter((path) => !plain.includes(path))).toEqual([])
})

test('every default a shared tool fills in is shown to the model', () => {
  expect(unshownDefaultPaths(CONTRACTS)).toEqual([])
})

describe('roofPitch', () => {
  const degrees = roofPitch('deg', { min: 0, max: 85 })
  const twelfths = roofPitch('twelfths')

  test('a bare number is in the field’s unit', () => {
    expect(degrees.parse(30)).toBe(30)
    expect(degrees.parse('30')).toBe(30)
    expect(twelfths.parse(8)).toBe(8)
    expect(twelfths.parse('8')).toBe(8)
    expect(twelfths.parse('8e0')).toBe(8)
    expect(twelfths.parse('８')).toBe(8)
  })

  test('rise over run and degrees read in either unit', () => {
    for (const said of [
      '6:12',
      '6/12',
      '+6/12',
      '６／１２',
      '6 in 12',
      '6in12',
      '6-in-12',
      '6 on 12',
      '6:12 pitch',
      '3:6',
    ])
      expect(twelfths.parse(said)).toBe(6)
    expect(twelfths.parse('45°')).toBeCloseTo(12, 9)
    expect(twelfths.parse('26.565051177078 deg')).toBeCloseTo(6, 9)
    expect(degrees.parse('4.5:12')).toBeCloseTo(20.556045219583, 9)
    // A fraction of a degree is not undone by the full-width normalization.
    expect(degrees.parse('26¼°')).toBe(26.25)
    expect(degrees.parse('22½°')).toBe(22.5)
    expect(twelfths.parse('26¼°')).toBeCloseTo(5.917745112376, 9)
    // A huge rise and run still give their slope.
    const huge = `1${'0'.repeat(308)}`
    expect(degrees.parse(`${huge}:${huge}`)).toBe(45)
    expect(twelfths.parse(`${huge}:${huge}`)).toBe(12)
    // Degrees and minutes are an angle; minutes alone are not a pitch (below).
    expect(degrees.parse("26° 30'")).toBeCloseTo(26.5, 9)
  })

  test('what is not a pitch is refused with a message the model can act on', () => {
    for (const [schema, said, words] of [
      [degrees, 'steep', 'rise per 12'],
      // Without an angle unit the unit parser would read these as degrees: 6,0 as 6°, -6/12 as -0.5°.
      [twelfths, '6,0', 'rise per 12'],
      [degrees, '-6/12', 'rise per 12'],
      // Unicode folding would read 6² as 62.
      [twelfths, '6²:12', 'superscript'],
      [degrees, '6²°', 'superscript'],
      [twelfths, '6:0', 'no run'],
      // Inch and foot marks are a builder's rise per foot, never arcseconds and arcminutes.
      [twelfths, '6"', 'rise per 12'],
      [degrees, '6"', 'rise per 12'],
      [twelfths, '6/12"', 'rise per 12'],
      [twelfths, "4'", 'rise per 12'],
      [twelfths, '6″', 'rise per 12'],
      [degrees, '6 arcmin', 'rise per 12'],
      // A carpenter's quarter pitch is rise over span (6:12), not 1:4.
      [twelfths, '1/4 pitch', 'rise per 12'],
      [degrees, '1/2 pitch', 'rise per 12'],
      // Past the largest number, unequal operands would divide as 45°.
      [degrees, `1${'0'.repeat(309)}:2${'0'.repeat(309)}`, 'rise per 12'],
      [twelfths, `1${'0'.repeat(309)}:2${'0'.repeat(309)}`, 'rise per 12'],
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
    const schema = z.toJSONSchema(twelfths, { io: 'input' }) as {
      type: string[]
      description: string
    }
    expect([schema.type].flat().sort()).toEqual(['number', 'string'])
    expect(schema.description).toContain('"6:12"')
    expect(schema.description).toContain('"26.6°"')
  })

  test('a default fills a call that leaves it out and is stated in the description', () => {
    const pitch = roofPitch('twelfths', { default: 6 })
    expect(pitch.parse(undefined)).toBe(6)
    expect(pitch.parse('8:12')).toBe(8)
    expect(z.toJSONSchema(pitch, { io: 'input' }).description).toEndWith('Default 6:12.')
    expect(
      z.toJSONSchema(roofPitch('deg', { default: 40 }), { io: 'input' }).description,
    ).toEndWith('Default 40°.')
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
  const overhang = measurement('length', 'in', { default: 18 })
  expect(overhang.parse(undefined)).toBe(18)
  expect(z.toJSONSchema(overhang, { io: 'input' }).description).toEndWith('Default 18 in.')
  const asked: MeasurementOptions = { default: 18 }
  expect(measurement('length', 'in', asked).parse(undefined)).toBe(18)
})

test('the inventory finds a bare number, or a default the model is not shown, wherever it is', () => {
  const metres = measurement('length', 'm')
  const probe: AgentToolContract = {
    name: 'probe',
    title: 'Probe',
    description: '',
    input: {
      shown: measurement('length', 'm', { default: 0.3 }),
      plain: z.number().default(3),
      hidden: measurement('length', 'm').default(1),
      wrapped: measurement('length', 'in').default(18).optional(),
      nested: z.object({ depth: measurement('length', 'in').default(2) }).optional(),
      misstated: measurement('length', 'in').default(8).describe('Default 18 in.'),
      none: z.array(metres).default([]).describe('Lengths; by default none.'),
      rows: z.array(z.union([z.object({ height: z.number() }), z.object({ x: metres })])),
      kinds: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('step'), rise: z.number() }),
        z.object({ kind: z.literal('flat') }),
      ]),
      points: z.array(z.array(z.number())),
      choice: z.union([
        z.object({ data: z.object({ width: metres }) }),
        z.object({ data: z.object({ height: metres }) }),
      ]),
    },
  }
  expect(unshownDefaultPaths([probe]).sort()).toEqual([
    'probe.hidden',
    'probe.misstated',
    'probe.nested.depth',
    'probe.none',
    'probe.wrapped',
  ])
  expect(bareNumberPaths([probe]).sort()).toEqual([
    'probe.kinds.rise',
    'probe.plain',
    'probe.rows[].height',
  ])
  expect(fieldSchema(probe, 'choice.data.height').parse('1 ft')).toBe(0.3048)
})
