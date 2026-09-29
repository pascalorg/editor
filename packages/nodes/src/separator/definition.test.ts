import { expect, test } from 'bun:test'
import {
  canHostSurfaceChild,
  getSelectableKinds,
  isRegistryMovable,
  isRegistrySelectable,
  nodeRegistry,
  registerNode,
} from '@pascal-app/core'
import { separatorDefinition } from './definition'

test('separator registers selectable dashed plan and 3D renderers, without movement or baking', () => {
  const restore = nodeRegistry._snapshot()
  try {
    registerNode(separatorDefinition)
    expect(isRegistrySelectable('separator')).toBe(true)
    expect(getSelectableKinds()).toContain('separator')
    expect(isRegistryMovable('separator')).toBe(false)
    expect(separatorDefinition.renderer?.kind).toBe('parametric')
    expect(separatorDefinition.geometry).toBeUndefined()
    expect(separatorDefinition.floorplan).toBeFunction()
    expect(separatorDefinition.dirtyTracking).toBe(false)
    expect(separatorDefinition.bake).toBe('strip')
    const node = separatorDefinition.schema.parse(separatorDefinition.defaults())
    expect(node.type).toBe('separator')
    expect(separatorDefinition.floorplan!(node, {} as never)).toMatchObject({
      kind: 'line',
      strokeDasharray: '6 4',
      pointerEvents: 'stroke',
    })
    expect(canHostSurfaceChild(node, 'item')).toBe(false)
    expect(node).not.toHaveProperty('thickness')
  } finally {
    restore()
  }
})
