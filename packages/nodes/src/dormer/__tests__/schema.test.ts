import { describe, expect, test } from 'bun:test'
import { getEffectiveDormerSurfaceMaterial } from '@pascal-app/core'
import { DormerNode } from '../schema'

describe('DormerNode schema', () => {
  test('parses with defaults', () => {
    const parsed = DormerNode.parse({})
    expect(parsed.type).toBe('dormer')
    expect(parsed.id).toMatch(/^dormer_/)
    expect(parsed.width).toBe(1.21)
    expect(parsed.depth).toBe(1.55)
    expect(parsed.height).toBe(0)
    expect(parsed.roofType).toBe('gable')
    expect(parsed.windowShape).toBe('rectangle')
    expect(parsed.windowSill).toBe(false)
  })

  test('windowColumns / windowRows clamped to [1, 8]', () => {
    expect(() => DormerNode.parse({ windowColumns: 0 })).toThrow()
    expect(() => DormerNode.parse({ windowColumns: 9 })).toThrow()
    expect(() => DormerNode.parse({ windowRows: 1.5 })).toThrow()
  })

  test('windowCornerRadii round-trips as tuple of 4', () => {
    const parsed = DormerNode.parse({ windowCornerRadii: [0.1, 0.2, 0.3, 0.4] })
    expect(parsed.windowCornerRadii).toEqual([0.1, 0.2, 0.3, 0.4])
  })
})

describe('getEffectiveDormerSurfaceMaterial', () => {
  test('top role prefers topMaterialPreset, falls back to legacy materialPreset', () => {
    const node = DormerNode.parse({
      materialPreset: 'red',
      topMaterialPreset: 'blue',
    })
    expect(getEffectiveDormerSurfaceMaterial(node, 'top').materialPreset).toBe('blue')
    expect(getEffectiveDormerSurfaceMaterial(node, 'wall').materialPreset).toBe('red')
  })

  test('side role cross-falls-back to wallMaterialPreset', () => {
    const node = DormerNode.parse({ wallMaterialPreset: 'wallpaper' })
    expect(getEffectiveDormerSurfaceMaterial(node, 'side').materialPreset).toBe('wallpaper')
  })

  test('wall role cross-falls-back to sideMaterialPreset', () => {
    const node = DormerNode.parse({ sideMaterialPreset: 'cedar' })
    expect(getEffectiveDormerSurfaceMaterial(node, 'wall').materialPreset).toBe('cedar')
  })

  test('all three roles fall back to legacy materialPreset when nothing set', () => {
    const node = DormerNode.parse({ materialPreset: 'stucco' })
    expect(getEffectiveDormerSurfaceMaterial(node, 'top').materialPreset).toBe('stucco')
    expect(getEffectiveDormerSurfaceMaterial(node, 'side').materialPreset).toBe('stucco')
    expect(getEffectiveDormerSurfaceMaterial(node, 'wall').materialPreset).toBe('stucco')
  })
})
