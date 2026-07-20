import { describe, expect, test } from 'bun:test'
import { structuralGridDefinition } from './definition'

describe('structuralGridDefinition', () => {
  test('registers as a floor-plan-only structural annotation', () => {
    expect(structuralGridDefinition.kind).toBe('structural-grid')
    expect(structuralGridDefinition.bake).toBe('strip')
    expect(structuralGridDefinition.dirtyTracking).toBe(false)
    expect(structuralGridDefinition.floorplan).toBeFunction()
    expect(structuralGridDefinition.capabilities.selectable).toBeDefined()
  })
})
