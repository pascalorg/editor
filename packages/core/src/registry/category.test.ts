import { beforeEach, describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { categoryOf, categoryOfDef, nodeRegistry, registerNode } from './registry'
import type { AnyNodeDefinition } from './types'

function makeDefinition(
  kind: string,
  overrides: Partial<AnyNodeDefinition> = {},
): AnyNodeDefinition {
  return {
    kind,
    schemaVersion: 1,
    schema: z.object({ type: z.literal(kind) }) as never,
    category: 'utility',
    defaults: () => ({}) as never,
    capabilities: {},
    ...overrides,
  } as AnyNodeDefinition
}

function withPalette(
  kind: string,
  category: AnyNodeDefinition['category'],
  paletteSection?: 'site' | 'structure' | 'furnish',
): AnyNodeDefinition {
  return makeDefinition(kind, {
    category,
    presentation: {
      label: kind,
      icon: { kind: 'iconify', name: 'lucide:square' },
      ...(paletteSection ? { paletteSection } : {}),
    },
  })
}

describe('categoryOfDef', () => {
  test('furnish covers the host item and every plugin kind (category: furnish)', () => {
    // Host furniture and warehouse plugin kinds all declare `category: 'furnish'`.
    expect(categoryOfDef(withPalette('item', 'furnish', 'furnish'))).toBe('furnish')
    expect(categoryOfDef(withPalette('cabinet', 'furnish', 'furnish'))).toBe('furnish')
    expect(categoryOfDef(withPalette('warehouse:pallet-rack', 'furnish'))).toBe('furnish')
    expect(categoryOfDef(withPalette('warehouse:conveyor', 'furnish'))).toBe('furnish')
    // paletteSection alone (no furnish category) still counts as furnish.
    expect(categoryOfDef(withPalette('gadget', 'utility', 'furnish'))).toBe('furnish')
  })

  test('zone maps to its own category even though its palette section is site', () => {
    expect(categoryOfDef(withPalette('zone', 'site', 'site'))).toBe('zone')
  })

  test('structure kinds map to structure', () => {
    expect(categoryOfDef(withPalette('wall', 'structure', 'structure'))).toBe('structure')
    // Falls back to `category` when paletteSection is omitted.
    expect(categoryOfDef(withPalette('column', 'structure'))).toBe('structure')
  })

  test('site content maps to site', () => {
    expect(categoryOfDef(withPalette('route', 'site', 'site'))).toBe('site')
    expect(categoryOfDef(withPalette('boundary', 'site'))).toBe('site')
  })

  test('hierarchy containers have no visibility category', () => {
    expect(categoryOfDef(withPalette('site', 'site', 'site'))).toBeNull()
    expect(categoryOfDef(withPalette('building', 'site', 'site'))).toBeNull()
    expect(categoryOfDef(withPalette('level', 'site', 'site'))).toBeNull()
  })

  test('unknown / analysis / utility kinds fall back to structure', () => {
    expect(categoryOfDef(makeDefinition('sensor', { category: 'analysis' }))).toBe('structure')
    expect(categoryOfDef(makeDefinition('helper', { category: 'utility' }))).toBe('structure')
  })
})

describe('categoryOf (registered kinds)', () => {
  beforeEach(() => {
    nodeRegistry._reset()
  })

  test('reads the registered definition', () => {
    registerNode(withPalette('warehouse:pallet-rack', 'furnish'))
    registerNode(withPalette('wall', 'structure', 'structure'))
    registerNode(withPalette('zone', 'site', 'site'))
    registerNode(withPalette('level', 'site', 'site'))

    expect(categoryOf('warehouse:pallet-rack')).toBe('furnish')
    expect(categoryOf('wall')).toBe('structure')
    expect(categoryOf('zone')).toBe('zone')
    expect(categoryOf('level')).toBeNull()
  })

  test('unregistered kinds fall back to structure', () => {
    expect(categoryOf('does-not-exist')).toBe('structure')
  })
})
