// @ts-expect-error - bun:test is provided by the Bun runtime; viewer does not
// include Bun globals in its package tsconfig.
import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  LeanToExtensionNode,
  RoofNode,
  RoofSegmentNode,
  WallNode,
} from '@pascal-app/core'
import * as THREE from 'three'
import { generateRoofSegmentGeometry } from './roof-system'

describe('roof system shed geometry', () => {
  function inspectShedGeometry(segment: RoofSegmentNode) {
    const geometry = generateRoofSegmentGeometry(segment)
    const position = geometry.getAttribute('position')
    const index = geometry.getIndex()
    expect(index).not.toBeNull()

    const sideInfillX: number[] = []
    const sideInfillNormals: THREE.Vector3[] = []
    const roofSideX: number[] = []
    const wallVertexYs: number[] = []
    const a = new THREE.Vector3()
    const b = new THREE.Vector3()
    const c = new THREE.Vector3()
    const normal = new THREE.Vector3()
    const edge = new THREE.Vector3()

    expect(geometry.groups.some((group) => group.materialIndex === 1)).toBe(false)

    for (const group of geometry.groups) {
      for (let i = group.start; i < group.start + group.count; i += 3) {
        const ia = index!.getX(i)
        const ib = index!.getX(i + 1)
        const ic = index!.getX(i + 2)
        a.fromBufferAttribute(position, ia)
        b.fromBufferAttribute(position, ib)
        c.fromBufferAttribute(position, ic)
        normal.subVectors(b, a).cross(edge.subVectors(c, a)).normalize()

        if (group.materialIndex === 0 || group.materialIndex === 3) {
          roofSideX.push(Math.abs(a.x), Math.abs(b.x), Math.abs(c.x))
        }

        if (group.materialIndex === 2) {
          const vertexIndices = [ia, ib, ic]
          for (const vertexIndex of vertexIndices) {
            wallVertexYs.push(position.getY(vertexIndex))
          }
          if (
            vertexIndices.every(
              (vertexIndex) => position.getY(vertexIndex) >= segment.wallHeight - 0.05,
            )
          ) {
            sideInfillNormals.push(normal.clone())
            for (const vertexIndex of vertexIndices) {
              sideInfillX.push(position.getX(vertexIndex))
            }
          }
        }
      }
    }

    return { geometry, roofSideX, sideInfillNormals, sideInfillX, wallVertexYs }
  }

  test('keeps the standalone shed wall shell beneath the overhanging roof edge', () => {
    const segment = RoofSegmentNode.parse({
      id: 'rseg_shed',
      type: 'roof-segment',
      roofType: 'shed',
      width: 8,
      depth: 6,
      wallHeight: 2.6,
      wallThickness: 0.1,
      pitch: 25,
      overhang: 0.3,
      deckThickness: 0.1,
      shingleThickness: 0.05,
    })
    const wallSideX = segment.width / 2
    const { geometry, roofSideX, wallVertexYs } = inspectShedGeometry(segment)

    expect(wallVertexYs.length).toBeGreaterThan(0)
    expect(Math.min(...wallVertexYs)).toBeLessThan(segment.wallHeight / 2)
    expect(Math.max(...roofSideX)).toBeGreaterThan(wallSideX + segment.overhang * 0.5)

    geometry.dispose()
  })

  test('retains the wall shell when changing a standalone segment to shed', () => {
    const original = RoofSegmentNode.parse({
      id: 'rseg_switched_to_shed',
      type: 'roof-segment',
      roofType: 'gable',
      width: 8,
      depth: 6,
      wallHeight: 2.6,
      wallThickness: 0.1,
      pitch: 25,
      overhang: 0.3,
      deckThickness: 0.1,
      shingleThickness: 0.05,
    })
    const segment = RoofSegmentNode.parse({ ...original, roofType: 'shed' })
    const geometry = generateRoofSegmentGeometry(segment)
    const position = geometry.getAttribute('position')
    const index = geometry.getIndex()
    expect(index).not.toBeNull()

    const wallVertexYs: number[] = []
    for (const group of geometry.groups) {
      if (group.materialIndex !== 2) continue
      for (let offset = group.start; offset < group.start + group.count; offset += 1) {
        wallVertexYs.push(position.getY(index!.getX(offset)))
      }
    }

    expect(wallVertexYs.length).toBeGreaterThan(0)
    expect(Math.min(...wallVertexYs)).toBeLessThan(segment.wallHeight / 2)

    geometry.dispose()
  })

  test('omits overlapping wall shells from legacy composite shed roofs', () => {
    const roof = RoofNode.parse({
      id: 'roof_legacy_composite_shed',
      type: 'roof',
      children: ['rseg_legacy_shed_a', 'rseg_legacy_shed_b'],
    })
    const segment = RoofSegmentNode.parse({
      id: 'rseg_legacy_shed_a',
      type: 'roof-segment',
      parentId: roof.id,
      roofType: 'shed',
      width: 8,
      depth: 6,
      wallHeight: 0.1,
      wallThickness: 0.1,
      pitch: 25,
      overhang: 0.3,
      deckThickness: 0.1,
      shingleThickness: 0.05,
    })
    const sibling = RoofSegmentNode.parse({
      ...segment,
      id: 'rseg_legacy_shed_b',
      position: [2, 0, 0],
      rotation: Math.PI / 4,
    })
    const geometry = generateRoofSegmentGeometry(segment, {
      [roof.id]: roof,
      [segment.id]: segment,
      [sibling.id]: sibling,
    })

    expect(geometry.groups.some((group) => group.materialIndex === 2)).toBe(false)

    geometry.dispose()
  })

  test('keeps configured shed side infill on the outer side-member face', () => {
    const span = 4
    const leftOverhang = 0.15
    const rightOverhang = 0.15
    const rafterWidth = 0.08
    const infillHalfWidth = span / 2 + rafterWidth / 2
    const segment = RoofSegmentNode.parse({
      id: 'rseg_custom_shed',
      type: 'roof-segment',
      roofType: 'shed',
      width: span + leftOverhang + rightOverhang,
      depth: 2.77,
      wallHeight: 0,
      wallThickness: 0.01,
      pitch: 10,
      overhang: 0,
      deckThickness: 0.1,
      shingleThickness: 0.025,
      shedSideInfillSpan: span,
      shedSideInfillMinX: -infillHalfWidth,
      shedSideInfillMaxX: infillHalfWidth,
      shedInsetEndPanels: true,
      wallShell: 'omit',
    })
    const { geometry, roofSideX, sideInfillNormals, sideInfillX } = inspectShedGeometry(segment)

    expect(sideInfillNormals).toHaveLength(2)
    expect(Math.max(...sideInfillX.map((x) => Math.abs(x)))).toBeCloseTo(infillHalfWidth, 5)
    expect(Math.max(...sideInfillX.map((x) => Math.abs(x)))).toBeGreaterThan(span / 2)
    expect(Math.max(...sideInfillX.map((x) => Math.abs(x)))).toBeLessThan(span / 2 + leftOverhang)
    expect(Math.max(...roofSideX)).toBeGreaterThan(span / 2 + leftOverhang * 0.5)

    geometry.dispose()
  })

  test('does not emit vertical fascia along a connected shed footprint edge', () => {
    const parent = RoofNode.parse({
      id: 'roof_connected_shed',
      type: 'roof',
      children: ['rseg_connected_a', 'rseg_connected_b'],
    })
    const base = RoofSegmentNode.parse({
      id: 'rseg_connected_a',
      type: 'roof-segment',
      parentId: parent.id,
      roofType: 'shed',
      width: 2,
      depth: 2,
      wallHeight: 0,
      wallThickness: 0.01,
      pitch: 15,
      overhang: 0,
      deckThickness: 0.1,
      shingleThickness: 0.025,
      wallShell: 'omit',
      shedFootprintPieces: [
        [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ],
      ],
    })
    const sibling = RoofSegmentNode.parse({
      ...base,
      id: 'rseg_connected_b',
      position: [2, 0, 0],
    })
    const nodes = {
      [parent.id]: parent,
      [base.id]: base,
      [sibling.id]: sibling,
    }
    const geometry = generateRoofSegmentGeometry(base, nodes)
    const position = geometry.getAttribute('position')
    const index = geometry.getIndex()!
    const normal = new THREE.Vector3()
    let verticalTriangles = 0
    for (const group of geometry.groups) {
      for (let offset = group.start; offset < group.start + group.count; offset += 3) {
        const a = new THREE.Vector3().fromBufferAttribute(position, index.getX(offset))
        const b = new THREE.Vector3().fromBufferAttribute(position, index.getX(offset + 1))
        const c = new THREE.Vector3().fromBufferAttribute(position, index.getX(offset + 2))
        normal.subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize()
        if (Math.abs(normal.y) < 1e-6) verticalTriangles += 1
      }
    }

    expect(verticalTriangles).toBe(6)
    geometry.dispose()
  })

  test('omits the vertical cut face along a managed diagonal shed seam', () => {
    const parent = RoofNode.parse({
      id: 'roof_connected_diagonal_shed',
      type: 'roof',
      children: ['rseg_diagonal_a', 'rseg_diagonal_b'],
    })
    const base = RoofSegmentNode.parse({
      id: 'rseg_diagonal_a',
      type: 'roof-segment',
      parentId: parent.id,
      roofType: 'shed',
      width: 2,
      depth: 2,
      wallHeight: 0,
      wallThickness: 0.01,
      pitch: 15,
      overhang: 0,
      deckThickness: 0.1,
      shingleThickness: 0.025,
      wallShell: 'omit',
      managedByParent: true,
      trim: { frontRightX: 1, frontRightZ: 1 },
    })
    const sibling = RoofSegmentNode.parse({
      ...base,
      id: 'rseg_diagonal_b',
      managedByParent: false,
      trim: {},
      shedFootprintPieces: [
        [
          [1, 0],
          [1, 1],
          [0, 1],
        ],
      ],
    })
    const nodes = {
      [parent.id]: parent,
      [base.id]: base,
      [sibling.id]: sibling,
    }
    const geometry = generateRoofSegmentGeometry(base, nodes)
    const position = geometry.getAttribute('position')
    const index = geometry.getIndex()!
    const normal = new THREE.Vector3()
    let diagonalVerticalTriangles = 0

    for (const group of geometry.groups) {
      for (let offset = group.start; offset < group.start + group.count; offset += 3) {
        const a = new THREE.Vector3().fromBufferAttribute(position, index.getX(offset))
        const b = new THREE.Vector3().fromBufferAttribute(position, index.getX(offset + 1))
        const c = new THREE.Vector3().fromBufferAttribute(position, index.getX(offset + 2))
        normal.subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize()
        if (Math.abs(normal.y) > 1e-6) continue
        if ([a, b, c].every((point) => Math.abs(point.x + point.z - 1) < 1e-6)) {
          diagonalVerticalTriangles += 1
        }
      }
    }

    expect(diagonalVerticalTriangles).toBe(0)
    geometry.dispose()
  })

  test('bends a curved shed deck into a thin concentric band (no balloon)', () => {
    const depth = 2
    // Arc chosen so the back (wall) edge lands at radius 5 and the front edge
    // at radius 5 - depth = 3: a thin band, never a disc.
    const centerX = 0
    const centerZ = 5 - depth / 2
    const radius = 5
    const segment = RoofSegmentNode.parse({
      id: 'rseg_curved_shed',
      type: 'roof-segment',
      roofType: 'shed',
      width: 8,
      depth,
      wallHeight: 0,
      wallThickness: 0.01,
      pitch: 10,
      overhang: 0,
      deckThickness: 0.1,
      shingleThickness: 0.025,
      arc: { centerX, centerZ, radius },
    })

    const geometry = generateRoofSegmentGeometry(segment)
    const position = geometry.getAttribute('position')
    expect(position.count).toBeGreaterThan(0)
    // O(N) vertices, not O(N^2): a faceted band, not a triangulated disc.
    expect(position.count).toBeLessThan(1000)

    const distances: number[] = []
    for (let i = 0; i < position.count; i++) {
      const dx = position.getX(i) - centerX
      const dz = position.getZ(i) - centerZ
      distances.push(Math.hypot(dx, dz))
    }
    const minR = Math.min(...distances)
    const maxR = Math.max(...distances)

    // Every vertex stays within the annulus [R - depth, R]; nothing fans out
    // toward the center (the old sagitta balloon bug drove vertices to ~0).
    expect(minR).toBeGreaterThan(radius - depth - 0.02)
    expect(maxR).toBeLessThan(radius + 0.02)
    // The band spans one depth in radius, with its outer edge at the wall.
    expect(maxR).toBeCloseTo(radius, 1)
    expect(minR).toBeCloseTo(radius - depth, 1)

    const distanceToEdge = (a: THREE.Vector3, b: THREE.Vector3) => {
      const ax = a.x - centerX
      const az = a.z - centerZ
      const bx = b.x - centerX
      const bz = b.z - centerZ
      const dx = bx - ax
      const dz = bz - az
      const lengthSquared = dx * dx + dz * dz
      const t =
        lengthSquared > 1e-12 ? Math.max(0, Math.min(1, -(ax * dx + az * dz) / lengthSquared)) : 0
      return Math.hypot(ax + dx * t, az + dz * t)
    }
    const index = geometry.getIndex()!
    let minimumTriangleEdgeRadius = Number.POSITIVE_INFINITY
    const a = new THREE.Vector3()
    const b = new THREE.Vector3()
    const c = new THREE.Vector3()
    for (let offset = 0; offset < index.count; offset += 3) {
      a.fromBufferAttribute(position, index.getX(offset))
      b.fromBufferAttribute(position, index.getX(offset + 1))
      c.fromBufferAttribute(position, index.getX(offset + 2))
      minimumTriangleEdgeRadius = Math.min(
        minimumTriangleEdgeRadius,
        distanceToEdge(a, b),
        distanceToEdge(b, c),
        distanceToEdge(c, a),
      )
    }

    // Vertex-only checks miss fan-triangulation diagonals that cut across the
    // open center and visually fill the annulus as a solid sector.
    expect(minimumTriangleEdgeRadius).toBeGreaterThan(radius - depth - 0.1)

    geometry.dispose()
  })

  test('keeps a reverse-radius curved shed as a sloped annular band', () => {
    const depth = 2
    const centerX = 0
    const centerZ = -6
    const highRadius = 5
    const lowRadius = 7
    const segment = RoofSegmentNode.parse({
      id: 'rseg_curved_shed_outer',
      type: 'roof-segment',
      roofType: 'shed',
      width: 8,
      depth,
      wallHeight: 0,
      wallThickness: 0.01,
      pitch: 10,
      overhang: 0,
      deckThickness: 0.1,
      shingleThickness: 0.025,
      arc: { centerX, centerZ, radius: highRadius },
    })

    const geometry = generateRoofSegmentGeometry(segment)
    const position = geometry.getAttribute('position')
    const index = geometry.getIndex()!
    let minRadius = Number.POSITIVE_INFINITY
    let maxRadius = Number.NEGATIVE_INFINITY
    const topHighYs: number[] = []
    const topLowYs: number[] = []

    for (let vertex = 0; vertex < position.count; vertex++) {
      const radius = Math.hypot(position.getX(vertex) - centerX, position.getZ(vertex) - centerZ)
      minRadius = Math.min(minRadius, radius)
      maxRadius = Math.max(maxRadius, radius)
    }
    for (const group of geometry.groups) {
      if (group.materialIndex !== 3) continue
      for (let offset = group.start; offset < group.start + group.count; offset++) {
        const vertex = index.getX(offset)
        const radius = Math.hypot(position.getX(vertex) - centerX, position.getZ(vertex) - centerZ)
        if (Math.abs(radius - highRadius) < 0.05) topHighYs.push(position.getY(vertex))
        if (Math.abs(radius - lowRadius) < 0.05) topLowYs.push(position.getY(vertex))
      }
    }

    expect(minRadius).toBeCloseTo(highRadius, 1)
    expect(maxRadius).toBeCloseTo(lowRadius, 1)
    expect(topHighYs.length).toBeGreaterThan(0)
    expect(topLowYs.length).toBeGreaterThan(0)
    expect(Math.min(...topHighYs)).toBeGreaterThan(Math.max(...topLowYs))

    geometry.dispose()
  })

  test('keeps the curved-to-straight miter patch flush along the full seam', () => {
    const curvedWall = WallNode.parse({
      id: 'wall_curved_transition',
      parentId: 'level_curved_transition',
      start: [8, 8.5],
      end: [0.5, 3],
      curveOffset: 2,
    })
    const straightWall = WallNode.parse({
      id: 'wall_straight_transition',
      parentId: 'level_curved_transition',
      start: [0.5, 3],
      end: [-5.5, 7],
    })
    const curvedLeanTo = LeanToExtensionNode.parse({
      id: 'leanto_curved_transition',
      parentId: curvedWall.id,
      position: [5.20303160795228, 0, 0.05],
      span: 10.106063215904559,
      projection: 2.5,
      highEdgeHeight: 2.3,
      pitch: 10,
    })
    const straightLeanTo = LeanToExtensionNode.parse({
      id: 'leanto_straight_transition',
      parentId: straightWall.id,
      position: [3.6055512754639896, 0, 0.05],
      span: 6.911102550927978,
      projection: 2.5,
      highEdgeHeight: 2.3,
      pitch: 10,
    })
    const curvedRoof = RoofNode.parse({
      id: 'roof_curved_transition',
      parentId: curvedLeanTo.id,
      children: ['rseg_curved_transition'],
    })
    const straightRoof = RoofNode.parse({
      id: 'roof_straight_transition',
      parentId: straightLeanTo.id,
      children: ['rseg_straight_transition'],
    })
    const curvedSegment = RoofSegmentNode.parse({
      id: 'rseg_curved_transition',
      parentId: curvedRoof.id,
      metadata: {
        managedByLeanTo: curvedLeanTo.id,
        leanToShedJointNeighbors: [straightLeanTo.id],
      },
      position: [0, 1.68852513052742, 1.363],
      roofType: 'shed',
      width: 10.40606321590456,
      depth: 2.77,
      pitch: 10,
      wallThickness: 0.01,
      deckThickness: 0.1,
      shingleThickness: 0.025,
      arc: { centerX: 0, centerZ: 4.993249999999998, radius: 6.406249999999998 },
      shedFootprintPieces: [
        [
          [-5.20303160795228, -1.383],
          [5.20303160795228, -1.383],
          [5.20303160795228, 1.3850000000000002],
          [-5.20303160795228, 1.3850000000000002],
        ],
      ],
      managedByParent: true,
      wallShell: 'omit',
    })
    const straightSegment = RoofSegmentNode.parse({
      id: 'rseg_straight_transition',
      parentId: straightRoof.id,
      metadata: {
        managedByLeanTo: straightLeanTo.id,
        leanToShedJointNeighbors: [curvedLeanTo.id],
      },
      position: [0, 1.68852513052742, 1.363],
      roofType: 'shed',
      width: 7.211102550927979,
      depth: 2.77,
      pitch: 10,
      wallThickness: 0.01,
      deckThickness: 0.1,
      shingleThickness: 0.025,
      shedFootprintPieces: [
        [
          [-3.6055512754639896, -1.383],
          [3.6055512754639896, -1.383],
          [3.6055512754639896, 1.3850000000000002],
          [-3.6055512754639896, 1.3850000000000002],
        ],
        [
          [-3.6319612690700067, -1.4272651623364798],
          [-6.10960453124532, -2.661407725169994],
          [-3.6055512754639896, 1.3850000000000002],
        ],
      ],
      managedByParent: true,
      wallShell: 'omit',
    })
    const nodes = Object.fromEntries(
      [
        curvedWall,
        straightWall,
        curvedLeanTo,
        straightLeanTo,
        curvedRoof,
        straightRoof,
        curvedSegment,
        straightSegment,
      ].map((node) => [node.id, node]),
    ) as Record<string, AnyNode>

    const curvedGeometry = generateRoofSegmentGeometry(curvedSegment, nodes)
    const straightGeometry = generateRoofSegmentGeometry(straightSegment, nodes)
    const topAt = (geometry: THREE.BufferGeometry, point: readonly [number, number]) => {
      const position = geometry.getAttribute('position')
      const heights: number[] = []
      for (let index = 0; index < position.count; index++) {
        if (Math.hypot(position.getX(index) - point[0], position.getZ(index) - point[1]) < 1e-4) {
          heights.push(position.getY(index))
        }
      }
      return Math.max(...heights)
    }
    const bend = ([x, z]: readonly [number, number]): [number, number] => {
      const arc = curvedSegment.arc!
      const signedRef = (Math.sign(arc.centerZ) || 1) * arc.radius
      const phi = (x - arc.centerX) / signedRef
      const radial = z - arc.centerZ
      return [arc.centerX - radial * Math.sin(phi), arc.centerZ + radial * Math.cos(phi)]
    }
    const curvedSeam = [
      bend([5.20303160795228, -1.383]),
      bend([5.20303160795228, 1.3850000000000002]),
    ] as const
    const straightSeam = straightSegment.shedFootprintPieces![1]!.slice(0, 2)

    expect(topAt(straightGeometry, straightSeam[0]!)).toBeCloseTo(
      topAt(curvedGeometry, curvedSeam[0]),
      5,
    )
    expect(topAt(straightGeometry, straightSeam[1]!)).toBeCloseTo(
      topAt(curvedGeometry, curvedSeam[1]),
      5,
    )
    curvedGeometry.dispose()
    straightGeometry.dispose()
  })
})

describe('roof system conical sector geometry', () => {
  test('does not leave broad radial closure triangles on a narrow sector', () => {
    const segment = RoofSegmentNode.parse({
      id: 'rseg_narrow_conical_sector',
      type: 'roof-segment',
      roofType: 'conical',
      width: 2,
      depth: 2,
      wallHeight: 0,
      pitch: 40,
      overhang: 0.3,
      conicalStartAngle: 0.3,
      conicalSweepAngle: 0.5,
    })

    const geometry = generateRoofSegmentGeometry(segment)
    const position = geometry.getAttribute('position')
    const index = geometry.getIndex()
    expect(index).not.toBeNull()
    const a = new THREE.Vector3()
    const b = new THREE.Vector3()
    const c = new THREE.Vector3()
    const ab = new THREE.Vector3()
    const ac = new THREE.Vector3()
    const normal = new THREE.Vector3()
    let broadCutTriangleCount = 0
    for (let offset = 0; offset < index!.count; offset += 3) {
      a.fromBufferAttribute(position, index!.getX(offset))
      b.fromBufferAttribute(position, index!.getX(offset + 1))
      c.fromBufferAttribute(position, index!.getX(offset + 2))
      normal.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a))
      const area = normal.length() / 2
      normal.normalize()
      const radii = [a, b, c].map((point) => Math.hypot(point.x, point.z))
      const ys = [a.y, b.y, c.y]
      if (
        Math.abs(normal.y) < 0.05 &&
        area > 0.1 &&
        Math.min(...radii) < 0.1 &&
        Math.max(...radii) > 0.5 &&
        Math.max(...ys) - Math.min(...ys) > 0.5
      ) {
        broadCutTriangleCount += 1
      }
    }

    let whiteSlopeArea = 0
    for (const group of geometry.groups) {
      if (group.materialIndex !== 0) continue
      for (let offset = group.start; offset < group.start + group.count; offset += 3) {
        a.fromBufferAttribute(position, index!.getX(offset))
        b.fromBufferAttribute(position, index!.getX(offset + 1))
        c.fromBufferAttribute(position, index!.getX(offset + 2))
        normal.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a))
        const area = normal.length() / 2
        normal.normalize()
        if (normal.y > 0.1) whiteSlopeArea += area
      }
    }

    expect(broadCutTriangleCount).toBe(0)
    expect(whiteSlopeArea).toBeLessThan(0.05)
    geometry.dispose()
  })

  test('keeps large sectors free of CSG striping and phantom wall faces', () => {
    const segment = RoofSegmentNode.parse({
      id: 'rseg_large_conical_sector',
      type: 'roof-segment',
      roofType: 'conical',
      width: 10,
      depth: 10,
      wallHeight: 0,
      pitch: 40,
      overhang: 0.3,
      conicalStartAngle: 0.3,
      conicalSweepAngle: 1,
    })

    const geometry = generateRoofSegmentGeometry(segment)
    const triangleCount = (geometry.getIndex()?.count ?? 0) / 3

    expect(triangleCount).toBeLessThan(100)
    expect(geometry.groups.some((group) => group.materialIndex === 2)).toBe(false)
    geometry.dispose()
  })

  test('emits canopy wall faces with both windings', () => {
    const segment = RoofSegmentNode.parse({
      id: 'rseg_double_sided_conical_walls',
      type: 'roof-segment',
      roofType: 'conical',
      width: 4,
      depth: 4,
      wallHeight: 2,
      wallThickness: 0.1,
      pitch: 40,
      overhang: 0.3,
      conicalStartAngle: 0.3,
      conicalSweepAngle: 1,
    })

    const geometry = generateRoofSegmentGeometry(segment)
    const position = geometry.getAttribute('position')
    const index = geometry.getIndex()
    expect(index).not.toBeNull()

    const wallMaterialIndices = new Set<number>()
    const windingCounts = new Map<string, [number, number]>()
    const a = new THREE.Vector3()
    const b = new THREE.Vector3()
    const c = new THREE.Vector3()
    const normal = new THREE.Vector3()
    for (const group of geometry.groups) {
      for (let offset = group.start; offset < group.start + group.count; offset += 3) {
        a.fromBufferAttribute(position, index!.getX(offset))
        b.fromBufferAttribute(position, index!.getX(offset + 1))
        c.fromBufferAttribute(position, index!.getX(offset + 2))
        const ys = [a.y, b.y, c.y]
        if (Math.min(...ys) > 0.001 || Math.max(...ys) < segment.wallHeight - 0.001) continue
        wallMaterialIndices.add(group.materialIndex ?? 0)
        normal.crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize()
        const firstNonzero = [normal.x, normal.y, normal.z].find(
          (coordinate) => Math.abs(coordinate) > 1e-5,
        )
        const winding = firstNonzero !== undefined && firstNonzero < 0 ? 1 : 0
        if (winding === 1) normal.negate()
        const signature = [normal.x, normal.y, normal.z, normal.dot(a)]
          .map((coordinate) => coordinate.toFixed(4))
          .join(',')
        const counts = windingCounts.get(signature) ?? [0, 0]
        counts[winding] += 1
        windingCounts.set(signature, counts)
      }
    }

    expect([...wallMaterialIndices]).toEqual([0])
    expect(windingCounts.size).toBeGreaterThan(0)
    expect(
      [...windingCounts.values()].every(
        ([forwardCount, reverseCount]) => forwardCount > 0 && forwardCount === reverseCount,
      ),
    ).toBe(true)
    geometry.dispose()
  })
})
