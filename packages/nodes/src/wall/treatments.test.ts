import { describe, expect, test } from 'bun:test'
import type { WallNode, WallTrimConfig } from '@pascal-app/core'
import { buildWallTreatmentLevelData } from './treatment-level-data'
import { buildTrimGeometry, wallTreatmentProudOffsets } from './treatments'

function wall(id: string, start: [number, number], end: [number, number]): WallNode {
  return {
    id,
    type: 'wall',
    object: 'node',
    visible: true,
    parentId: 'level_test',
    children: [],
    start,
    end,
    thickness: 0.1,
    height: 2.5,
    frontSide: 'interior',
    backSide: 'exterior',
    metadata: {},
  } as WallNode
}

const trim: WallTrimConfig = {
  enabled: true,
  height: 0.1,
  proud: 0.02,
  profile: 'flat',
  sides: 'both',
}

function treatmentLevelData(walls: WallNode[]) {
  const treatedWalls = walls.map((entry) => ({
    ...entry,
    skirting: trim,
    crown: trim,
    chairRail: trim,
  }))
  return buildWallTreatmentLevelData(treatedWalls, treatedWalls.flatMap(wallTreatmentProudOffsets))
}

function cornerXs(
  side: 'interior' | 'exterior',
  kind: 'skirting' | 'crown' | 'chairRail',
  outerOffset: number,
) {
  const walls = [wall('A', [0, 0], [3, 0]), wall('B', [0, 0], [0, 3])]
  const geometry = buildTrimGeometry(walls[0]!, side, trim, kind, [], treatmentLevelData(walls))
  expect(geometry).not.toBeNull()
  if (!geometry) throw new Error('expected trim geometry')

  const positions = geometry.getAttribute('position')
  const outerZ = side === 'interior' ? outerOffset : -outerOffset
  const xs: number[] = []
  for (let index = 0; index < positions.count; index += 1) {
    if (Math.abs(positions.getZ(index) - outerZ) < 1e-5) xs.push(positions.getX(index))
  }
  geometry.dispose()
  return xs
}

function allPositions(geometry: NonNullable<ReturnType<typeof buildTrimGeometry>>) {
  const positions = geometry.getAttribute('position')
  return Array.from({ length: positions.count }, (_, index) => ({
    x: positions.getX(index),
    y: positions.getY(index),
    z: positions.getZ(index),
  }))
}

describe('wall treatment miters', () => {
  test.each([
    ['skirting', 0.0624],
    ['crown', 0.0604],
    ['chairRail', 0.0616],
  ] as const)('preserves the %s outer miter endpoint on both sides', (kind, outerOffset) => {
    const interiorXs = cornerXs('interior', kind, outerOffset)
    const exteriorXs = cornerXs('exterior', kind, outerOffset)

    expect(interiorXs.length).toBeGreaterThan(0)
    expect(exteriorXs.length).toBeGreaterThan(0)
    expect(Math.min(...interiorXs)).toBeCloseTo(outerOffset, 5)
    expect(Math.min(...exteriorXs)).toBeCloseTo(-outerOffset, 5)
  })

  test('keeps each treatment on one physical side of an isolated wall', () => {
    const node = wall('A', [0, 0], [3, 0])
    const levelData = treatmentLevelData([node])

    for (const side of ['interior', 'exterior'] as const) {
      const geometry = buildTrimGeometry(node, side, trim, 'skirting', [], levelData)
      expect(geometry).not.toBeNull()
      if (!geometry) throw new Error('expected trim geometry')
      const positions = allPositions(geometry)

      expect(positions.every((point) => (side === 'interior' ? point.z > 0 : point.z < 0))).toBe(
        true,
      )
      expect(Math.min(...positions.map((point) => point.x))).toBeCloseTo(0, 6)
      expect(Math.max(...positions.map((point) => point.x))).toBeCloseTo(3, 6)
      geometry.dispose()
    }
  })

  test('joins the outer profile at an end-to-start room corner', () => {
    const walls = [wall('A', [0, 0], [3, 0]), wall('B', [3, 0], [3, 3])]
    const levelData = treatmentLevelData(walls)
    const a = buildTrimGeometry(walls[0]!, 'interior', trim, 'skirting', [], levelData)
    const b = buildTrimGeometry(walls[1]!, 'interior', trim, 'skirting', [], levelData)
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    if (!(a && b)) throw new Error('expected trim geometry')

    const aOuter = allPositions(a).filter((point) => Math.abs(point.z - 0.0624) < 1e-5)
    const bOuter = allPositions(b).filter((point) => Math.abs(point.z - 0.0624) < 1e-5)
    expect(Math.max(...aOuter.map((point) => point.x))).toBeCloseTo(2.9376, 5)
    expect(Math.min(...bOuter.map((point) => point.x))).toBeCloseTo(0.0624, 5)

    a.dispose()
    b.dispose()
  })

  test('keeps opening cuts at their local wall positions', () => {
    const node = wall('A', [0, 0], [3, 0])
    const geometry = buildTrimGeometry(
      node,
      'interior',
      trim,
      'skirting',
      [{ type: 'door', width: 1, height: 2, position: [1.5, 1, 0] }],
      treatmentLevelData([node]),
    )
    expect(geometry).not.toBeNull()
    if (!geometry) throw new Error('expected trim geometry')

    const xs = allPositions(geometry).map((point) => point.x)
    expect(xs.some((x) => Math.abs(x - 1) < 1e-6)).toBe(true)
    expect(xs.some((x) => Math.abs(x - 2) < 1e-6)).toBe(true)
    expect(xs.every((x) => x <= 1 + 1e-6 || x >= 2 - 1e-6)).toBe(true)
    geometry.dispose()
  })
})
