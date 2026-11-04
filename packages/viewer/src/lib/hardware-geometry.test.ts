import { expect, test } from 'bun:test'
import * as THREE from 'three'
import { hingeBarrel, knobOnRose, leverOnRose, roller, roundedBox, tube } from './hardware-geometry'

for (const [name, build] of [
  ['lever', leverOnRose],
  ['knob', knobOnRose],
  ['hinge', hingeBarrel],
  ['box', () => roundedBox(0.28, 0.055, 0.055)],
  ['tube', () => tube(0.0095, 0.125)],
  ['roller', () => roller(0.0425, 0.02)],
] as const) {
  test(`${name}: cached geometry has finite positions, normals and metre UVs`, () => {
    const geometry = build()
    expect(build()).toBe(geometry)
    expect(geometry.userData.shared).toBe(true)
    for (const attribute of Object.values(geometry.attributes)) {
      expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true)
    }
    const uv = geometry.getAttribute('uv')
    expect(Math.max(...Array.from(uv.array).map(Math.abs))).toBeLessThan(1)
  })
}

test('dimension keys quantise to millimetres', () => {
  expect(roundedBox(0.28, 0.055, 0.055)).toBe(roundedBox(0.2801, 0.0551, 0.0551))
  expect(tube(0.01, 0.12)).toBe(tube(0.0101, 0.1201))
  expect(roller(0.0425, 0.02)).toBe(roller(0.0426, 0.0201))
  expect(tube(0.01, 0.12)).not.toBe(tube(0.01, 0.121))
})

test('round bars use circumference and length on the side and planar metres on caps', () => {
  const geometry = tube(0.01, 0.12)
  const uv = geometry.getAttribute('uv')
  expect(uv.getX(12)).toBeCloseTo(2 * Math.PI * 0.01)
  expect(uv.getY(0)).toBeCloseTo(0.12)
  const positions = geometry.getAttribute('position')
  for (let i = 26; i < uv.count; i++) {
    expect(uv.getX(i)).toBeCloseTo(positions.getX(i))
    expect(uv.getY(i)).toBeCloseTo(positions.getZ(i))
  }
})

test('lever dimensions and wheel diameter preserve half-millimetre radii', () => {
  const lever = new THREE.Box3().setFromBufferAttribute(
    leverOnRose().getAttribute('position') as THREE.BufferAttribute,
  )
  expect(lever.max.x).toBeCloseTo(0.125)
  expect(lever.min.y).toBeCloseTo(-0.026)
  expect(lever.max.y).toBeCloseTo(0.026)
  expect(lever.min.z).toBeCloseTo(0)
  const wheel = new THREE.Box3().setFromBufferAttribute(
    roller(0.0425, 0.02).getAttribute('position') as THREE.BufferAttribute,
  )
  expect(wheel.getSize(new THREE.Vector3()).x).toBeCloseTo(0.085)
  expect(wheel.getSize(new THREE.Vector3()).z).toBeCloseTo(0.02)
})
