import { describe, expect, test } from 'bun:test'
import {
  buildEyebrowVentMaterialPatch,
  getEffectiveEyebrowVentMaterial,
  resolveEyebrowVentMaterialRole,
} from '../paint'
import { EyebrowVentNode } from '../schema'

describe('eyebrow vent paint', () => {
  test('maps geometry groups to hood and front', () => {
    expect(resolveEyebrowVentMaterialRole(0)).toBe('hood')
    expect(resolveEyebrowVentMaterialRole(1)).toBe('front')
  })

  test('updates only the selected construction part', () => {
    expect(buildEyebrowVentMaterialPatch('front', undefined, 'library:louver')).toEqual({
      frontMaterial: undefined,
      frontMaterialPreset: 'library:louver',
    })
  })

  test('uses the legacy material only for roles without an override', () => {
    const node = EyebrowVentNode.parse({ hoodMaterialPreset: 'library:metal' })
    expect(getEffectiveEyebrowVentMaterial(node, 'hood').materialPreset).toBe('library:metal')
    expect(getEffectiveEyebrowVentMaterial(node, 'front').materialPreset).toBe('preset-white')
  })
})
