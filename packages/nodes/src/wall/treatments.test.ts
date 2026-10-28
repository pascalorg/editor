import { describe, expect, test } from 'bun:test'
import {
  calculateLevelMiters,
  getWallThickness,
  WallFaceScript,
  type WallNode,
  type WallTrimConfig,
} from '@pascal-app/core'
import {
  buildWallTreatmentLevelData,
  createWallTreatmentSelector,
  useWallTreatmentLevelData,
  type WallTreatmentLevelData,
} from './treatment-level-data'
import { buildTrimGeometry, hasWallTreatments, wallTreatmentProudOffsets } from './treatments'

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
  return buildWallTreatmentLevelData(
    'level_test',
    treatedWalls,
    treatedWalls.flatMap(wallTreatmentProudOffsets),
  )
}

function cornerXs(side: 'a' | 'b', kind: 'skirting' | 'crown' | 'chairRail', outerOffset: number) {
  const walls = [wall('A', [0, 0], [3, 0]), wall('B', [0, 0], [0, 3])]
  const geometry = buildTrimGeometry(walls[0]!, side, trim, kind, [], treatmentLevelData(walls))
  expect(geometry).not.toBeNull()
  if (!geometry) throw new Error('expected trim geometry')

  const positions = geometry.getAttribute('position')
  const outerZ = side === 'a' ? outerOffset : -outerOffset
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
  test('mount eligibility follows disabled defaults and each enabled trim kind', () => {
    const node = wall('A', [0, 0], [3, 0])
    expect(hasWallTreatments(node)).toBe(false)
    expect(wallTreatmentProudOffsets(node)).toEqual([])
    for (const kind of ['skirting', 'crown', 'chairRail'] as const) {
      expect(hasWallTreatments({ ...node, [kind]: trim })).toBe(true)
      expect(hasWallTreatments({ ...node, [kind]: { ...trim, enabled: false } })).toBe(false)
    }
  })

  test.each(['skirting', 'crown', 'chairRail'] as const)(
    'preserves %s position bytes with cached per-wall endpoint data',
    (kind) => {
      const cases = [
        [wall('A', [0, 0], [3, 0])],
        [wall('A', [0, 0], [3, 0]), wall('B', [3, 0], [3, 3])],
        [wall('A', [0, 0], [3, 0]), wall('B', [0, 0], [1, 3])],
        [wall('A', [0, 0], [0, 3]), wall('B', [-3, 0], [3, 0])],
        [{ ...wall('A', [0, 0], [3, 0]), curveOffset: 0.4 }],
      ]
      for (const walls of cases) {
        const node = { ...walls[0]!, [kind]: trim }
        const proudOffsets = wallTreatmentProudOffsets(node)
        const prouds = new Set([0, ...proudOffsets.map((proud) => Math.round(proud * 1e6) / 1e6)])
        const reference: WallTreatmentLevelData = {
          walls,
          miterDataByProud: new Map(
            [...prouds].map((proud) => [
              proud,
              calculateLevelMiters(
                proud === 0
                  ? [...walls]
                  : walls.map((entry) => ({
                      ...entry,
                      thickness: getWallThickness(entry) + proud * 2,
                    })),
              ),
            ]),
          ),
        }
        const data = buildWallTreatmentLevelData('level_test', walls, proudOffsets)
        const select = createWallTreatmentSelector(node, proudOffsets)
        const slice = select({
          ...useWallTreatmentLevelData.getState(),
          byLevelId: new Map([['level_test', data]]),
        })!
        for (const side of ['a', 'b'] as const) {
          const openings = [
            {
              type: 'door',
              width: 0.8,
              height: 2,
              position: [1.5, 1, 0] as [number, number, number],
            },
          ]
          const before = buildTrimGeometry(node, side, trim, kind, openings, reference)!
          const after = buildTrimGeometry(node, side, trim, kind, openings, slice)!
          expect(before).not.toBeNull()
          expect(after).not.toBeNull()
          const beforeArray = before.getAttribute('position').array
          const afterArray = after.getAttribute('position').array
          expect(
            new Uint8Array(afterArray.buffer, afterArray.byteOffset, afterArray.byteLength),
          ).toEqual(
            new Uint8Array(beforeArray.buffer, beforeArray.byteOffset, beforeArray.byteLength),
          )
          before.dispose()
          after.dispose()
        }
      }
    },
  )

  test.each([
    ['skirting', 0.0624],
    ['crown', 0.0604],
    ['chairRail', 0.0616],
  ] as const)('preserves the %s outer miter endpoint on both sides', (kind, outerOffset) => {
    const aXs = cornerXs('a', kind, outerOffset)
    const bXs = cornerXs('b', kind, outerOffset)

    expect(aXs.length).toBeGreaterThan(0)
    expect(bXs.length).toBeGreaterThan(0)
    expect(Math.min(...aXs)).toBeCloseTo(outerOffset, 5)
    expect(Math.min(...bXs)).toBeCloseTo(-outerOffset, 5)
  })

  test('keeps each treatment on one physical side of an isolated wall', () => {
    const node = wall('A', [0, 0], [3, 0])
    const levelData = treatmentLevelData([node])

    for (const side of ['a', 'b'] as const) {
      const geometry = buildTrimGeometry(node, side, trim, 'skirting', [], levelData)
      expect(geometry).not.toBeNull()
      if (!geometry) throw new Error('expected trim geometry')
      const positions = allPositions(geometry)

      expect(positions.every((point) => (side === 'a' ? point.z > 0 : point.z < 0))).toBe(true)
      expect(Math.min(...positions.map((point) => point.x))).toBeCloseTo(0, 6)
      expect(Math.max(...positions.map((point) => point.x))).toBeCloseTo(3, 6)
      geometry.dispose()
    }
  })

  test('joins the outer profile at an end-to-start room corner', () => {
    const walls = [wall('A', [0, 0], [3, 0]), wall('B', [3, 0], [3, 3])]
    const levelData = treatmentLevelData(walls)
    const a = buildTrimGeometry(walls[0]!, 'a', trim, 'skirting', [], levelData)
    const b = buildTrimGeometry(walls[1]!, 'a', trim, 'skirting', [], levelData)
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
      'a',
      trim,
      'skirting',
      [
        {
          type: 'door',
          width: 1,
          height: 2,
          position: [1.5, 1, 0],
          casingFaceA: false,
          casingFaceB: false,
        },
      ],
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

  // A door 1 m wide at 1.5 m, cased 0.1 m wide on face a only: its legs run from 0.9 to 1 and
  // from 2 to 2.1 on that face.
  const xsAround = (
    side: 'a' | 'b',
    kind: 'skirting' | 'chairRail',
    opening: { type: string; height: number; position: [number, number, number] },
  ) => {
    const node = wall('A', [0, 0], [3, 0])
    const geometry = buildTrimGeometry(
      node,
      side,
      { ...trim, offsetY: 0.9 },
      kind,
      [{ ...opening, width: 1, casingWidth: 0.1, casingFaceA: true, casingFaceB: false }],
      treatmentLevelData([node]),
    )
    if (!geometry) throw new Error('expected trim geometry')
    const xs = allPositions(geometry).map((point) => point.x)
    geometry.dispose()
    return xs
  }
  const breaksAt = (xs: number[], from: number, to: number) =>
    xs.some((x) => Math.abs(x - from) < 1e-6) &&
    xs.some((x) => Math.abs(x - to) < 1e-6) &&
    xs.every((x) => x <= from + 1e-6 || x >= to - 1e-6)

  test('stops against the casing legs on a cased face, at the cutout on the other', () => {
    const door = { type: 'door', height: 2, position: [1.5, 1, 0] as [number, number, number] }
    expect(breaksAt(xsAround('a', 'skirting', door), 0.9, 2.1)).toBe(true)
    expect(breaksAt(xsAround('b', 'skirting', door), 1, 2)).toBe(true)
  })

  test("a chair rail stops against a window's bottom board, though the cutout is above it", () => {
    // Sill at 1.02 m: the bottom board runs 0.92 to 1.02 m, the chair rail 0.9 to 1 m.
    const window = {
      type: 'window',
      height: 1.2,
      position: [1.5, 1.62, 0] as [number, number, number],
    }
    expect(breaksAt(xsAround('a', 'chairRail', window), 0.9, 2.1)).toBe(true)
    // Face b has no casing: the rail runs whole, end to end of the wall.
    expect(xsAround('b', 'chairRail', window).every((x) => x < 1e-6 || x > 3 - 1e-6)).toBe(true)
  })

  test('runs on under a window and breaks only under one that reaches the floor', () => {
    const node = wall('A', [0, 0], [3, 0])
    const xsUnder = (sill: number) => {
      const geometry = buildTrimGeometry(
        node,
        'a',
        trim,
        'skirting',
        [{ type: 'window', width: 1, height: 1.2, position: [1.5, sill + 0.6, 0] }],
        treatmentLevelData([node]),
      )
      if (!geometry) throw new Error('expected trim geometry')
      const xs = allPositions(geometry).map((point) => point.x)
      geometry.dispose()
      return xs
    }
    expect(xsUnder(0.9).some((x) => Math.abs(x - 1) < 1e-6 || Math.abs(x - 2) < 1e-6)).toBe(false)
    expect(xsUnder(0).every((x) => x <= 1 + 1e-6 || x >= 2 - 1e-6)).toBe(true)
  })

  test("gives way to its face's script where the build covers it, and runs whole under a splashback", () => {
    const scriptOver = (bottom: number) =>
      WallFaceScript.parse({
        kind: 'script',
        script: 'a'.repeat(64),
        artifact: 'b'.repeat(64),
        inputs: 'key',
        manifest: { bounds: { min: [1, bottom, 0], max: [2, 1.2, 0.01] }, triangles: 2 },
      })
    const xsOn = (side: 'a' | 'b', bottom: number) => {
      const node = { ...wall('A', [0, 0], [3, 0]), finishScripts: { a: scriptOver(bottom) } }
      const geometry = buildTrimGeometry(
        node,
        side,
        trim,
        'skirting',
        [],
        treatmentLevelData([node]),
      )
      if (!geometry) throw new Error('expected trim geometry')
      const xs = allPositions(geometry).map((point) => point.x)
      geometry.dispose()
      return xs
    }
    // Panelling from the floor: the skirting stops at its ends on its face, as at a door.
    expect(xsOn('a', 0).every((x) => x <= 1 + 1e-6 || x >= 2 - 1e-6)).toBe(true)
    expect(xsOn('a', 0).some((x) => Math.abs(x - 1) < 1e-6)).toBe(true)
    // The other face keeps its skirting; a splashback from 0.9 m leaves the skirting whole.
    for (const xs of [xsOn('b', 0), xsOn('a', 0.9)])
      expect(xs.some((x) => Math.abs(x - 1) < 1e-6 || Math.abs(x - 2) < 1e-6)).toBe(false)
  })
})
