import { describe, expect, test } from 'bun:test'
import {
  type ConstructionScene,
  elementCategory,
  inspectConstruction,
  inventoryCsv,
} from './inventory'

const scene: ConstructionScene = {
  site: { id: 'site', type: 'site', name: 'Shared site' },
  houseA: { id: 'houseA', type: 'building', name: 'House A', parentId: 'site' },
  houseB: { id: 'houseB', type: 'building', name: 'House B', parentId: 'site' },
  levelA: { id: 'levelA', type: 'level', parentId: 'houseA' },
  levelB: { id: 'levelB', type: 'level', parentId: 'houseB' },
  wallA: { id: 'wallA', type: 'wall', name: 'Kitchen wall', parentId: 'levelA' },
  doorA: { id: 'doorA', type: 'door', parentId: 'wallA' },
  wallB: { id: 'wallB', type: 'wall', parentId: 'levelB' },
  drawing: { id: 'drawing', type: 'sheets:sheet', parentId: 'site' },
}

describe('construction inventory', () => {
  test('requires an explicit scope for multiple houses instead of combining their quantities', () => {
    const result = inspectConstruction(scene)
    expect(result.scopeRequired).toBe(true)
    expect(result.records).toEqual([])
  })

  test('follows ancestry through hosted objects and includes shared site context only once', () => {
    const before = JSON.stringify(scene)
    const result = inspectConstruction(scene, 'houseA')
    expect(result.records.map((record) => record.id).sort()).toEqual(['doorA', 'site', 'wallA'])
    expect(result.records.find((record) => record.id === 'doorA')).toMatchObject({
      buildingId: 'houseA',
      levelId: 'levelA',
    })
    expect(JSON.stringify(scene)).toBe(before)
  })

  test('does not export another building after the selected building is deleted', () => {
    const result = inspectConstruction(scene, 'deleted-house')
    expect(result.invalidScope).toBe(true)
    expect(result.records).toEqual([])
  })

  test('reports an empty scene without inventing elements', () => {
    expect(inspectConstruction({}).records).toEqual([])
    expect(inspectConstruction({}).scopeRequired).toBe(false)
  })

  test('reports unassigned records without mixing them into a building inventory', () => {
    const result = inspectConstruction(
      {
        ...scene,
        orphan: { id: 'orphan', type: 'wall', parentId: 'missing' },
      },
      'houseA',
    )
    expect(result.unscopedCount).toBe(1)
    expect(result.records.some((record) => record.id === 'orphan')).toBe(false)
    expect(result.unrecognizedCount).toBe(0)
  })

  test('keeps a scan as reference information and does not infer walls or systems', () => {
    const result = inspectConstruction({ scan: { id: 'scan', type: 'scan' } })
    expect(result.records).toHaveLength(1)
    expect(result.records[0]?.category).toBe('references')
  })

  test('handles incomplete and cyclic ancestry without mutating or hanging', () => {
    const nodes = Object.freeze({
      a: Object.freeze({ id: 'a', type: 'wall', parentId: 'b' }),
      b: Object.freeze({ id: 'b', type: 'door', parentId: 'a' }),
      c: Object.freeze({ id: 'c', type: 'pipe-segment', parentId: 'missing' }),
    })
    expect(inspectConstruction(nodes).records).toHaveLength(3)
  })

  test('distinguishes service disciplines and counts a framing settings record only once', () => {
    expect(elementCategory({ id: 'outlet', type: 'bones:device' })).toBe('electrical')
    expect(
      elementCategory({ id: 'heater', type: 'bones:service', serviceType: 'water-heater' }),
    ).toBe('plumbing')
    expect(elementCategory({ id: 'pump', type: 'bones:service', serviceType: 'heat-pump' })).toBe(
      'hvac',
    )
    expect(
      elementCategory({ id: 'unknown', type: 'bones:service', serviceType: 'unknown' }),
    ).toBeUndefined()
    expect(
      inspectConstruction({ framing: { id: 'framing', type: 'bones:framing' } }).records,
    ).toHaveLength(1)
  })

  test('keeps unfamiliar plugin records out of named categories and exposes their count', () => {
    const result = inspectConstruction({ custom: { id: 'custom', type: 'other:object' } })
    expect(result.records).toEqual([])
    expect(result.unrecognizedCount).toBe(1)
  })

  test('escapes spreadsheet formulas, quotes, commas and multiline user names', () => {
    const result = inspectConstruction({
      wall: { id: 'wall', type: 'wall', name: '=SUM(1,2)\n"Wall"' },
    })
    const csv = inventoryCsv(result.records)
    expect(csv).toContain('"\'=SUM(1,2)\n""Wall"""')
    expect(csv).toContain('"Spaces & building envelope"')
    expect(csv.endsWith('\r\n')).toBe(true)
  })
})
