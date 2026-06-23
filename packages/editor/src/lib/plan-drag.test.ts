import { describe, expect, test } from 'bun:test'
import { AssemblyNode } from '@pascal-app/core'
import { getPlanDrag3DKinds, isPlanDragMovableNode } from './plan-drag'

describe('plan drag movement', () => {
  test('treats assembly roots as plan-movable generated objects', () => {
    const assembly = AssemblyNode.parse({
      id: 'assembly_generated_equipment',
      type: 'assembly',
      position: [0, 0, 0],
    })

    expect(getPlanDrag3DKinds()).toContain('assembly')
    expect(isPlanDragMovableNode(assembly)).toBe(true)
  })
})
