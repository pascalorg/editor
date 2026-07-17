import { describe, expect, test } from 'bun:test'
import { measurementDefinition } from './definition'

describe('measurementDefinition', () => {
  test('registers a transient-free analysis annotation contract', () => {
    expect(measurementDefinition.kind).toBe('measurement')
    expect(measurementDefinition.category).toBe('analysis')
    expect(measurementDefinition.bake).toBe('strip')
    expect(measurementDefinition.snapProfile).toBe('structural')
    expect(measurementDefinition.dirtyTracking).toBe(false)
    expect(measurementDefinition.capabilities).toMatchObject({
      selectable: { hitVolume: 'bbox' },
      deletable: true,
      duplicable: true,
      presettable: false,
    })
    expect(typeof measurementDefinition.tool).toBe('function')
    expect(typeof measurementDefinition.affordanceTools?.selection).toBe('function')
    expect(typeof measurementDefinition.floorplanAffordances?.['move-measurement-vertex']).toBe(
      'object',
    )
    expect(measurementDefinition.presentation?.actionMenu).toBe(false)
    expect(measurementDefinition.parametrics).toBeUndefined()
    expect(measurementDefinition.toolHints?.map((hint) => hint.key)).toEqual([
      'Left click',
      'Enter',
      'Backspace',
      'Esc',
    ])
    expect(measurementDefinition.toolHints?.at(-1)?.label).toBe('Finish and continue')
  })

  test('produces schema-valid defaults', () => {
    expect(
      measurementDefinition.schema.safeParse({
        id: 'measurement_default',
        type: 'measurement',
        ...measurementDefinition.defaults(),
      }).success,
    ).toBe(true)
  })
})
