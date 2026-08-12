import { describe, expect, test } from 'bun:test'
import { InstanceNode } from '@pascal-app/core'
import { instanceDefinition } from './definition'

describe('instance definition', () => {
  test('registers the collective renderer and valid defaults', () => {
    expect(instanceDefinition.renderer?.kind).toBe('parametric')
    expect(instanceDefinition.system?.priority).toBe(3)
    expect(typeof instanceDefinition.floorplan).toBe('function')
    expect(instanceDefinition.dirtyTracking).not.toBe(false)
    expect(instanceDefinition.capabilities.movable).toEqual({ axes: ['x', 'z'], gridSnap: true })
    expect(
      InstanceNode.safeParse({
        ...instanceDefinition.defaults(),
        id: 'instance_default',
        type: 'instance',
      }).success,
    ).toBe(true)
  })
})
