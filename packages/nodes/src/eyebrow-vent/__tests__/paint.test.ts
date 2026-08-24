import { describe, expect, test } from 'bun:test'
import { eyebrowVentPaint, resolveEyebrowVentMaterialRole } from '../paint'
import { EyebrowVentNode } from '../schema'

describe('eyebrow vent paint', () => {
  test('maps geometry groups to hood and front', () => {
    expect(resolveEyebrowVentMaterialRole(0)).toBe('hood')
    expect(resolveEyebrowVentMaterialRole(1)).toBe('front')
  })

  test('updates only the selected construction part', () => {
    const node = EyebrowVentNode.parse({ slots: { hood: 'library:metal' } })
    expect(
      eyebrowVentPaint.buildPatch({
        node,
        role: 'front',
        material: undefined,
        materialPreset: 'library:louver',
      }),
    ).toEqual({
      slots: { hood: 'library:metal', front: 'library:louver' },
    })
  })

  test('uses the legacy material only for roles without an override', () => {
    const node = EyebrowVentNode.parse({ slots: { hood: 'library:metal' } })
    expect(
      eyebrowVentPaint.getEffectiveMaterial?.({ node, role: 'hood', nodes: {} })?.materialPreset,
    ).toBe('library:metal')
    expect(
      eyebrowVentPaint.getEffectiveMaterial?.({ node, role: 'front', nodes: {} })?.materialPreset,
    ).toBe('preset-white')
  })
})
