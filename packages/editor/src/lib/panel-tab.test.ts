import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { type AnyNodeDefinition, loadPlugin, nodeRegistry, registerNode } from '@pascal-app/core'
import { elementBelongsToPanelTab } from './panel-tab'

/** The host's plugin API version. Not exported by core, so spelled out here. */
const PLUGIN_API_VERSION = 1

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

beforeEach(async () => {
  nodeRegistry._reset()
  registerNode(def('wall', 'structure', 'structure'))
  registerNode(def('item', 'furnish', 'furnish'))
  // Through `loadPlugin`, not `registerNode`: the Assets tab is decided by who
  // registered the kind, and a kind registered directly is a host kind however
  // its name is spelled. Registering this the other way would leave the tab
  // untested and the test passing.
  await loadPlugin({
    id: 'ovurrsl:warehouse',
    apiVersion: PLUGIN_API_VERSION,
    nodes: [def('warehouse:pallet-rack', 'furnish')],
  } as never)
})

afterEach(() => {
  nodeRegistry._reset()
})

describe('elementBelongsToPanelTab', () => {
  test('a plugin-contributed kind belongs to assets, and to neither of the others', () => {
    expect(elementBelongsToPanelTab('warehouse:pallet-rack', 'assets')).toBe(true)
    expect(elementBelongsToPanelTab('warehouse:pallet-rack', 'furnish')).toBe(false)
    expect(elementBelongsToPanelTab('warehouse:pallet-rack', 'structure')).toBe(false)
  })

  /** Assets is about provenance, not about the name. */
  test('a host kind stays put even if its name looks plugin-ish', () => {
    registerNode(def('warehouse:looks-like-a-plugin', 'furnish'))
    expect(elementBelongsToPanelTab('warehouse:looks-like-a-plugin', 'assets')).toBe(false)
    expect(elementBelongsToPanelTab('warehouse:looks-like-a-plugin', 'furnish')).toBe(true)
  })

  test('the host item kind belongs to furnish, NOT structure or assets', () => {
    expect(elementBelongsToPanelTab('item', 'furnish')).toBe(true)
    expect(elementBelongsToPanelTab('item', 'structure')).toBe(false)
    expect(elementBelongsToPanelTab('item', 'assets')).toBe(false)
  })

  test('a structure kind belongs to structure, NOT furnish', () => {
    expect(elementBelongsToPanelTab('wall', 'structure')).toBe(true)
    expect(elementBelongsToPanelTab('wall', 'furnish')).toBe(false)
  })

  test('the three tabs are complementary — every kind lands in exactly one', () => {
    for (const kind of ['wall', 'item', 'warehouse:pallet-rack']) {
      const hits = (['structure', 'furnish', 'assets'] as const).filter((tab) =>
        elementBelongsToPanelTab(kind, tab),
      )
      expect(hits).toHaveLength(1)
    }
  })
})
