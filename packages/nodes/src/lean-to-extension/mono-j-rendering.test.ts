import { describe, expect, test } from 'bun:test'
import { type AnyNode, LeanToExtensionNode, LevelNode, WallNode } from '@pascal-app/core'
import { generateRoofSegmentGeometry } from '@pascal-app/viewer'
import { Matrix4, Mesh, Quaternion, Raycaster, Vector3 } from 'three'
import { createLeanToAssembly } from './assembly'
import { leanToWallLocalPose, resolveLeanToWallPlacement } from './layout'
import { resolveLeanToFreestandingRunPlacement } from './placement'
import { applyLeanToWallAutoSpan } from './roof-attachment'

type Pt = readonly [number, number]
const YUP = new Vector3(0, 1, 0)

describe('continuous mono canopy rendering', () => {
  // Node ids are random (nanoid), so the L miter must not depend on id order.
  // Each case is built repeatedly; every build must agree and cover its single
  // corner cleanly (no black-wedge holes, no stepped overlaps).
  const lShapes: Record<string, Pt[]> = {
    'L forward': [
      [0, 0],
      [8, 0],
      [8, 4],
    ],
    'L reversed': [
      [8, 4],
      [8, 0],
      [0, 0],
    ],
    'L rotated': [
      [0, 0],
      [5.66, 5.66],
      [2.83, 8.49],
    ],
  }

  test('miters all four sheds around either face of a square room', () => {
    const level = LevelNode.parse({ id: 'level_square_room', level: 0 })
    const points: Pt[] = [
      [0, 0],
      [0, 8],
      [8, 8],
      [8, 0],
      [0, 0],
    ]
    const walls = points.slice(0, -1).map((start, index) =>
      WallNode.parse({
        id: `wall_square_room_${index}`,
        parentId: level.id,
        start,
        end: points[index + 1]!,
      }),
    )
    for (const side of ['front', 'back'] as const) {
      const runs = walls.map((wall, index) => ({
        ...applyLeanToWallAutoSpan(resolveLeanToWallPlacement(wall, 4, side)!, wall),
        id: `leanto_square_room_${side}_${index}`,
      }))
      const sourceNodes = Object.fromEntries(
        [level, ...walls, ...runs].map((node) => [node.id, node]),
      ) as Record<string, AnyNode>
      const assemblies = runs.map((run) => createLeanToAssembly(run, undefined, sourceNodes))

      for (const { segment } of assemblies) {
        expect(shedFootprintPieceCount(segment)).toBeGreaterThan(0)
        expect(openEndSideCount(segment)).toBe(2)
      }

      const renderNodes = Object.fromEntries(
        [level, ...walls, ...runs, ...assemblies.flatMap((a) => [a.roof, a.segment])].map(
          (node) => [node.id, node],
        ),
      ) as Record<string, AnyNode>
      const geometries = assemblies.map((assembly, index) => {
        const geometry = generateRoofSegmentGeometry(assembly.segment, renderNodes)
        geometry.applyMatrix4(wallSegmentWorldMatrix(walls[index]!, runs[index]!, assembly))
        return geometry
      })
      const coverage = sampleTopCoverage(geometries)
      for (const geometry of geometries) geometry.dispose()

      expect(coverage.holes).toBe(0)
      expect(coverage.overlaps).toBe(0)
    }
  })

  for (const [name, points] of Object.entries(lShapes)) {
    test(`${name}: deterministic miter with clean coverage`, () => {
      const builds = Array.from({ length: 8 }, (_, index) =>
        buildCanopy(`${name}_${index}`, points),
      )
      const verticalAreaKeys = new Set(builds.map((build) => build.totalVertical.toFixed(4)))
      expect(verticalAreaKeys.size).toBe(1)
      for (const build of builds) {
        expect(build.holes).toBe(0)
        expect(build.overlaps).toBe(0)
        // Both runs of an L are mitered: shaped footprint + a single joined side.
        for (const segment of build.segments) {
          expect(shedFootprintPieceCount(segment)).toBeGreaterThan(0)
          expect(openEndSideCount(segment)).toBe(1)
        }
      }
    })
  }

  test('flipped-projection L canopy miters without a raised overlap at the inside corner', () => {
    const { segments, holes, overlaps } = buildCanopy(
      'L flipped projection',
      [
        [0, 0],
        [8, 0],
        [8, 4],
      ],
      true,
    )

    for (const segment of segments) {
      expect(shedFootprintPieceCount(segment)).toBeGreaterThan(0)
      expect(openEndSideCount(segment)).toBe(1)
    }
    expect(holes).toBe(0)
    expect(overlaps).toBe(0)
  })

  test('miters the freestanding L from the supplied scene export', () => {
    const level = LevelNode.parse({ id: 'level_supplied_canopy', level: 0 })
    const runs = [
      LeanToExtensionNode.parse({
        id: 'leanto_supplied_horizontal',
        parentId: level.id,
        hostKind: 'freestanding',
        canopyForm: 'mono',
        position: [-4, 0, -21],
        rotation: [0, -Math.PI, 0],
        span: 8,
        projection: 2.5,
        highEdgeHeight: 2.8,
        lowEdgeHeight: 2.437534009422228,
        pitch: 10,
        highOverhang: 0,
        lowOverhang: 0.25,
        leftOverhang: 0.15,
        rightOverhang: 0.15,
        autoMiterCorners: true,
        highSideMode: 'independent-high-beam',
        connectionMode: 'manual',
      }),
      LeanToExtensionNode.parse({
        id: 'leanto_supplied_vertical',
        parentId: level.id,
        hostKind: 'freestanding',
        canopyForm: 'mono',
        position: [-8, 0, -25.75],
        rotation: [0, Math.PI / 2, 0],
        span: 9.5,
        projection: 2.5,
        highEdgeHeight: 2.8,
        lowEdgeHeight: 2.437534009422228,
        pitch: 10,
        highOverhang: 0,
        lowOverhang: 0.25,
        leftOverhang: 0.15,
        rightOverhang: 0.15,
        autoMiterCorners: true,
        highSideMode: 'independent-high-beam',
        connectionMode: 'manual',
      }),
    ]
    const { holes, overlaps, totalVertical, segments } = measureCanopyRuns(level, runs)

    expect(segments.map(shedFootprintPieceCount)).toEqual([1, 1])
    expect(holes).toBe(0)
    expect(overlaps).toBe(0)
    expect(totalVertical).toBeLessThan(0.05)
  })

  for (const angle of Array.from({ length: 90 }, (_, index) => 90 - index)) {
    test(`miters a two-run concave canopy at ${angle} degrees`, () => {
      const radians = (angle * Math.PI) / 180
      const { holes, overlaps, totalVertical, segments } = buildCanopy(`concave_${angle}_degrees`, [
        [0, 0],
        [8, 0],
        [8 + 6 * Math.cos(radians), 6 * Math.sin(radians)],
      ])

      expect(segments.map(shedFootprintPieceCount)).toEqual([1, 1])
      expect(holes).toBe(0)
      expect(overlaps).toBe(0)
      expect(totalVertical).toBeLessThan(0.05)
    })
  }

  test('joins a two-run canopy continuously at 0 degrees', () => {
    const { holes, overlaps, totalVertical } = buildCanopy('linear_0_degrees', [
      [0, 0],
      [8, 0],
      [14, 0],
    ])

    expect(holes).toBe(0)
    expect(overlaps).toBe(0)
    expect(totalVertical).toBeLessThan(0.05)
  })

  test('does not change an existing corner when later runs extend the chain', () => {
    const firstCorner = buildCanopy('stable_first_corner', [
      [0, 0],
      [8, 0],
      [8, 4],
    ])
    const extendedChain = buildCanopy('stable_first_corner_extended', [
      [0, 0],
      [8, 0],
      [8, 8],
      [3, 8],
    ])

    expect(roundedFootprints(extendedChain.segments[0]!.shedFootprintPieces)).toEqual(
      roundedFootprints(firstCorner.segments[0]!.shedFootprintPieces),
    )
    expect(extendedChain.segments.map(shedFootprintPieceCount)).toEqual([1, 1, 1])
    expect(extendedChain.holes).toBe(0)
    expect(extendedChain.overlaps).toBe(0)
  })

  test('miters either turn and slope direction throughout the angle range', () => {
    for (const angle of Array.from({ length: 90 }, (_, index) => 90 - index)) {
      const radians = (angle * Math.PI) / 180
      const corner: Pt = [8, 0]
      const forwardEnd: Pt = [8 + 6 * Math.cos(radians), 6 * Math.sin(radians)]
      const mirroredEnd: Pt = [8 + 6 * Math.cos(radians), -6 * Math.sin(radians)]
      const paths = [
        [[0, 0] as Pt, corner, forwardEnd],
        [forwardEnd, corner, [0, 0] as Pt],
        [[0, 0] as Pt, corner, mirroredEnd],
        [mirroredEnd, corner, [0, 0] as Pt],
      ]

      for (const [pathIndex, points] of paths.entries()) {
        for (const flipProjection of [false, true]) {
          const result = buildCanopy(
            `angle_${angle}_path_${pathIndex}_flip_${flipProjection}`,
            points,
            flipProjection,
          )
          expect(result.holes).toBe(0)
          expect(result.overlaps).toBe(0)
          expect(result.totalVertical).toBeLessThan(0.05)
        }
      }
    }
  }, 15_000)

  // J-shapes and closed loops use the same corner partitioning as an L at each end.
  const multiJointShapes: Record<string, Pt[]> = {
    'J three runs': [
      [0, 0],
      [8, 0],
      [8, 4],
      [3, 4],
    ],
    'J reversed': [
      [3, 4],
      [8, 4],
      [8, 0],
      [0, 0],
    ],
    'J different lengths': [
      [0, 0],
      [12, 0],
      [12, 3],
      [5, 3],
    ],
    'reported diagonal J': [
      [-7, 11.5],
      [2, 12],
      [7, 7],
      [15.5, 7.5],
    ],
    'top-first J': [
      [-6, 2.5],
      [0, -3.5],
      [4.5, 1.5],
      [2, 4],
    ],
    'square closed': [
      [0, 0],
      [8, 0],
      [8, 8],
      [0, 8],
      [0, 0],
    ],
  }

  for (const [name, points] of Object.entries(multiJointShapes)) {
    test(`${name}: deterministic miter with valid joint geometry`, () => {
      const { segments, holes } = buildCanopy(name, points)
      expect(segments.map(shedFootprintPieceCount)).toEqual(segments.map(() => 1))
      for (const segment of segments) {
        expect(shedFootprintPieceCount(segment)).toBeGreaterThan(0)
        expect(openEndSideCount(segment)).toBeGreaterThan(0)
      }
      expect(holes).toBe(0)
    })
  }
})

function shedFootprintPieceCount(segment: ReturnType<typeof createLeanToAssembly>['segment']) {
  const pieces = (segment as Record<string, unknown>).shedFootprintPieces
  return Array.isArray(pieces) ? pieces.length : 0
}

function roundedFootprints(footprints: [number, number][][] | undefined) {
  return footprints?.map((polygon) =>
    polygon.map(([x, z]) => [Number(x.toFixed(9)), Number(z.toFixed(9))]),
  )
}

function openEndSideCount(segment: ReturnType<typeof createLeanToAssembly>['segment']) {
  const sides = (segment as Record<string, unknown>).shedOpenEndSides
  return Array.isArray(sides) ? sides.length : 0
}

function worldMatrix(assembly: ReturnType<typeof createLeanToAssembly>) {
  const extension = assembly.extension
  const roof = assembly.roof
  const seg = assembly.segment
  const extensionM = new Matrix4().compose(
    new Vector3(...(extension.position as number[])),
    new Quaternion().setFromAxisAngle(YUP, extension.rotation[1]),
    new Vector3(1, 1, 1),
  )
  const roofM = new Matrix4().compose(
    new Vector3(...(roof.position as number[])),
    new Quaternion().setFromAxisAngle(YUP, (roof.rotation as number) ?? 0),
    new Vector3(1, 1, 1),
  )
  const segM = new Matrix4().compose(
    new Vector3(...(seg.position as number[])),
    new Quaternion().setFromAxisAngle(YUP, seg.rotation ?? 0),
    new Vector3(1, 1, 1),
  )
  return extensionM.multiply(roofM).multiply(segM)
}

function wallSegmentWorldMatrix(
  wall: ReturnType<typeof WallNode.parse>,
  leanTo: Parameters<typeof leanToWallLocalPose>[1],
  assembly: ReturnType<typeof createLeanToAssembly>,
) {
  const pose = leanToWallLocalPose(wall, leanTo, 0)
  return new Matrix4()
    .makeTranslation(...pose.position)
    .multiply(new Matrix4().makeRotationY(pose.rotationY))
    .multiply(new Matrix4().makeTranslation(...assembly.segment.position))
    .multiply(new Matrix4().makeRotationY(assembly.segment.rotation))
}

// Build a continuous mono canopy from a poly-line and measure the rendered roof
// segments: the total vertical roof-finish (material 3) area used to close
// internal miter steps, plus a top-down coverage scan for holes/overlaps.
function buildCanopy(name: string, points: readonly Pt[], flipProjection = false) {
  return buildCanopyRuns(
    name,
    points.slice(0, -1).map((start, index) => ({
      start,
      end: points[index + 1]!,
      flipProjection,
    })),
  )
}

function buildCanopyRuns(
  name: string,
  runInputs: readonly {
    start: Pt
    end: Pt
    flipProjection: boolean
  }[],
) {
  const level = LevelNode.parse({ id: `level_${name}`, level: 0 })
  const runs = runInputs.map(
    ({ start, end, flipProjection }) =>
      resolveLeanToFreestandingRunPlacement(level.id, start, end, flipProjection, 'mono')!,
  )
  return measureCanopyRuns(level, runs)
}

function measureCanopyRuns(level: ReturnType<typeof LevelNode.parse>, runs: LeanToExtensionNode[]) {
  const sourceNodes = Object.fromEntries([level, ...runs].map((node) => [node.id, node])) as Record<
    string,
    AnyNode
  >
  const assemblies = runs.map((run) => createLeanToAssembly(run, undefined, sourceNodes))
  const renderNodes = Object.fromEntries(
    [level, ...runs, ...assemblies.flatMap((a) => [a.roof, a.segment])].map((n) => [n.id, n]),
  ) as Record<string, AnyNode>

  const worldGeoms = []
  const perSegVertical: number[] = []
  const a = new Vector3()
  const b = new Vector3()
  const c = new Vector3()
  const normal = new Vector3()
  for (const assembly of assemblies) {
    const geometry = generateRoofSegmentGeometry(assembly.segment, renderNodes)
    let segVertical = 0
    const position = geometry.getAttribute('position')
    const index = geometry.getIndex()!
    for (const group of geometry.groups) {
      if (group.materialIndex !== 3) continue
      for (let offset = group.start; offset < group.start + group.count; offset += 3) {
        a.fromBufferAttribute(position, index.getX(offset))
        b.fromBufferAttribute(position, index.getX(offset + 1))
        c.fromBufferAttribute(position, index.getX(offset + 2))
        normal.crossVectors(b.clone().sub(a), c.clone().sub(a))
        const area = normal.length() / 2
        normal.normalize()
        if (Math.abs(normal.y) <= 0.05) segVertical += area
      }
    }
    perSegVertical.push(segVertical)
    geometry.applyMatrix4(worldMatrix(assembly))
    worldGeoms.push(geometry)
  }

  const coverage = sampleTopCoverage(worldGeoms)
  for (const geometry of worldGeoms) geometry.dispose()
  const totalVertical = perSegVertical.reduce((sum, value) => sum + value, 0)
  return { perSegVertical, totalVertical, segments: assemblies.map((a) => a.segment), ...coverage }
}

// Cast rays straight down over the union footprint. A covered interior column
// should hit exactly one upward-facing (material 3) surface: zero means a
// hole/black wedge, two separated hits means overlapping planes.
function sampleTopCoverage(worldGeoms: ReturnType<typeof generateRoofSegmentGeometry>[]) {
  const meshes = worldGeoms.map((geometry) => new Mesh(geometry))
  const raycaster = new Raycaster()
  raycaster.firstHitOnly = false
  const box = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity, maxY: -Infinity }
  for (const geometry of worldGeoms) {
    geometry.computeBoundingBox()
    const bounds = geometry.boundingBox!
    box.minX = Math.min(box.minX, bounds.min.x)
    box.maxX = Math.max(box.maxX, bounds.max.x)
    box.minZ = Math.min(box.minZ, bounds.min.z)
    box.maxZ = Math.max(box.maxZ, bounds.max.z)
    box.maxY = Math.max(box.maxY, bounds.max.y)
  }
  const step = 0.15
  const inset = 0.35
  const direction = new Vector3(0, -1, 0)
  const origin = new Vector3()
  let holes = 0
  let overlaps = 0
  for (let x = box.minX + inset; x <= box.maxX - inset; x += step) {
    for (let z = box.minZ + inset; z <= box.maxZ - inset; z += step) {
      origin.set(x, box.maxY + 5, z)
      raycaster.set(origin, direction)
      let anyHit = false
      const topYs: number[] = []
      for (const mesh of meshes) {
        const hits = raycaster.intersectObject(mesh, false)
        if (hits.length > 0) anyHit = true
        for (const hit of hits) {
          if ((hit.face?.normal.y ?? 0) > 0.2) topYs.push(hit.point.y)
        }
      }
      if (!anyHit) continue
      if (topYs.length === 0) holes += 1
      else if (topYs.length >= 2) {
        topYs.sort((first, second) => first - second)
        if (topYs[topYs.length - 1]! - topYs[0]! > 0.02) overlaps += 1
      }
    }
  }
  return { holes, overlaps }
}
