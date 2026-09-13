import { describe, expect, test } from 'bun:test'
import { servicePointDefinition } from '../service-point/definition'
import {
  DEFAULT_BURIAL_DEPTH,
  DEFAULT_POLE_HEIGHT,
  DEFAULT_SAG_RATIO,
  SERVICE_POINT_ABBR,
  SERVICE_POINT_KINDS,
  SERVICE_POINT_LABEL,
  SERVICE_POINT_SYSTEM,
  ServicePointNode,
  SYSTEM_COLOR,
  SYSTEM_LETTER,
  UTILITY_SYSTEMS,
  UtilityLineNode,
  UtilityPoleNode,
} from '../schema'
import { utilityLineDefinition } from '../utility-line/definition'
import { utilityPoleDefinition } from '../utility-pole/definition'

describe('schema defaults', () => {
  test('a bare utility line parses with the documented defaults', () => {
    const line = UtilityLineNode.parse({})
    expect(line.type).toBe('utility-line')
    expect(line.id.startsWith('utilln_')).toBe(true)
    expect(line.system).toBe('power')
    expect(line.routing).toBe('underground')
    expect(line.path).toEqual([])
    expect(line.sizeInches).toBeNull()
    expect(line.material).toBeNull()
    expect(line.fromRef).toBeNull()
    expect(line.toRef).toBeNull()
    expect(line.sagRatio).toBe(DEFAULT_SAG_RATIO)
    expect(DEFAULT_SAG_RATIO).toBe(0.015)
  })

  test('a bare pole is 35 ft above grade', () => {
    const pole = UtilityPoleNode.parse({})
    expect(pole.type).toBe('utility-pole')
    expect(pole.height).toBe(DEFAULT_POLE_HEIGHT)
    // 35 ft × 0.3048 = 10.668 m exactly.
    expect(DEFAULT_POLE_HEIGHT).toBeCloseTo(35 * 0.3048, 12)
    expect(pole.hasTransformer).toBe(false)
    expect(pole.guy).toBe('none')
  })

  test('a bare service point is a free-standing electric meter', () => {
    const point = ServicePointNode.parse({})
    expect(point.serviceKind).toBe('electric-meter')
    expect(point.wallId).toBeNull()
    expect(point.wallT).toBeNull()
    expect(point.position).toEqual([0, 0, 0])
    expect(point.height).toBe(1.5)
  })

  test('the default burial depth is negative — depth is stored as elevation', () => {
    expect(DEFAULT_BURIAL_DEPTH).toBeLessThan(0)
  })

  test('sag is clamped to the schema range', () => {
    expect(UtilityLineNode.safeParse({ sagRatio: -0.1 }).success).toBe(false)
    expect(UtilityLineNode.safeParse({ sagRatio: 0.5 }).success).toBe(false)
    expect(UtilityLineNode.safeParse({ sagRatio: 0 }).success).toBe(true)
  })

  test('wallT is constrained to 0..1', () => {
    expect(ServicePointNode.safeParse({ wallT: 1.4 }).success).toBe(false)
    expect(ServicePointNode.safeParse({ wallT: 0.4 }).success).toBe(true)
  })

  test('every system has a colour and a plan letter', () => {
    for (const system of UTILITY_SYSTEMS) {
      expect(SYSTEM_COLOR[system]).toMatch(/^#[0-9a-f]{6}$/)
      expect(SYSTEM_LETTER[system]).toHaveLength(1)
    }
    // Plan letters must be distinguishable from each other.
    expect(new Set(Object.values(SYSTEM_LETTER)).size).toBe(UTILITY_SYSTEMS.length)
  })

  test('every service-point kind has a label, an abbreviation and a system', () => {
    for (const kind of SERVICE_POINT_KINDS) {
      expect(SERVICE_POINT_LABEL[kind]).toBeTruthy()
      expect(SERVICE_POINT_ABBR[kind]).toBeTruthy()
      expect(UTILITY_SYSTEMS).toContain(SERVICE_POINT_SYSTEM[kind])
    }
  })

  test('each definition default round-trips through its own schema', () => {
    expect(UtilityLineNode.safeParse(utilityLineDefinition.defaults()).success).toBe(true)
    expect(UtilityPoleNode.safeParse(utilityPoleDefinition.defaults()).success).toBe(true)
    expect(ServicePointNode.safeParse(servicePointDefinition.defaults()).success).toBe(true)
  })

  test('all three kinds are building-scoped in the floor plan', () => {
    for (const definition of [
      utilityLineDefinition,
      utilityPoleDefinition,
      servicePointDefinition,
    ]) {
      expect(definition.floorplanScope).toBe('building')
      expect(typeof definition.floorplan).toBe('function')
      expect(definition.renderer).toBeTruthy()
    }
  })
})
