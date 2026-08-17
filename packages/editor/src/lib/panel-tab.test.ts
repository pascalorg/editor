import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { type AnyNodeDefinition, nodeRegistry, registerNode } from '@pascal-app/core'
import { elementBelongsToPanelTab } from './panel-tab'

function def(
  kind: string,
  category: AnyNodeDefinition['category'],
  paletteSection?: 'site' | 'structure' | 'furnish',
): AnyNodeDefinition {
  return {
    kind,
    schemaVersion: 1,
    schema: {} as never,
    category,
    defaults: () => ({}) as never,
    capabilities: {},
    presentation: {
      label: kind,
      icon: { kind: 'iconify', name: 'lucide:square' },
      ...(paletteSection ? { paletteSection } : {}),
    },
  } as AnyNodeDefinition
}

beforeEach(() => {
  nodeRegistry._reset()
  registerNode(def('wall', 'structure', 'structure'))
  registerNode(def('item', 'furnish', 'furnish'))
  registerNode(def('warehouse:pallet-rack', 'furnish'))
})

afterEach(() => {
  nodeRegistry._reset()
})

describe('elementBelongsToPanelTab', () => {
  test('a warehouse plugin kind belongs to furnish, NOT structure', () => {
    expect(elementBelongsToPanelTab('warehouse:pallet-rack', 'furnish')).toBe(true)
    expect(elementBelongsToPanelTab('warehouse:pallet-rack', 'structure')).toBe(false)
  })

  test('the host item kind belongs to furnish, NOT structure', () => {
    expect(elementBelongsToPanelTab('item', 'furnish')).toBe(true)
    expect(elementBelongsToPanelTab('item', 'structure')).toBe(false)
  })

  test('a structure kind belongs to structure, NOT furnish', () => {
    expect(elementBelongsToPanelTab('wall', 'structure')).toBe(true)
    expect(elementBelongsToPanelTab('wall', 'furnish')).toBe(false)
  })

  test('the two tabs are complementary — no kind appears under both', () => {
    for (const kind of ['wall', 'item', 'warehouse:pallet-rack']) {
      const inStructure = elementBelongsToPanelTab(kind, 'structure')
      const inFurnish = elementBelongsToPanelTab(kind, 'furnish')
      expect(inStructure && inFurnish).toBe(false)
      expect(inStructure || inFurnish).toBe(true)
    }
  })
})
