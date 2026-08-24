import { describe, expect, test } from 'bun:test'
import { cupolaPaint, resolveCupolaMaterialRole } from '../paint'
import { CupolaNode } from '../schema'

describe('cupola paint', () => {
  test('maps geometry groups to base, body, and roof', () => {
    expect(resolveCupolaMaterialRole(0)).toBe('base')
    expect(resolveCupolaMaterialRole(1)).toBe('body')
    expect(resolveCupolaMaterialRole(2)).toBe('roof')
  })

  test('updates only the selected construction part', () => {
    const node = CupolaNode.parse({ slots: { body: 'library:louver' } })
    expect(
      cupolaPaint.buildPatch({
        node,
        role: 'roof',
        material: undefined,
        materialPreset: 'library:copper',
      }),
    ).toEqual({
      slots: { body: 'library:louver', roof: 'library:copper' },
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
