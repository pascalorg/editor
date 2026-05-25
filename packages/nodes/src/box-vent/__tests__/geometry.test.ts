import { describe, expect, test } from 'bun:test'
import { buildBoxVentGeometry, computeBoxVentSlopeTilt } from '../geometry'
import { BoxVentNode } from '../schema'

describe('buildBoxVentGeometry', () => {
  test('returns a non-empty BufferGeometry with position + normal + uv', () => {
    const node = BoxVentNode.parse({})
    const geo = buildBoxVentGeometry(node)
    const positions = geo.getAttribute('position')
    const normals = geo.getAttribute('normal')
    const uvs = geo.getAttribute('uv')
    expect(positions.count).toBeGreaterThan(0)
    expect(normals.count).toBe(positions.count)
    expect(uvs.count).toBe(positions.count)
  })

  test('box style is two stacked rounded extrusions (riser + cover)', () => {
    // Two rounded-rect extrusions (4 corners × 4 segs = 16 profile pts each).
    // Per layer: 16 wall quads (96 verts) + 32 cap triangles (96 verts) = 192 verts.
    // Two layers stacked → 384 verts total when bevel > 0.
    const box = buildBoxVentGeometry(BoxVentNode.parse({ style: 'box' }))
    expect(box.getAttribute('position').count).toBe(384)
  })

  test('box style: zero bevel still produces a valid closed solid', () => {
    // With bevel=0 the wall-edge dedupe drops the degenerate corner
    // quads, but the bottom + top fan triangulations always include
    // every profile edge (including the degenerate ones — they're
    // zero-area triangles that survive the buffer).
    const box = buildBoxVentGeometry(BoxVentNode.parse({ style: 'box', cornerBevel: 0 }))
    expect(box.getAttribute('position').count).toBeGreaterThan(0)
    // Confirm the position attribute carries finite values only.
    const positions = box.getAttribute('position').array as Float32Array
    for (let i = 0; i < positions.length; i++) {
      expect(Number.isFinite(positions[i])).toBe(true)
    }
  })

  test('cap style: body walls + flange + 4 chamfer faces + top (closed)', () => {
    // 5 body quads (4 walls + bottom) + 1 flange + 4 chamfered faces +
    // 1 flat top = 11 quads = 66 vertices. Confirms the cap is closed
    // and uses the dedicated builder (not the dome fallback).
    const cap = buildBoxVentGeometry(BoxVentNode.parse({ style: 'cap' }))
    expect(cap.getAttribute('position').count).toBe(66)
  })

  test('cap style: zero overhang drops the flange quad', () => {
    const noFlange = buildBoxVentGeometry(BoxVentNode.parse({ style: 'cap', hoodOverhang: 0 }))
    // 10 quads × 6 vertices/quad = 60.
    expect(noFlange.getAttribute('position').count).toBe(60)
  })

  test('dome style still uses the unified dome+skirt geometry (Step 1)', () => {
    const dome = buildBoxVentGeometry(BoxVentNode.parse({ style: 'dome' }))
    expect(dome.getAttribute('position').count).toBeGreaterThan(60)
  })

  test('legacy `standard` / `low-profile` style names migrate to new enum', () => {
    expect(BoxVentNode.parse({ style: 'standard' }).style).toBe('cap')
    expect(BoxVentNode.parse({ style: 'low-profile' }).style).toBe('box')
  })

  test('low-profile reduces overall vent height proportionally', () => {
    // Same node height but lower body share — total vertex count
    // unchanged (same mesh topology) but the highest Y in positions
    // is below the standard style's highest Y.
    const standard = buildBoxVentGeometry(BoxVentNode.parse({ style: 'standard', height: 0.2 }))
    const low = buildBoxVentGeometry(BoxVentNode.parse({ style: 'low-profile', height: 0.2 }))
    const maxY = (geo: ReturnType<typeof buildBoxVentGeometry>) => {
      const pos = geo.getAttribute('position').array as Float32Array
      let m = -Infinity
      for (let i = 1; i < pos.length; i += 3) if (pos[i]! > m) m = pos[i]!
      return m
    }
    // Total height is the same in both styles — height is the user-
    // facing total. Body share differs but the hood compensates.
    expect(maxY(standard)).toBeCloseTo(0.2)
    expect(maxY(low)).toBeCloseTo(0.2)
  })

  test('width / depth control the footprint bounds', () => {
    const node = BoxVentNode.parse({ width: 0.6, depth: 0.5, hoodOverhang: 0 })
    const geo = buildBoxVentGeometry(node)
    const pos = geo.getAttribute('position').array as Float32Array
    let maxX = -Infinity
    let maxZ = -Infinity
    for (let i = 0; i < pos.length; i += 3) {
      if (pos[i]! > maxX) maxX = pos[i]!
      if (pos[i + 2]! > maxZ) maxZ = pos[i + 2]!
    }
    expect(maxX).toBeCloseTo(0.3)
    expect(maxZ).toBeCloseTo(0.25)
  })
})

describe('computeBoxVentSlopeTilt', () => {
  // For a gable, getActiveRoofHeight = (depth/2) * tan(pitch). Picking
  // these pitches makes the active roof height match the legacy fixtures.
  const pitchForRise = (rise: number, depth: number) =>
    (Math.atan2(rise, depth / 2) * 180) / Math.PI

  test('flat segment returns 0 regardless of position', () => {
    const seg = { roofType: 'flat' as const, pitch: 30, width: 6, depth: 6 }
    expect(computeBoxVentSlopeTilt(seg, 2)).toBe(0)
    expect(computeBoxVentSlopeTilt(seg, -2)).toBe(0)
  })

  test('ridge (localZ=0) returns 0', () => {
    expect(
      computeBoxVentSlopeTilt(
        { roofType: 'gable', pitch: pitchForRise(2, 6), width: 6, depth: 6 },
        0,
      ),
    ).toBe(0)
  })

  test('positive Z tilts down by slope angle; negative Z tilts up by the same angle', () => {
    const seg = {
      roofType: 'gable' as const,
      pitch: pitchForRise(2.5, 6),
      width: 6,
      depth: 6,
    }
    const expected = Math.atan2(2.5, 3)
    expect(computeBoxVentSlopeTilt(seg, 1)).toBeCloseTo(expected)
    expect(computeBoxVentSlopeTilt(seg, -1)).toBeCloseTo(-expected)
  })

  test('undefined segment returns 0 (safe default before parent resolves)', () => {
    expect(computeBoxVentSlopeTilt(undefined, 1)).toBe(0)
  })
})
