import { describe, expect, test } from 'bun:test'
import { cupolaDefinition } from '../definition'
import { cupolaPaint, resolveCupolaMaterialRole } from '../paint'
import { CupolaNode } from '../schema'

describe('cupola paint', () => {
  test('declares and seeds metallic louvers for new cupolas', () => {
    const defaults = cupolaDefinition.defaults()
    const node = CupolaNode.parse(defaults)

    expect(node.slots?.louvers).toBe('library:preset-metal')
    expect(cupolaDefinition.capabilities.slots?.(node)).toContainEqual({
      slotId: 'louvers',
      label: 'Louvers',
      default: 'library:preset-metal',
    })
  })

  test('maps geometry groups to base, body, roof, and louvers', () => {
    expect(resolveCupolaMaterialRole(0)).toBe('base')
    expect(resolveCupolaMaterialRole(1)).toBe('body')
    expect(resolveCupolaMaterialRole(2)).toBe('roof')
    expect(resolveCupolaMaterialRole(3)).toBe('louvers')
  })

  test('updates only the selected construction part', () => {
    const node = CupolaNode.parse({ slots: { body: 'library:louver' } })
    expect(
      cupolaPaint.buildPatch({
        node,
        role: 'louvers',
        material: undefined,
        materialPreset: 'library:copper',
      }),
    ).toEqual({
      slots: { body: 'library:louver', louvers: 'library:copper' },
    })
  })

  test('uses the legacy material only for roles without an override', () => {
    const node = CupolaNode.parse({ slots: { body: 'library:louver' } })
    expect(
      cupolaPaint.getEffectiveMaterial?.({ node, role: 'body', nodes: {} })?.materialPreset,
    ).toBe('library:louver')
    expect(
      cupolaPaint.getEffectiveMaterial?.({ node, role: 'base', nodes: {} })?.materialPreset,
    ).toBe('preset-white')
  })
})
