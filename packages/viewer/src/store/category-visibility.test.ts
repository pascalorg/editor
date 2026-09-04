// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// include Bun ambient types in its production declaration build.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { type AnyNodeDefinition, categoryOf, nodeRegistry, registerNode } from '@pascal-app/core'
import useViewer from './use-viewer'

// Minimal definitions — categoryOf reads only kind / category / presentation, so
// the schema and defaults can be stubs here.
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

// Mirrors the gate in node-renderer.tsx exactly.
function isHiddenByCategory(kind: string): boolean {
  const category = categoryOf(kind)
  return category !== null && useViewer.getState().hiddenCategories.has(category)
}

beforeEach(() => {
  nodeRegistry._reset()
  registerNode(def('warehouse:pallet-rack', 'furnish'))
  registerNode(def('wall', 'structure', 'structure'))
  registerNode(def('route', 'site', 'site'))
  registerNode(def('level', 'site', 'site'))
  useViewer.setState({
    hiddenCategories: new Set(),
    lockedCategories: new Set(),
    sceneLocked: false,
  })
})

afterEach(() => {
  nodeRegistry._reset()
  useViewer.setState({ hiddenCategories: new Set() })
})

describe('hiddenCategories render predicate', () => {
  test('hiding a category hides only that category', () => {
    useViewer.getState().setCategoryHidden('furnish', true)

    expect(isHiddenByCategory('warehouse:pallet-rack')).toBe(true)
    expect(isHiddenByCategory('wall')).toBe(false)
    expect(isHiddenByCategory('route')).toBe(false)
  })

  test('hierarchy containers are never hidden, even when their palette section is hidden', () => {
    // level's palette section is 'site'; hiding 'site' must not remove the level
    // container (it hosts the whole subtree).
    useViewer.getState().setCategoryHidden('site', true)

    expect(isHiddenByCategory('route')).toBe(true)
    expect(isHiddenByCategory('level')).toBe(false)
  })

  test('setCategoryHidden(false) reveals the category again', () => {
    useViewer.getState().setCategoryHidden('furnish', true)
    useViewer.getState().setCategoryHidden('furnish', false)
    expect(isHiddenByCategory('warehouse:pallet-rack')).toBe(false)
  })

  test('toggling one category preserves the identity of an unchanged set', () => {
    const before = useViewer.getState().hiddenCategories
    useViewer.getState().setCategoryHidden('furnish', false) // already absent → no-op
    expect(useViewer.getState().hiddenCategories).toBe(before)
  })
})
