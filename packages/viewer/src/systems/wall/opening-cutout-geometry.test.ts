// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, test } from 'bun:test'
import { DoorNode, WindowNode } from '@pascal-app/core'
import type * as THREE from 'three'
import {
  buildOpeningCutoutGeometry,
  buildOpeningCutoutShape,
  hasFlatOpeningCutoutBottom,
} from './opening-cutout-geometry'

function containsPoint(points: THREE.Vector2[], x: number, y: number) {
  return points.some((point) => Math.abs(point.x - x) < 1e-6 && Math.abs(point.y - y) < 1e-6)
}

function getBounds(points: THREE.Vector2[]) {
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const point of points) {
    minX = Math.min(minX, point.x)
    maxX = Math.max(maxX, point.x)
    minY = Math.min(minY, point.y)
    maxY = Math.max(maxY, point.y)
  }
  return { minX, maxX, minY, maxY }
}

describe('buildOpeningCutoutShape', () => {
  test('rectangle profile passes the rect through unchanged', () => {
    const door = DoorNode.parse({})
    const rect = { left: 1.2, right: 2.1, bottom: 0, top: 2.1 }

    const points = buildOpeningCutoutShape(door, rect).getPoints()

    expect(containsPoint(points, rect.left, rect.bottom)).toBe(true)
    expect(containsPoint(points, rect.right, rect.bottom)).toBe(true)
    expect(containsPoint(points, rect.right, rect.top)).toBe(true)
    expect(containsPoint(points, rect.left, rect.top)).toBe(true)

    const bounds = getBounds(points)
    expect(bounds.minX).toBeCloseTo(rect.left, 9)
    expect(bounds.maxX).toBeCloseTo(rect.right, 9)
    expect(bounds.minY).toBeCloseTo(rect.bottom, 9)
    expect(bounds.maxY).toBeCloseTo(rect.top, 9)
  })

  test('door rounded profile rounds only the top corners', () => {
    const door = DoorNode.parse({ openingShape: 'rounded', cornerRadius: 0.2 })
    const rect = { left: -0.45, right: 0.45, bottom: 0, top: 2.1 }

    const points = buildOpeningCutoutShape(door, rect).getPoints()

    expect(containsPoint(points, rect.left, rect.bottom)).toBe(true)
    expect(containsPoint(points, rect.right, rect.bottom)).toBe(true)
    expect(containsPoint(points, rect.left, rect.top)).toBe(false)
    expect(containsPoint(points, rect.right, rect.top)).toBe(false)
    expect(containsPoint(points, rect.left, rect.top - 0.2)).toBe(true)
    expect(containsPoint(points, rect.left + 0.2, rect.top)).toBe(true)
    expect(containsPoint(points, rect.right, rect.top - 0.2)).toBe(true)
    expect(containsPoint(points, rect.right - 0.2, rect.top)).toBe(true)
  })

  test('window rounded profile rounds all four corners', () => {
    const window = WindowNode.parse({ openingShape: 'rounded', cornerRadius: 0.2 })
    const rect = { left: -0.75, right: 0.75, bottom: 0.9, top: 2.4 }

    const points = buildOpeningCutoutShape(window, rect).getPoints()

    expect(containsPoint(points, rect.left, rect.bottom)).toBe(false)
    expect(containsPoint(points, rect.right, rect.bottom)).toBe(false)
    expect(containsPoint(points, rect.left, rect.top)).toBe(false)
    expect(containsPoint(points, rect.right, rect.top)).toBe(false)
    expect(containsPoint(points, rect.left + 0.2, rect.bottom)).toBe(true)
    expect(containsPoint(points, rect.left, rect.bottom + 0.2)).toBe(true)
    expect(containsPoint(points, rect.right - 0.2, rect.top)).toBe(true)
    expect(containsPoint(points, rect.right, rect.top - 0.2)).toBe(true)

    const bounds = getBounds(points)
    expect(bounds.minX).toBeCloseTo(rect.left, 9)
    expect(bounds.maxX).toBeCloseTo(rect.right, 9)
    expect(bounds.minY).toBeCloseTo(rect.bottom, 9)
    expect(bounds.maxY).toBeCloseTo(rect.top, 9)
  })

  test('shared corner radius is clamped to the opening half-extent', () => {
    const window = WindowNode.parse({ openingShape: 'rounded', cornerRadius: 10 })
    const rect = { left: -0.75, right: 0.75, bottom: 0.9, top: 2.4 }

    const points = buildOpeningCutoutShape(window, rect).getPoints()

    // 1.5 × 1.5 opening → radius clamps to 0.75; arcs meet at edge midpoints.
    expect(containsPoint(points, rect.left, rect.bottom + 0.75)).toBe(true)
    expect(containsPoint(points, rect.right, rect.top - 0.75)).toBe(true)

    const bounds = getBounds(points)
    expect(bounds.minX).toBeCloseTo(rect.left, 9)
    expect(bounds.maxX).toBeCloseTo(rect.right, 9)
  })

  test('individual radii normalize when their sum exceeds the opening width', () => {
    const window = WindowNode.parse({
      openingShape: 'rounded',
      openingRadiusMode: 'individual',
      openingCornerRadii: [4, 4, 0, 0],
    })
    const rect = { left: -0.5, right: 0.5, bottom: 0, top: 2 }

    const points = buildOpeningCutoutShape(window, rect).getPoints()

    // Width 1 with top radii summing to 8 → scaled down to 0.5 each.
    expect(containsPoint(points, rect.left, rect.top - 0.5)).toBe(true)
    expect(containsPoint(points, rect.left + 0.5, rect.top)).toBe(true)
    expect(containsPoint(points, rect.left, rect.bottom)).toBe(true)
    expect(containsPoint(points, rect.right, rect.bottom)).toBe(true)
  })

  test('arch profile springs at top - archHeight and peaks at the rect top', () => {
    const door = DoorNode.parse({ openingShape: 'arch', archHeight: 0.45 })
    const rect = { left: -0.45, right: 0.45, bottom: 0, top: 2.1 }

    const points = buildOpeningCutoutShape(door, rect).getPoints()

    expect(containsPoint(points, rect.left, rect.bottom)).toBe(true)
    expect(containsPoint(points, rect.right, rect.bottom)).toBe(true)
    expect(containsPoint(points, rect.right, rect.top - 0.45)).toBe(true)
    expect(containsPoint(points, 0, rect.top)).toBe(true)
    expect(containsPoint(points, rect.left, rect.top)).toBe(false)
    expect(containsPoint(points, rect.right, rect.top)).toBe(false)
  })

  test('profiles are origin-agnostic — offset rects yield translated points', () => {
    const window = WindowNode.parse({ openingShape: 'rounded', cornerRadius: 0.2 })
    const centered = buildOpeningCutoutShape(window, {
      left: -0.75,
      right: 0.75,
      bottom: -0.75,
      top: 0.75,
    }).getPoints()
    const offset = buildOpeningCutoutShape(window, {
      left: 2.25,
      right: 3.75,
      bottom: 0.9,
      top: 2.4,
    }).getPoints()

    for (const point of centered) {
      expect(containsPoint(offset, point.x + 3, point.y + 1.65)).toBe(true)
    }
    for (const point of offset) {
      expect(containsPoint(centered, point.x - 3, point.y - 1.65)).toBe(true)
    }
  })
})

describe('buildOpeningCutoutGeometry', () => {
  test('extrudes the rect through the depth, centered on the mid-plane', () => {
    const door = DoorNode.parse({})
    const geometry = buildOpeningCutoutGeometry(
      door,
      { left: -0.45, right: 0.45, bottom: -1.05, top: 1.05 },
      0.24,
      0.1,
    )

    geometry.computeBoundingBox()
    // Float32 position buffer → ~1e-7 relative precision.
    const box = geometry.boundingBox!
    expect(box.min.x).toBeCloseTo(-0.45, 6)
    expect(box.max.x).toBeCloseTo(0.45, 6)
    expect(box.min.y).toBeCloseTo(-1.05, 6)
    expect(box.max.y).toBeCloseTo(1.05, 6)
    expect(box.min.z).toBeCloseTo(-0.12, 6)
    expect(box.max.z).toBeCloseTo(0.12, 6)
  })
})

describe('hasFlatOpeningCutoutBottom', () => {
  test('flat for rectangles, arches, and door rounded (top-only radii)', () => {
    expect(hasFlatOpeningCutoutBottom(DoorNode.parse({}))).toBe(true)
    expect(hasFlatOpeningCutoutBottom(WindowNode.parse({ openingShape: 'arch' }))).toBe(true)
    expect(hasFlatOpeningCutoutBottom(DoorNode.parse({ openingShape: 'rounded' }))).toBe(true)
  })

  test('rounded windows depend on their bottom radii', () => {
    expect(hasFlatOpeningCutoutBottom(WindowNode.parse({ openingShape: 'rounded' }))).toBe(false)
    expect(
      hasFlatOpeningCutoutBottom(WindowNode.parse({ openingShape: 'rounded', cornerRadius: 0 })),
    ).toBe(true)
    expect(
      hasFlatOpeningCutoutBottom(
        WindowNode.parse({
          openingShape: 'rounded',
          openingRadiusMode: 'individual',
          openingCornerRadii: [0.2, 0.2, 0, 0],
        }),
      ),
    ).toBe(true)
    expect(
      hasFlatOpeningCutoutBottom(
        WindowNode.parse({
          openingShape: 'rounded',
          openingRadiusMode: 'individual',
          openingCornerRadii: [0.2, 0.2, 0.2, 0.2],
        }),
      ),
    ).toBe(false)
  })
})
