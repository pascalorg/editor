import { describe, expect, it } from 'bun:test'
import { DoorNode } from '@pascal-app/core'
import { doorGlazingStyle, doorStyleFromIfcOperation } from '../src/door-semantics'

function door(overrides: Record<string, unknown> = {}) {
  return DoorNode.parse({
    object: 'node',
    id: 'door_test',
    type: 'door',
    name: 'Door',
    parentId: null,
    visible: true,
    ...overrides,
  })
}

describe('IFC door semantics', () => {
  it('maps double sliding doors from IfcDoor.OperationType', () => {
    expect(doorStyleFromIfcOperation('DOUBLE_DOOR_SLIDING')).toMatchObject({
      doorType: 'sliding',
      leafCount: 2,
      slideDirection: 'left',
      trackStyle: 'visible',
      threshold: false,
    })
  })

  it('preserves the standardized sliding direction', () => {
    expect(doorStyleFromIfcOperation('SLIDING_TO_RIGHT')).toMatchObject({
      doorType: 'sliding',
      leafCount: 1,
      slideDirection: 'right',
    })
  })

  it('turns a glazed double hinged door into a French door', () => {
    const style = doorStyleFromIfcOperation('DOUBLE_DOOR_SINGLE_SWING')
    const glazing = doorGlazingStyle(door(style), 0.75)

    expect(glazing.doorType).toBe('french')
    expect(glazing.segments).toEqual([expect.objectContaining({ type: 'glass', heightRatio: 1 })])
  })

  it('does not infer glazing when the IFC property is absent or zero', () => {
    expect(doorGlazingStyle(door(), undefined)).toEqual({})
    expect(doorGlazingStyle(door(), 0)).toEqual({})
  })
})
