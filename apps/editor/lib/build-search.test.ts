import { describe, expect, test } from 'bun:test'
import { searchBuildTools } from './build-search'

const tools = [
  { id: 'slab', label: 'Slab' },
  { id: 'hvac-equipment', label: 'HVAC Unit' },
  { id: 'room-rectangle', label: 'Rectangle room' },
  { id: 'room-polygon', label: 'Polygon room' },
  { id: 'skylight', label: 'Skylight' },
  { id: 'duct-segment', label: 'Duct' },
  { id: 'terrace', label: 'Terrace' },
]

describe('build tool search', () => {
  test('finds room shapes, roof accessories and MEP tools', () => {
    for (const [query, id] of [
      ['rectangle', 'room-rectangle'],
      ['skylight', 'skylight'],
      ['light', 'skylight'],
      ['duct', 'duct-segment'],
    ]) {
      expect(searchBuildTools(tools, query!).map((tool) => tool.id)).toEqual([id!])
    }
  })

  test('matches aliases, whitespace, casing and multiple words', () => {
    expect(searchBuildTools(tools, '  FLOOR  ')).toEqual([tools[0]!])
    expect(searchBuildTools(tools, 'AC')).toEqual([tools[1]!])
    expect(searchBuildTools(tools, 'air   conditioner')).toEqual([tools[1]!])
    expect(searchBuildTools(tools, 'room rect')).toEqual([tools[2]!])
    expect(searchBuildTools(tools, 'L-shaped room')).toEqual([tools[3]!])
    expect(searchBuildTools(tools, 'unknown tool')).toEqual([])
  })

  test('deduplicates shared tools and preserves their activation action', () => {
    let selected = ''
    const canopy = {
      id: 'canopy',
      label: 'Canopy',
      activate: () => {
        selected = 'canopy'
      },
    }
    const results = searchBuildTools([canopy, canopy], 'canopy')
    expect(results).toHaveLength(1)
    results[0]!.activate()
    expect(selected).toBe('canopy')
  })
})
