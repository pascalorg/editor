import { describe, expect, test } from 'bun:test'
import {
  buildCupolaMaterialPatch,
  getEffectiveCupolaMaterial,
  resolveCupolaMaterialRole,
} from '../paint'
import { CupolaNode } from '../schema'

describe('cupola paint', () => {
  test('maps geometry groups to base, body, and roof', () => {
    expect(resolveCupolaMaterialRole(0)).toBe('base')
    expect(resolveCupolaMaterialRole(1)).toBe('body')
    expect(resolveCupolaMaterialRole(2)).toBe('roof')
  })

  test('updates only the selected construction part', () => {
    expect(buildCupolaMaterialPatch('body', undefined, 'library:louver')).toEqual({
      bodyMaterial: undefined,
      bodyMaterialPreset: 'library:louver',
    })
    expect(buildCupolaMaterialPatch('roof', undefined, 'library:copper')).toEqual({
      roofMaterial: undefined,
      roofMaterialPreset: 'library:copper',
    })
  })

  test('uses the legacy material only for roles without an override', () => {
    const node = CupolaNode.parse({ bodyMaterialPreset: 'library:louver' })
    expect(getEffectiveCupolaMaterial(node, 'body').materialPreset).toBe('library:louver')
    expect(getEffectiveCupolaMaterial(node, 'base').materialPreset).toBe('preset-white')
    expect(getEffectiveCupolaMaterial(node, 'roof').materialPreset).toBe('preset-white')
  })
})
