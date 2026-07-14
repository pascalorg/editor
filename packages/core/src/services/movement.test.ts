import { beforeEach, describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { nodeRegistry, registerNode } from '../registry/registry'
import type { AnyNodeDefinition, Capabilities, MovableConfig } from '../registry/types'
import type { AnyNode, AnyNodeId } from '../schema/types'
import { coerce } from '../test-utils'
import { applyAxisLock, isMovable, movePlanToward, moveToward, resolveMovable } from './movement'

const id = (s: string) => s as AnyNodeId

function makeDef(kind: string, capabilities: Capabilities = {}): AnyNodeDefinition {
  return {
    kind,
    schemaVersion: 1,
    schema: z.object({ type: z.literal(kind) }),
    category: 'utility',
    defaults: () => ({}),
    capabilities,
    renderer: { kind: 'parametric', module: async () => ({ default: () => null }) },
  }
}

function makeNode(kind: string, idStr: string): AnyNode {
  return coerce<AnyNode>({
    id: id(idStr),
    type: kind,
    parentId: null,
    visible: true,
  })
}

describe('resolveMovable', () => {
  beforeEach(() => {
    nodeRegistry._reset()
  })

  test('returns null when no def is registered', () => {
    expect(resolveMovable(makeNode('mystery', 'm'))).toBeNull()
  })

  test('returns null when def declares no movable capability', () => {
    registerNode(makeDef('static'))
    expect(resolveMovable(makeNode('static', 's'))).toBeNull()
  })

  test('returns the declared config', () => {
    registerNode(makeDef('column', { movable: { axes: ['x', 'z'], gridSnap: true } }))
    const config = resolveMovable(makeNode('column', 'c'))
    expect(config?.axes).toEqual(['x', 'z'])
    expect(config?.gridSnap).toBe(true)
  })

  test('runs override callback when present', () => {
    let overrideRan = false
    const config: MovableConfig = {
      axes: ['x'],
      override: () => {
        overrideRan = true
        return { axes: ['y'] }
      },
    }
    registerNode(makeDef('weird', { movable: config }))
    const resolved = resolveMovable(makeNode('weird', 'w'))
    expect(overrideRan).toBe(true)
    expect(resolved?.axes).toEqual(['y'])
  })

  test('override returning null falls back to base config', () => {
    registerNode(
      makeDef('column', {
        movable: { axes: ['x', 'z'], override: () => null },
      }),
    )
    const resolved = resolveMovable(makeNode('column', 'c'))
    expect(resolved?.axes).toEqual(['x', 'z'])
  })
})

describe('applyAxisLock', () => {
  test('passes through unlocked axes only', () => {
    expect(applyAxisLock([1, 2, 3], [10, 20, 30], ['x'])).toEqual([10, 2, 3])
    expect(applyAxisLock([1, 2, 3], [10, 20, 30], ['x', 'z'])).toEqual([10, 2, 30])
    expect(applyAxisLock([1, 2, 3], [10, 20, 30], ['x', 'y', 'z'])).toEqual([10, 20, 30])
  })

  test('empty lock returns current unchanged', () => {
    expect(applyAxisLock([1, 2, 3], [10, 20, 30], [])).toEqual([1, 2, 3])
  })
})

describe('moveToward', () => {
  beforeEach(() => {
    nodeRegistry._reset()
  })

  test('returns null when node is not movable', () => {
    registerNode(makeDef('static'))
    expect(moveToward(makeNode('static', 's'), [0, 0, 0], [1, 1, 1])).toBeNull()
  })

  test('axis-locks and returns the constrained target', () => {
    registerNode(makeDef('column', { movable: { axes: ['x', 'z'] } }))
    expect(moveToward(makeNode('column', 'c'), [0, 0.5, 0], [1, 99, 2])).toEqual([1, 0.5, 2])
  })

  test('applies grid snap when capability declares gridSnap: true', () => {
    registerNode(makeDef('column', { movable: { axes: ['x', 'z'], gridSnap: true } }))
    const result = moveToward(makeNode('column', 'c'), [0, 0, 0], [0.3, 0, 0.6], {
      gridStep: 0.25,
    })
    expect(result).toEqual([0.25, 0, 0.5])
  })

  test('grid snap can be overridden at call site', () => {
    registerNode(makeDef('column', { movable: { axes: ['x', 'z'], gridSnap: true } }))
    // Caller explicitly disables grid snap for this call
    const result = moveToward(makeNode('column', 'c'), [0, 0, 0], [0.3, 0, 0.6], {
      gridSnap: false,
    })
    expect(result).toEqual([0.3, 0, 0.6])
  })
})

describe('movePlanToward', () => {
  beforeEach(() => {
    nodeRegistry._reset()
  })

  test('returns 2D point with X/Z constrained, Y dropped', () => {
    registerNode(makeDef('column', { movable: { axes: ['x', 'z'], gridSnap: true } }))
    const result = movePlanToward(
      makeNode('column', 'c'),
      0.5, // currentY
      [0, 0],
      [0.3, 0.6],
      { gridStep: 0.25 },
    )
    expect(result).toEqual([0.25, 0.5])
  })

  test('returns null when node is not movable', () => {
    registerNode(makeDef('static'))
    expect(movePlanToward(makeNode('static', 's'), 0, [0, 0], [1, 1])).toBeNull()
  })
})

describe('isMovable', () => {
  beforeEach(() => {
    nodeRegistry._reset()
  })

  test('true when movable.axes has entries', () => {
    registerNode(makeDef('column', { movable: { axes: ['x'] } }))
    expect(isMovable(makeNode('column', 'c'))).toBe(true)
  })

  test('false when no movable capability', () => {
    registerNode(makeDef('static'))
    expect(isMovable(makeNode('static', 's'))).toBe(false)
  })

  test('false when movable.axes is empty', () => {
    registerNode(makeDef('locked', { movable: { axes: [] } }))
    expect(isMovable(makeNode('locked', 'l'))).toBe(false)
  })
})
