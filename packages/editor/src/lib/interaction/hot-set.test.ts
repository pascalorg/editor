import { describe, expect, test } from 'bun:test'
import type { AnyNode } from '@pascal-app/core'
import {
  type AttachClass,
  attachClassOf,
  type HotSetCandidate,
  isCandidateInHotSet,
  isPickableForAttach,
} from './hot-set'

const mockNode = (id: string, type: string): AnyNode => ({ id, type }) as unknown as AnyNode

const floor: HotSetCandidate = {
  type: 'level',
  isFloorLike: true,
  exposesTop: false,
  attachClass: 'surface',
}
const wall: HotSetCandidate = {
  type: 'wall',
  isFloorLike: false,
  exposesTop: false,
  attachClass: 'surface',
}
const ceiling: HotSetCandidate = {
  type: 'ceiling',
  isFloorLike: false,
  exposesTop: false,
  attachClass: 'surface',
}
const table: HotSetCandidate = {
  type: 'item',
  isFloorLike: false,
  exposesTop: true,
  attachClass: 'surface',
}
const wallShelf: HotSetCandidate = {
  type: 'shelf',
  isFloorLike: false,
  exposesTop: true,
  attachClass: 'wall',
}
const ceilingFan: HotSetCandidate = {
  type: 'item',
  isFloorLike: false,
  exposesTop: true,
  attachClass: 'ceiling',
}

describe('attachClassOf', () => {
  test('wall and wall-side collapse to wall', () => {
    expect(attachClassOf('wall')).toBe('wall')
    expect(attachClassOf('wall-side')).toBe('wall')
  })
  test('ceiling maps to ceiling', () => {
    expect(attachClassOf('ceiling')).toBe('ceiling')
  })
  test('undefined/null/unknown is surface-resting', () => {
    expect(attachClassOf(undefined)).toBe('surface')
    expect(attachClassOf(null)).toBe('surface')
    expect(attachClassOf('')).toBe('surface')
  })
})

describe('isPickableForAttach — wall-mounted (window)', () => {
  test('only walls are eligible; floor/ceiling/tops are not', () => {
    expect(isPickableForAttach('wall', wall)).toBe(true)
    expect(isPickableForAttach('wall', floor)).toBe(false)
    expect(isPickableForAttach('wall', ceiling)).toBe(false)
    expect(isPickableForAttach('wall', table)).toBe(false)
    expect(isPickableForAttach('wall', wallShelf)).toBe(false)
  })
})

describe('isPickableForAttach — ceiling-mounted', () => {
  test('only ceilings are eligible', () => {
    expect(isPickableForAttach('ceiling', ceiling)).toBe(true)
    expect(isPickableForAttach('ceiling', wall)).toBe(false)
    expect(isPickableForAttach('ceiling', floor)).toBe(false)
  })
})

describe('isPickableForAttach — surface-resting (sofa / cactus)', () => {
  test('floor is always eligible', () => {
    expect(isPickableForAttach('surface', floor)).toBe(true)
  })
  test('host tops (table, wall-shelf top) are eligible', () => {
    expect(isPickableForAttach('surface', table)).toBe(true)
    expect(isPickableForAttach('surface', wallShelf)).toBe(true)
  })
  test('a wall (no top surface) is not eligible', () => {
    expect(isPickableForAttach('surface', wall)).toBe(false)
  })
  test('a ceiling-mounted host (ceiling fan) is never eligible — Track E', () => {
    expect(isPickableForAttach('surface', ceilingFan)).toBe(false)
  })
})

describe('isCandidateInHotSet — by scope', () => {
  const surfaceClass: AttachClass = 'surface'
  test('idle: everything is in the hot-set (selection filtering lives elsewhere)', () => {
    expect(isCandidateInHotSet({ kind: 'idle' }, null, ceilingFan)).toBe(true)
  })
  test('placing a surface item: derives from attach class', () => {
    const scope = {
      kind: 'placing' as const,
      node: mockNode('i1', 'item'),
      nodeId: 'i1',
      nodeType: 'item',
      view: '3d' as const,
      pressDrag: false,
    }
    expect(isCandidateInHotSet(scope, surfaceClass, floor)).toBe(true)
    expect(isCandidateInHotSet(scope, surfaceClass, ceilingFan)).toBe(false)
  })
  test('moving a wall-mounted item: only walls', () => {
    const scope = {
      kind: 'moving' as const,
      node: mockNode('w1', 'window'),
      nodeId: 'w1',
      nodeType: 'window',
      view: '2d' as const,
    }
    expect(isCandidateInHotSet(scope, 'wall', wall)).toBe(true)
    expect(isCandidateInHotSet(scope, 'wall', table)).toBe(false)
  })
  test('non-placement active scopes target nothing in the scene', () => {
    expect(isCandidateInHotSet({ kind: 'box-select' }, null, floor)).toBe(false)
    expect(
      isCandidateInHotSet({ kind: 'handle-drag', nodeId: 'x', handle: 'h' }, null, floor),
    ).toBe(false)
  })
})
