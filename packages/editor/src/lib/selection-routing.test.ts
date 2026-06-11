import { describe, expect, test } from 'bun:test'
import type { AnyNode } from '@pascal-app/core'
import {
  resolveNodeSelectionTarget,
  resolveSelectedIdsForNodeClick,
  selectionModifiersFromEvent,
} from './selection-routing'

describe('resolveSelectedIdsForNodeClick', () => {
  test('preserves the pre-routing selection when a phase switch clears current ids', () => {
    expect(
      resolveSelectedIdsForNodeClick({
        baseSelectedIds: ['wall_1'],
        currentSelectedIds: [],
        modifierKeys: { meta: true, ctrl: false, shift: false },
        nodeId: 'item_1',
      }),
    ).toEqual(['wall_1', 'item_1'])
  })

  test('toggles from the pre-routing selection while a modifier is held', () => {
    expect(
      resolveSelectedIdsForNodeClick({
        baseSelectedIds: ['wall_1', 'item_1'],
        currentSelectedIds: [],
        modifierKeys: { meta: false, ctrl: false, shift: true },
        nodeId: 'item_1',
      }),
    ).toEqual(['wall_1'])
  })
})

describe('selectionModifiersFromEvent', () => {
  test('falls back to tracked modifier state when the click event omits keys', () => {
    expect(selectionModifiersFromEvent({}, { meta: false, ctrl: true, shift: false })).toEqual({
      meta: false,
      ctrl: true,
      shift: false,
    })
  })
})

describe('resolveNodeSelectionTarget', () => {
  test('routes furniture items to furnish', () => {
    const node = {
      id: 'item_1',
      type: 'item',
      asset: { category: 'furniture' },
    } as unknown as AnyNode

    expect(resolveNodeSelectionTarget(node)).toEqual({ phase: 'furnish' })
  })

  test('routes door and window catalog items to structure', () => {
    const node = {
      id: 'item_1',
      type: 'item',
      asset: { category: 'door' },
    } as unknown as AnyNode

    expect(resolveNodeSelectionTarget(node)).toEqual({
      phase: 'structure',
      structureLayer: 'elements',
    })
  })
})
