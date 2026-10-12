// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, test } from 'bun:test'
import {
  getGableRidge,
  getRoofSegmentSurfaceY,
  getRoofSegmentWallFace,
  RoofSegmentNode,
} from '@pascal-app/core'
import * as THREE from 'three'
import { generateRoofSegmentGeometry, getRoofSegmentUndersidePolygons } from './roof-system'

const DEG = Math.PI / 180
/** The soffit's material slot (ROOF_SLOT_ROLES: edge, fascia, wall, top, soffit). */
const ROOF_SOFFIT_SLOT = 4
const TAN = Math.tan(30 * DEG)
const COS = Math.cos(30 * DEG)

/** An L: the 10 × 8 rectangle without its +x / +z quarter (x > 2, z > 1). */
const L: [number, number][] = [
  [-5, -4],
  [5, -4],
  [5, 1],
  [2, 1],
  [2, 4],
  [-5, 4],
]

/** 10 × 8, 30° both ways, the ridge across the middle; the −z slope's ridge 1 m higher. */
function stepped(extra: Partial<RoofSegmentNode> = {}) {
  return RoofSegmentNode.parse({
    type: 'roof-segment',
    roofType: 'gable',
    width: 10,
    depth: 8,
    wallHeight: 0.5,
    pitch: 30,
    ridgeOffset: 4,
    ridgeStep: 1,
    overhang: 0.5,
    wallThickness: 0.2,
    deckThickness: 0.1,
    shingleThickness: 0.05,
    ...extra,
  })
}

function hit(geometry: THREE.BufferGeometry, from: THREE.Vector3, dir: THREE.Vector3) {
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
  return new THREE.Raycaster(from, dir).intersectObject(mesh).at(0)?.point ?? null
}

/** Height of the topmost surface straight below (x, ·, z), or null when nothing is there. */
const topAt = (geometry: THREE.BufferGeometry, x: number, z: number) =>
  hit(geometry, new THREE.Vector3(x, 50, z), new THREE.Vector3(0, -1, 0))?.y ?? null

/** The outer skin of a slope rising from `eave` at the z = ±4 wall line. */
function skin(node: RoofSegmentNode, z: number) {
  const ridge = getGableRidge(node)!
  const lift = (node.deckThickness + node.shingleThickness) / COS
  return z > 0
    ? ridge.frontWallHeight + (4 - z) * TAN + lift
    : ridge.backWallHeight + (4 + z) * TAN + lift
}

describe('gable with a stepped ridge', () => {
  test('each slope keeps its own ridge height; the −z eave rides up with it', () => {
    const node = stepped()
    const ridge = getGableRidge(node)!
    expect(ridge.ridgeZ).toBeCloseTo(0, 9)
    expect(ridge.height).toBeCloseTo(0.5 + 4 * TAN, 9)
    expect(ridge.backHeight).toBeCloseTo(ridge.height + 1, 9)
    expect(ridge.backWallHeight).toBeCloseTo(1.5, 9)
    expect(getRoofSegmentSurfaceY(node, 0, 2)).toBeCloseTo(0.5 + 2 * TAN, 9)
    expect(getRoofSegmentSurfaceY(node, 0, -2)).toBeCloseTo(1.5 + 2 * TAN, 9)
  })

  test('without a step the gable is the same as before', () => {
    const plain = generateRoofSegmentGeometry(stepped({ ridgeStep: undefined }))
    const zero = generateRoofSegmentGeometry(stepped({ ridgeStep: 0 }))
    plain.computeBoundingBox()
    zero.computeBoundingBox()
    expect(zero.boundingBox!.equals(plain.boundingBox!)).toBe(true)
    expect(zero.getAttribute('position').count).toBe(plain.getAttribute('position').count)
    plain.dispose()
    zero.dispose()
  })

  for (const step of [1, -1]) {
    // from the step line toward the lower slope
    const toward = step > 0 ? 1 : -1
    // the overhang across the plan at 30°
    const reach = 0.5 * COS

    test(`each slope follows its own plane; the higher runs on over the step (step ${step})`, () => {
      const node = stepped({ ridgeStep: step })
      const geometry = generateRoofSegmentGeometry(node)
      for (const z of [3, 1, -1, -3]) expect(topAt(geometry, 0, z)).toBeCloseTo(skin(node, z), 2)
      // past the step line, the higher slope's own plane carried on — upward, in its plane
      const over = toward * (reach - 0.05)
      expect(topAt(geometry, 0, over)).toBeCloseTo(
        skin(node, -toward * 0.001) + (Math.abs(over) + 0.001) * TAN,
        2,
      )
      // past the overhang, the lower slope again
      const past = toward * (reach + 0.05)
      expect(topAt(geometry, 0, past)).toBeCloseTo(skin(node, past), 2)
      geometry.dispose()
    })

    test(`the higher slope's run-on ends plumb at the overhang (step ${step})`, () => {
      const node = stepped({ ridgeStep: step })
      const ridge = getGableRidge(node)!
      const geometry = generateRoofSegmentGeometry(node)
      const higherWall = step > 0 ? ridge.backWallHeight : ridge.frontWallHeight
      // halfway up the run-on's deck at its end
      const y = higherWall + (4 + reach) * TAN + 0.05
      const end = hit(
        geometry,
        new THREE.Vector3(0, y, toward * 20),
        new THREE.Vector3(0, 0, -toward),
      )
      expect(end).not.toBeNull()
      expect(end!.z).toBeCloseTo(toward * reach, 2)
      geometry.dispose()
    })

    test(`with no overhang the higher slope stops at the step line too (step ${step})`, () => {
      const node = stepped({ ridgeStep: step, overhang: 0 })
      const geometry = generateRoofSegmentGeometry(node)
      expect(topAt(geometry, 0, toward * 0.05)).toBeCloseTo(skin(node, toward * 0.05), 2)
      geometry.dispose()
    })

    test(`a step wall closes the gap between the ridges (step ${step})`, () => {
      const node = stepped({ ridgeStep: step })
      const ridge = getGableRidge(node)!
      const geometry = generateRoofSegmentGeometry(node)
      // halfway between the lower slope's top at the ridge and the higher one's underside
      const low = Math.min(ridge.height, ridge.backHeight) + 0.15 / COS
      const high = Math.max(ridge.height, ridge.backHeight)
      const y = (low + high) / 2
      // looking from the lower side toward the higher one, the wall stands on the ridge line
      const lowerSide = step > 0 ? 1 : -1
      const wall = hit(
        geometry,
        new THREE.Vector3(0, y, lowerSide * 20),
        new THREE.Vector3(0, 0, -lowerSide),
      )
      expect(wall).not.toBeNull()
      expect(wall!.z).toBeCloseTo(0, 2)
      geometry.dispose()
    })
  }

  test('fascia and rake boards follow both slopes', () => {
    const node = stepped({ fascia: true })
    const geometry = generateRoofSegmentGeometry(node)
    for (const z of [2, -2]) expect(topAt(geometry, 0, z)).toBeCloseTo(skin(node, z), 2)
    geometry.dispose()
  })

  test('cut to an outline, the step stays and each slope keeps its height', () => {
    const node = stepped({ footprint: L })
    const geometry = generateRoofSegmentGeometry(node)
    expect(topAt(geometry, 4, 3)).toBeNull()
    expect(topAt(geometry, -3, 3)).toBeCloseTo(skin(node, 3), 2)
    expect(topAt(geometry, 4, -3)).toBeCloseTo(skin(node, -3), 2)
    expect(topAt(geometry, -3, -0.3)).toBeCloseTo(skin(node, -0.3), 2)
    // over the step line the higher slope runs on by its overhang, then the lower one
    expect(topAt(geometry, -3, 0.3)).toBeCloseTo(skin(node, -0.001) + 0.301 * TAN, 2)
    expect(topAt(geometry, -3, 1)).toBeCloseTo(skin(node, 1), 2)
    geometry.dispose()
  })

  test('an outline edge on the step line overhangs only the slope it bounds', () => {
    // the higher (−z) side cut away for x > 2 right up to the step line
    const notched: [number, number][] = [
      [-5, -4],
      [2, -4],
      [2, 0],
      [5, 0],
      [5, 4],
      [-5, 4],
    ]
    const node = stepped({ footprint: notched })
    const geometry = generateRoofSegmentGeometry(node)
    // where the higher slope is, it runs on over the step
    expect(topAt(geometry, -3, 0.2)).toBeCloseTo(skin(node, -0.001) + 0.201 * TAN, 2)
    // over the cut-away part: the lower slope only, nothing of the higher one past the line
    expect(topAt(geometry, 4, 0.2)).toBeCloseTo(skin(node, 0.2), 2)
    expect(topAt(geometry, 4, -0.2)).toBeNull()
    // the higher slope's rake at the notch overhangs it like any rake
    expect(topAt(geometry, 2 + 0.3, -2)).toBeCloseTo(skin(node, -2), 2)
    expect(topAt(geometry, 2 + 0.6, -2)).toBeNull()
    geometry.dispose()
  })

  test('every overhang of both slopes shows the soffit underneath, and nothing hangs below it', () => {
    for (const step of [1, -1]) {
      const node = stepped({ ridgeStep: step, footprint: L })
      const ridge = getGableRidge(node)!
      const geometry = generateRoofSegmentGeometry(node)
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
      const slotOf = (face: number) =>
        geometry.groups.find((g) => face * 3 >= g.start && face * 3 < g.start + g.count)
          ?.materialIndex
      const fromBelow = (x: number, z: number) =>
        new THREE.Raycaster(new THREE.Vector3(x, -20, z), new THREE.Vector3(0, 1, 0))
          .intersectObject(mesh)
          .at(0)!
      // the eaves, the rakes and the higher slope's run-on over the step
      const toward = step > 0 ? 1 : -1
      for (const [x, z, plane] of [
        [-3, 4.2, (zz: number) => ridge.frontWallHeight + (4 - zz) * TAN],
        [3, -4.2, (zz: number) => ridge.backWallHeight + (4 + zz) * TAN],
        [-5.2, 2, (zz: number) => ridge.frontWallHeight + (4 - zz) * TAN],
        [-5.2, -2, (zz: number) => ridge.backWallHeight + (4 + zz) * TAN],
      ] as const) {
        const hit = fromBelow(x, z)
        expect(slotOf(hit.faceIndex!)).toBe(ROOF_SOFFIT_SLOT)
        // the deck's underside on the slope's plane: nothing of the deck below it
        expect(hit.point.y).toBeCloseTo(plane(z), 2)
      }
      const over = fromBelow(-3, toward * 0.3)
      expect(slotOf(over.faceIndex!)).toBe(ROOF_SOFFIT_SLOT)
      geometry.dispose()
    }
  })

  for (const step of [1, -1]) {
    const toward = step > 0 ? 1 : -1
    const reach = 0.5 * COS + 0.002

    test(`square eaves: the run-on over the step keeps its soffit on the overhang line (step ${step})`, () => {
      const node = stepped({ ridgeStep: step, squareEaves: true })
      const ridge = getGableRidge(node)!
      const geometry = generateRoofSegmentGeometry(node)
      const higherWall = step > 0 ? ridge.backWallHeight : ridge.frontWallHeight
      const soffitY = higherWall + (4 + reach) * TAN
      // square to the 30° slope: the end leans back toward the step as it rises
      for (const up of [0.02, 0.08]) {
        const end = hit(
          geometry,
          new THREE.Vector3(0, soffitY + up, toward * 20),
          new THREE.Vector3(0, 0, -toward),
        )
        expect(end).not.toBeNull()
        expect(end!.z).toBeCloseTo(toward * reach - toward * up * TAN, 2)
      }
      geometry.dispose()
    })

    test(`square eaves: the lower slope runs on under the step, cut square from its outer face (step ${step})`, () => {
      const node = stepped({ ridgeStep: step, squareEaves: true })
      const geometry = generateRoofSegmentGeometry(node)
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
      // past the gable wall (rake overhang), just past the step line on the higher side
      const outer = skin(node, toward * 0.001)
      for (const past of [0.03, 0.06]) {
        const z = -toward * past
        const ys = new THREE.Raycaster(new THREE.Vector3(5.2, 50, z), new THREE.Vector3(0, -1, 0))
          .intersectObject(mesh)
          .map((h) => h.point.y)
        // the end face, square to the 30° slope from the outer face on the line
        const cutY = outer - past / Math.tan(30 * DEG)
        expect(ys.some((y) => Math.abs(y - cutY) < 0.006)).toBe(true)
      }
      geometry.dispose()
    })

    test(`square eaves only take away: the roof reaches as far as plumb (step ${step})`, () => {
      const square = generateRoofSegmentGeometry(
        stepped({ ridgeStep: step, squareEaves: true, footprint: L }),
      )
      const plumb = generateRoofSegmentGeometry(stepped({ ridgeStep: step, footprint: L }))
      square.computeBoundingBox()
      plumb.computeBoundingBox()
      // in plan it reaches exactly as far; in height it only gives way
      for (const key of ['min', 'max'] as const) {
        for (const axis of ['x', 'z'] as const) {
          expect(square.boundingBox![key][axis]).toBeCloseTo(plumb.boundingBox![key][axis], 2)
        }
      }
      expect(square.boundingBox!.max.y).toBeLessThan(plumb.boundingBox!.max.y + 0.003)
      expect(square.boundingBox!.min.y).toBeGreaterThan(plumb.boundingBox!.min.y - 0.003)
      square.dispose()
      plumb.dispose()
    })
  }

  test('the underside lies on each slope at its own height', () => {
    const node = stepped({ footprint: L })
    const ridge = getGableRidge(node)!
    const points = getRoofSegmentUndersidePolygons(node)!.flat()
    const front = points.filter((point) => point.z > 0.01)
    const back = points.filter((point) => point.z < -0.01)
    expect(front.length).toBeGreaterThan(0)
    expect(back.length).toBeGreaterThan(0)
    for (const point of front) {
      expect(point.y).toBeCloseTo(ridge.frontWallHeight + (4 - point.z) * TAN, 4)
    }
    for (const point of back) {
      expect(point.y).toBeCloseTo(ridge.backWallHeight + (4 + point.z) * TAN, 4)
    }
  })

  test('the gable end wall rises to both ridges at the step line', () => {
    const node = stepped()
    const ridge = getGableRidge(node)!
    const right = getRoofSegmentWallFace(node, 'right')
    const atRidge = right.profile.filter((point) => Math.abs(point[0] - right.length / 2) < 0.01)
    expect(atRidge.length).toBe(2)
    const tops = atRidge.map((point) => point[1]).sort((a, b) => a - b)
    expect(tops[1]! - tops[0]!).toBeCloseTo(1, 2)
    expect(tops[1]).toBeLessThan(ridge.backHeight + 0.01)
  })
})
