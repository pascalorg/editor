import { describe, expect, test } from 'bun:test'
import { CEILING_FRAME_STYLES, CEILING_MEDALLION_STYLES } from '@pascal-app/core'
import type * as THREE from 'three'
import {
  buildCeilingFrameGeometry,
  buildCeilingMedallionGeometry,
  resolveMedallionCenter,
} from './ceiling-ornament-geometry'

const RECT: [number, number][] = [
  [0, 0],
  [7.2, 0],
  [7.2, 4.4],
  [0, 4.4],
]

const L_SHAPE: [number, number][] = [
  [0, 0],
  [6, 0],
  [6, 2.5],
  [3, 2.5],
  [3, 5],
  [0, 5],
]

function normalStats(geometry: THREE.BufferGeometry) {
  const pos = geometry.getAttribute('position')
  const norm = geometry.getAttribute('normal')
  const uv = geometry.getAttribute('uv')
  const uv2 = geometry.getAttribute('uv2')
  expect(pos.count).toBeGreaterThan(0)
  expect(norm.count).toBe(pos.count)
  expect(uv.count).toBe(pos.count)
  expect(uv2.count).toBe(pos.count)
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  let sumNy = 0
  let upwardCount = 0
  let maxR = 0
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    const nx = norm.getX(i)
    const ny = norm.getY(i)
    const nz = norm.getZ(i)
    expect(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)).toBe(true)
    expect(Number.isFinite(nx) && Number.isFinite(ny) && Number.isFinite(nz)).toBe(true)
    if (y < minY) minY = y
    if (y > maxY) maxY = y
    sumNy += ny
    if (ny > 0.05) upwardCount++
    maxR = Math.max(maxR, Math.hypot(x, z))
  }
  return { minY, maxY, meanNy: sumNy / pos.count, upwardCount, maxR }
}

describe('ceiling medallion geometry', () => {
  for (const style of CEILING_MEDALLION_STYLES) {
    test(`${style}: smooth continuous bas-relief with strictly downward (-Y) normals`, () => {
      const relief = 0.045
      const diameter = 0.9
      const geom = buildCeilingMedallionGeometry({ style, diameter, relief }, [0, 0])
      const stats = normalStats(geom)
      // Must hang downward beneath y = 0 and stay within the relief envelope.
      expect(stats.maxY).toBeLessThanOrEqual(1e-6)
      expect(stats.minY).toBeGreaterThanOrEqual(-relief - 1e-4)
      expect(stats.minY).toBeLessThan(-relief * 0.5)
      expect(stats.maxR).toBeCloseTo(diameter / 2, 4)
      // Never inverted / backface-culled from the room below.
      expect(stats.upwardCount).toBe(0)
      expect(stats.meanNy).toBeLessThan(-0.7)
      const triCount = (geom.getIndex()?.count ?? geom.getAttribute('position').count) / 3
      expect(triCount).toBeLessThanOrEqual(35_000)
      geom.dispose()
    })
  }

  test('resolves centroid for rectangles, interior point for L-shapes and avoids holes', () => {
    const center = resolveMedallionCenter(RECT, [], {})
    expect(center).not.toBeNull()
    expect(center![0]).toBeCloseTo(3.6, 6)
    expect(center![1]).toBeCloseTo(2.2, 6)
    const shifted = resolveMedallionCenter(RECT, [], { offset: [0.4, -0.2] })
    expect(shifted).not.toBeNull()
    expect(shifted![0]).toBeCloseTo(4.0, 6)
    expect(shifted![1]).toBeCloseTo(2.0, 6)
    expect(resolveMedallionCenter(RECT, [], { at: [1, 1] })).toEqual([1, 1])
    // Skylight shaft right over the room centre suppresses automatic placement.
    const hole: [number, number][] = [
      [3, 1.5],
      [4.2, 1.5],
      [4.2, 2.9],
      [3, 2.9],
    ]
    expect(resolveMedallionCenter(RECT, [hole], {})).toBeNull()
    expect(resolveMedallionCenter(RECT, [hole], { at: [1.5, 2.2] })).toEqual([1.5, 2.2])
    // L-shape finds an interior point cleanly.
    const lCenter = resolveMedallionCenter(L_SHAPE, [], {})
    expect(lCenter).not.toBeNull()
  })
})

describe('ceiling frame geometry', () => {
  for (const style of CEILING_FRAME_STYLES) {
    test(`${style}: builds valid swept downward-facing moulding on rectangular and L-shaped rooms`, () => {
      const relief = 0.032
      const rectGeom = buildCeilingFrameGeometry(RECT, [], {
        style,
        inset: 0.42,
        width: 0.085,
        relief,
        notchedCorners: true,
      })
      expect(rectGeom).not.toBeNull()
      const stats = normalStats(rectGeom!)
      expect(stats.maxY).toBeLessThanOrEqual(1e-6)
      expect(stats.minY).toBeGreaterThanOrEqual(-relief - 1e-4)
      expect(stats.minY).toBeLessThan(-relief * 0.7)
      expect(stats.meanNy).toBeLessThan(-0.35)
      rectGeom!.dispose()

      const lGeom = buildCeilingFrameGeometry(L_SHAPE, [], {
        style,
        inset: 0.35,
        width: 0.08,
        relief,
        notchedCorners: style !== 'haussmann-cadre',
      })
      expect(lGeom).not.toBeNull()
      lGeom!.dispose()
    })
  }

  test('skips gracefully when room is narrower than twice the inset', () => {
    const tiny: [number, number][] = [
      [0, 0],
      [0.7, 0],
      [0.7, 0.7],
      [0, 0.7],
    ]
    expect(
      buildCeilingFrameGeometry(tiny, [], {
        style: 'haussmann-cadre',
        inset: 0.42,
        width: 0.085,
        relief: 0.032,
        notchedCorners: true,
      }),
    ).toBeNull()
  })
})
