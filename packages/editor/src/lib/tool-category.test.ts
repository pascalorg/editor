import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { type AnyNodeDefinition, nodeRegistry, registerNode } from '@pascal-app/core'
import { categoryOfActiveTool } from './tool-category'

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
  registerNode(def('door', 'structure', 'structure'))
  registerNode(def('zone', 'site', 'site'))
  registerNode(def('route', 'site', 'site'))
  registerNode(def('warehouse:pallet-rack', 'furnish'))
})

afterEach(() => {
  nodeRegistry._reset()
})

describe('categoryOfActiveTool', () => {
  test('no active tool → null', () => {
    expect(categoryOfActiveTool('structure', null)).toBeNull()
  })

  test('registered structure kinds resolve to structure', () => {
    expect(categoryOfActiveTool('structure', 'wall')).toBe('structure')
    expect(categoryOfActiveTool('structure', 'door')).toBe('structure')
  })

  test('a warehouse plugin kind resolves to furnish', () => {
    // Registry wins even when the phase is not "furnish" — placement gating must
    // track what the tool actually creates.
    expect(categoryOfActiveTool('structure', 'warehouse:pallet-rack')).toBe('furnish')
    expect(categoryOfActiveTool('furnish', 'warehouse:pallet-rack')).toBe('furnish')
  })

  test('zone tool resolves to zone (its own category, not site)', () => {
    // zone is registered — the registry maps its kind to the zone category.
    expect(categoryOfActiveTool('structure', 'zone')).toBe('zone')
  })

  test('a registered site kind resolves to site', () => {
    expect(categoryOfActiveTool('site', 'route')).toBe('site')
  })

  test('legacy tools whose id is not a node kind fall back correctly', () => {
    // property-line draws the site boundary; it is not a node kind.
    expect(categoryOfActiveTool('site', 'property-line')).toBe('site')
    // roof / stair legacy tools sit in the structure phase.
    expect(categoryOfActiveTool('structure', 'roof')).toBe('structure')
    expect(categoryOfActiveTool('structure', 'stair')).toBe('structure')
  })

  test('unknown tool falls back to the phase', () => {
    expect(categoryOfActiveTool('furnish', 'mystery-tool')).toBe('furnish')
    expect(categoryOfActiveTool('site', 'mystery-tool')).toBe('site')
    expect(categoryOfActiveTool('structure', 'mystery-tool')).toBe('structure')
  })
})
