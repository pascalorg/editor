// @ts-expect-error - bun:test is provided by the Bun runtime; viewer does not
// include Bun globals in its package tsconfig.
import { describe, expect, test } from 'bun:test'
import { RoofSegmentNode } from '@pascal-app/core'
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
          sideInfillNormals.push(normal.clone())
          for (const vertexIndex of [ia, ib, ic]) {
            const x = position.getX(vertexIndex)
            const y = position.getY(vertexIndex)
            if (y >= segment.wallHeight - 0.001) {
              sideInfillX.push(x)
            }
          }
        }
      }
    }

    return { geometry, roofSideX, sideInfillNormals, sideInfillX }
  }

  test('keeps standalone shed side infill inside the overhanging roof edge', () => {
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
    const { geometry, roofSideX, sideInfillNormals, sideInfillX } = inspectShedGeometry(segment)

    expect(sideInfillNormals).toHaveLength(2)
    expect(sideInfillX.length).toBeGreaterThan(0)
    expect(sideInfillNormals.every((panelNormal) => Math.abs(panelNormal.x) > 0.95)).toBe(true)
    expect(sideInfillNormals.every((panelNormal) => Math.abs(panelNormal.z) < 0.05)).toBe(true)
    expect(Math.max(...sideInfillX.map((x) => Math.abs(x)))).toBeLessThan(wallSideX - 0.05)
    expect(Math.max(...sideInfillX.map((x) => Math.abs(x)))).toBeGreaterThan(wallSideX - 0.15)
    expect(Math.max(...roofSideX)).toBeGreaterThan(wallSideX + segment.overhang * 0.5)

    geometry.dispose()
  })

  test('keeps lean-to shed side infill on the outer side-member face', () => {
    const span = 4
    const leftOverhang = 0.15
    const rightOverhang = 0.15
    const rafterWidth = 0.08
    const infillHalfWidth = span / 2 + rafterWidth / 2
    const segment = RoofSegmentNode.parse({
      id: 'rseg_lean_to_shed',
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
      metadata: {
        managedByLeanTo: 'leanto_test',
        leanToRole: 'roof-segment',
        leanToSideInfillSpan: span,
        leanToSideInfillMinX: -infillHalfWidth,
        leanToSideInfillMaxX: infillHalfWidth,
      },
    })
    const { geometry, roofSideX, sideInfillNormals, sideInfillX } = inspectShedGeometry(segment)

    expect(sideInfillNormals).toHaveLength(2)
    expect(Math.max(...sideInfillX.map((x) => Math.abs(x)))).toBeCloseTo(infillHalfWidth, 5)
    expect(Math.max(...sideInfillX.map((x) => Math.abs(x)))).toBeGreaterThan(span / 2)
    expect(Math.max(...sideInfillX.map((x) => Math.abs(x)))).toBeLessThan(
      span / 2 + leftOverhang,
    )
    expect(Math.max(...roofSideX)).toBeGreaterThan(span / 2 + leftOverhang * 0.5)

    geometry.dispose()
  })
})
