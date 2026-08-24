// @ts-expect-error - bun:test is provided by the Bun runtime; viewer does not
// include Bun globals in its package tsconfig.
import { describe, expect, test } from 'bun:test'
import { RoofNode, RoofSegmentNode } from '@pascal-app/core'
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
      metadata: { managedByLeanTo: 'lean_to_test', leanToRole: 'roof-segment' },
    })
    const { geometry, roofSideX, sideInfillNormals, sideInfillX } = inspectShedGeometry(segment)

    expect(sideInfillNormals).toHaveLength(2)
    expect(Math.max(...sideInfillX.map((x) => Math.abs(x)))).toBeCloseTo(infillHalfWidth, 5)
    expect(Math.max(...sideInfillX.map((x) => Math.abs(x)))).toBeGreaterThan(span / 2)
    expect(Math.max(...sideInfillX.map((x) => Math.abs(x)))).toBeLessThan(span / 2 + leftOverhang)
    expect(Math.max(...roofSideX)).toBeGreaterThan(span / 2 + leftOverhang * 0.5)

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
})
