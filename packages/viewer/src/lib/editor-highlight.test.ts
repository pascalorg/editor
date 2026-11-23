// @ts-expect-error — Bun types are not part of the viewer's production declaration build.
import { describe, expect, test } from 'bun:test'
import * as THREE from 'three'
import { isHighlight, markHighlight, tintEmissive } from './editor-highlight'

describe('editor highlight', () => {
  test('the tint runs at its own strength, not the material default intensity', () => {
    const material = new THREE.MeshStandardMaterial()
    tintEmissive(material, new THREE.Color(1, 1, 1), 0.12)
    expect(material.emissive.r).toBeCloseTo(0.12)
    expect(material.emissiveIntensity).toBe(1)
  })

  test("a lamp's own glow is kept under the tint", () => {
    const material = new THREE.MeshStandardMaterial({ emissive: 0xffffff, emissiveIntensity: 2 })
    tintEmissive(material, new THREE.Color(0, 0, 1), 0.5)
    expect(material.emissive.r).toBeCloseTo(2)
    expect(material.emissive.b).toBeCloseTo(2.5)
  })

  test('marks the clone only', () => {
    const source = new THREE.MeshStandardMaterial()
    const clone = markHighlight(source.clone())
    expect(isHighlight(clone)).toBe(true)
    expect(isHighlight(source)).toBe(false)
    // Its own compiled program: the daylight hooks build it differently.
    expect(clone.customProgramCacheKey()).not.toBe(source.customProgramCacheKey())
  })
})
