import { describe, expect, test } from 'bun:test'
import { type AnyNode, LevelNode } from '@pascal-app/core'
import { generateRoofSegmentGeometry } from '@pascal-app/viewer'
import { Matrix4, Mesh, Quaternion, Raycaster, Vector3 } from 'three'
import { createLeanToAssembly } from './assembly'
import { resolveLeanToFreestandingRunPlacement } from './placement'

type Pt = readonly [number, number]
const YUP = new Vector3(0, 1, 0)

// Corner mitering is only applied to a single-corner L (a joined chain of two
// runs). J-shapes, longer chains, and closed loops intentionally render as plain
// overlapping runs: no shaped footprint pieces and no joint step closures.
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

  // A J-shape (and longer chains / closed loops) must NOT be mitered: every run
  // renders as a plain rectangle with no shaped footprint and no joined sides.
  const unmiteredShapes: Record<string, Pt[]> = {
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
    'square closed': [
      [0, 0],
      [8, 0],
      [8, 8],
      [0, 8],
      [0, 0],
    ],
  }

  for (const [name, points] of Object.entries(unmiteredShapes)) {
    test(`${name}: renders as plain un-mitered runs`, () => {
      const { segments } = buildCanopy(name, points)
      // No shaped footprint and no joined sides: each run is a plain rectangle.
      for (const segment of segments) {
        expect(shedFootprintPieceCount(segment)).toBe(0)
        expect(openEndSideCount(segment)).toBe(0)
      }
    })
  }
})

function shedFootprintPieceCount(segment: ReturnType<typeof createLeanToAssembly>['segment']) {
  const pieces = (segment as Record<string, unknown>).shedFootprintPieces
  return Array.isArray(pieces) ? pieces.length : 0
}

function openEndSideCount(segment: ReturnType<typeof createLeanToAssembly>['segment']) {
  const sides = (segment as Record<string, unknown>).shedOpenEndSides
  return Array.isArray(sides) ? sides.length : 0
}

function worldMatrix(assembly: ReturnType<typeof createLeanToAssembly>) {
  const roof = assembly.roof
  const seg = assembly.segment
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
  return roofM.multiply(segM)
}

// Build a continuous mono canopy from a poly-line and measure the rendered roof
// segments: the total vertical roof-finish (material 3) area used to close
// internal miter steps, plus a top-down coverage scan for holes/overlaps.
function buildCanopy(name: string, points: readonly Pt[]) {
  const level = LevelNode.parse({ id: `level_${name}`, level: 0 })
  const runs = points
    .slice(0, -1)
    .map(
      (start, index) =>
        resolveLeanToFreestandingRunPlacement(level.id, start, points[index + 1]!, false, 'mono')!,
    )
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
