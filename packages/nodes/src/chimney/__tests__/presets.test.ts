import { describe, expect, test } from 'bun:test'
import { CHIMNEY_PRESET_KEYS, chimneyPresets, detectActiveChimneyPreset } from '../presets'
import { ChimneyNode } from '../schema'

// Build a fully-formed chimney by parsing an empty object (schema fills
// every default) and merging the preset over the top — mirrors what the
// panel does when it calls `commitProp(chimneyPresets[key])`.
const applyPreset = (key: keyof typeof chimneyPresets) =>
  ({ ...ChimneyNode.parse({}), ...chimneyPresets[key] }) as Parameters<
    typeof detectActiveChimneyPreset
  >[0]

describe('detectActiveChimneyPreset', () => {
  test('returns null when no node is supplied', () => {
    expect(detectActiveChimneyPreset(null)).toBeNull()
    expect(detectActiveChimneyPreset(undefined)).toBeNull()
  })

  test('returns null for a freshly-parsed default chimney (no preset applied)', () => {
    // The schema's defaults are deliberately neutral — they should NOT
    // accidentally match one of the curated presets. If they do, the
    // panel will show a preset as active on every fresh chimney and the
    // user has no "custom starting state".
    expect(detectActiveChimneyPreset(ChimneyNode.parse({}))).toBeNull()
  })

  test.each(CHIMNEY_PRESET_KEYS)('round-trips %s preset', (key) => {
    expect(detectActiveChimneyPreset(applyPreset(key))).toBe(key)
  })

  test('returns null after the user tweaks a field away from the preset', () => {
    const node = applyPreset('brick')
    // Brick preset sets bandStyle=double; flip it to confirm the
    // detection narrows.
    expect(detectActiveChimneyPreset({ ...node, bandStyle: 'single' as const })).toBeNull()
  })

  test('ignores non-preset fields (dimensions, materials, placement)', () => {
    // The whole point of the preset model: applying brick to an
    // already-sized chimney doesn't reset its width/depth/material, and
    // varying those alone shouldn't kick it out of "Brick".
    const node = applyPreset('brick')
    expect(
      detectActiveChimneyPreset({
        ...node,
        width: 1.2,
        depth: 0.8,
        heightAboveRidge: 2.5,
        position: [3, 0, -1] as [number, number, number],
        rotation: 0.7,
        materialPreset: 'preset-brick-redbrown',
        topMaterialPreset: 'preset-concrete',
      }),
    ).toBe('brick')
  })
})
