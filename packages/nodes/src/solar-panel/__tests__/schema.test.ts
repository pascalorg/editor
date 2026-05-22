import { describe, expect, test } from 'bun:test'
import { SolarPanelNode } from '../schema'

describe('SolarPanelNode schema', () => {
  test('parses with defaults matching the residential preset', () => {
    const parsed = SolarPanelNode.parse({})
    expect(parsed.type).toBe('solar-panel')
    expect(parsed.id).toMatch(/^solarpanel_/)
    expect(parsed.rows).toBe(2)
    expect(parsed.columns).toBe(3)
    expect(parsed.panelWidth).toBe(1.0)
    expect(parsed.panelHeight).toBe(1.65)
    expect(parsed.frameThickness).toBe(0.04)
    expect(parsed.frameDepth).toBe(0.04)
    expect(parsed.mountingType).toBe('flush')
    expect(parsed.tiltAngle).toBe(15)
    expect(parsed.standoffHeight).toBe(0.05)
    expect(parsed.panelTypePreset).toBeUndefined()
  })

  test('rejects rows/columns out of [1, 20]', () => {
    expect(() => SolarPanelNode.parse({ rows: 0 })).toThrow()
    expect(() => SolarPanelNode.parse({ rows: 21 })).toThrow()
    expect(() => SolarPanelNode.parse({ columns: 0 })).toThrow()
    expect(() => SolarPanelNode.parse({ columns: 21 })).toThrow()
    expect(() => SolarPanelNode.parse({ rows: 3.5 })).toThrow()
  })

  test('accepts each preset key', () => {
    for (const k of ['residential', 'residential-large', 'compact', 'frameless'] as const) {
      expect(SolarPanelNode.parse({ panelTypePreset: k }).panelTypePreset).toBe(k)
    }
  })

  test('rejects unknown preset / mounting / role', () => {
    expect(() => SolarPanelNode.parse({ panelTypePreset: 'utility' })).toThrow()
    expect(() => SolarPanelNode.parse({ mountingType: 'angled' })).toThrow()
  })

  test('surfaceNormal round-trips', () => {
    const parsed = SolarPanelNode.parse({ surfaceNormal: [0.2, 0.95, -0.18] })
    expect(parsed.surfaceNormal).toEqual([0.2, 0.95, -0.18])
  })
})
