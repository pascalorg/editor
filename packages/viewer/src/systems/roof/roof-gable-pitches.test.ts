// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, test } from 'bun:test'
import {
  getGableRidge,
  getRoofSegmentSurfaceY,
  getRoofSegmentWallFace,
  getSegmentSlopeFrame,
  RoofSegmentNode,
} from '@pascal-app/core'
import * as THREE from 'three'
import { generateRoofSegmentGeometry, getRoofSegmentUndersidePolygons } from './roof-system'

const DEG = Math.PI / 180
const TAN_FRONT = Math.tan(24 * DEG)
const TAN_BACK = Math.tan(17 * DEG)

/** An L: the 10 × 8 rectangle without its +x / +z quarter (x > 2, z > 1). */
const L: [number, number][] = [
  [-5, -4],
  [5, -4],
  [5, 1],
  [2, 1],
  [2, 4],
  [-5, 4],
]

function segment(extra: Partial<RoofSegmentNode> = {}) {
  return RoofSegmentNode.parse({
    type: 'roof-segment',
    roofType: 'gable',
    width: 10,
    depth: 8,
    wallHeight: 0.5,
    pitch: 24,
    backPitch: 17,
    overhang: 0.5,
    wallThickness: 0.2,
    deckThickness: 0.1,
    shingleThickness: 0.05,
    ...extra,
  })
}

/** Height of the topmost surface straight below (x, ·, z), or null when nothing is there. */
function topAt(geometry: THREE.BufferGeometry, x: number, z: number): number | null {
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
  const hit = new THREE.Raycaster(new THREE.Vector3(x, 50, z), new THREE.Vector3(0, -1, 0))
    .intersectObject(mesh)
    .at(0)
  return hit ? hit.point.y : null
}

/** The outer skin of one slope: its wall-line plane lifted by deck + shingles at that pitch. */
function skinY(node: RoofSegmentNode, z: number) {
  const lift = node.deckThickness + node.shingleThickness
  const front = node.wallHeight + (node.depth / 2 - z) * TAN_FRONT + lift / Math.cos(24 * DEG)
  const back = node.wallHeight + (node.depth / 2 + z) * TAN_BACK + lift / Math.cos(17 * DEG)
  return Math.min(front, back)
}

describe('gable with two pitches', () => {
  test('both eaves stay at the wall height; the ridge moves toward the steeper slope', () => {
    const node = segment()
    const frame = getSegmentSlopeFrame(node)
    const ridgeZ = (4 * (TAN_FRONT - TAN_BACK)) / (TAN_FRONT + TAN_BACK)
    expect(frame.ridgeZ).toBeCloseTo(ridgeZ, 6)
    expect(frame.ridgeZ).toBeGreaterThan(0)
    expect(frame.activeRh).toBeCloseTo((4 - ridgeZ) * TAN_FRONT, 6)
    expect(frame.activeRh).toBeCloseTo((4 + ridgeZ) * TAN_BACK, 6)

    expect(getRoofSegmentSurfaceY(node, 0, 4)).toBeCloseTo(0.5, 6)
    expect(getRoofSegmentSurfaceY(node, 0, -4)).toBeCloseTo(0.5, 6)
    expect(getRoofSegmentSurfaceY(node, 0, ridgeZ)).toBeCloseTo(0.5 + frame.activeRh, 6)
    expect(getRoofSegmentSurfaceY(node, 0, 2)).toBeCloseTo(0.5 + 2 * TAN_FRONT, 6)
    expect(getRoofSegmentSurfaceY(node, 0, -2)).toBeCloseTo(0.5 + 2 * TAN_BACK, 6)
  })

  test('without a back pitch, or with an equal one, the gable is symmetric as before', () => {
    expect(getSegmentSlopeFrame(segment({ backPitch: undefined })).ridgeZ).toBe(0)
    const plain = generateRoofSegmentGeometry(segment({ backPitch: undefined }))
    const equal = generateRoofSegmentGeometry(segment({ backPitch: 24 }))
    plain.computeBoundingBox()
    equal.computeBoundingBox()
    expect(equal.boundingBox!.equals(plain.boundingBox!)).toBe(true)
    expect(equal.getAttribute('position').count).toBe(plain.getAttribute('position').count)
    plain.dispose()
    equal.dispose()
  })

  test('each slope of the built roof follows its own pitch', () => {
    const node = segment()
    const geometry = generateRoofSegmentGeometry(node)
    for (const z of [3, 2, 1, -1, -2, -3]) {
      expect(topAt(geometry, 0, z)).toBeCloseTo(skinY(node, z), 2)
    }
    geometry.computeBoundingBox()
    const ridgeZ = getSegmentSlopeFrame(node).ridgeZ
    expect(geometry.boundingBox!.max.y).toBeCloseTo(skinY(node, ridgeZ), 2)
    geometry.dispose()
  })

  test('fascia and rake boards follow both slopes', () => {
    const node = segment({ fascia: true })
    const geometry = generateRoofSegmentGeometry(node)
    expect(geometry.getAttribute('position').count).toBeGreaterThan(0)
    for (const z of [2, -2]) expect(topAt(geometry, 0, z)).toBeCloseTo(skinY(node, z), 2)
    geometry.dispose()
  })

  test('cut to an outline, each slope keeps its pitch', () => {
    const node = segment({ footprint: L })
    const geometry = generateRoofSegmentGeometry(node)
    expect(topAt(geometry, 4, 3)).toBeNull()
    expect(topAt(geometry, -3, 3)).toBeCloseTo(skinY(node, 3), 2)
    expect(topAt(geometry, 4, -3)).toBeCloseTo(skinY(node, -3), 2)
    geometry.dispose()
  })

  test('the underside under an outline lies on each slope', () => {
    const node = segment({ footprint: L })
    const ridgeZ = getSegmentSlopeFrame(node).ridgeZ
    const points = getRoofSegmentUndersidePolygons(node)!.flat()
    const front = points.filter((point) => point.z > ridgeZ + 0.01)
    const back = points.filter((point) => point.z < ridgeZ - 0.01)
    expect(front.length).toBeGreaterThan(0)
    expect(back.length).toBeGreaterThan(0)
    // the deck bottom is the wall-line plane of each slope
    for (const point of front) {
      expect(point.y).toBeCloseTo(node.wallHeight + (4 - point.z) * TAN_FRONT, 4)
    }
    for (const point of back) {
      expect(point.y).toBeCloseTo(node.wallHeight + (4 + point.z) * TAN_BACK, 4)
    }
    // nothing over the cut-away corner
    expect(points.some((point) => point.x > 3 && point.z > 2)).toBe(false)
  })

  test('the gable end wall peaks under the moved ridge', () => {
    const node = segment()
    const ridgeZ = getSegmentSlopeFrame(node).ridgeZ
    const right = getRoofSegmentWallFace(node, 'right')
    const left = getRoofSegmentWallFace(node, 'left')
    const apex = (profile: [number, number][]) =>
      profile.reduce((best, point) => (point[1] > best[1] ? point : best))
    // right: u runs from +z to −z; left: from −z to +z
    expect(apex(right.profile)[0]).toBeCloseTo(right.length / 2 - ridgeZ, 2)
    expect(apex(left.profile)[0]).toBeCloseTo(left.length / 2 + ridgeZ, 2)
  })
})

describe('gable with a placed ridge', () => {
  const TAN_25 = Math.tan(25 * DEG)
  const TAN_15 = Math.tan(15 * DEG)
  // depth 10 split 4 : 6 by the ridge, 25° on the +z side, 15° on the −z side
  const placed = (extra: Partial<RoofSegmentNode> = {}) =>
    segment({ depth: 10, pitch: 25, backPitch: 15, ridgeOffset: 4, wallHeight: 0.8, ...extra })

  test('the ridge stays where it is placed; the attic walls take up the pitches', () => {
    const node = placed()
    const ridge = getGableRidge(node)!
    expect(ridge.ridgeZ).toBeCloseTo(1, 9)
    expect(ridge.height).toBeCloseTo(0.8 + 4 * TAN_25, 9)
    expect(ridge.backWallHeight).toBeCloseTo(ridge.height - 6 * TAN_15, 9)
    expect(getSegmentSlopeFrame(node).ridgeZ).toBeCloseTo(1, 9)
    expect(getRoofSegmentSurfaceY(node, 0, 5)).toBeCloseTo(0.8, 9)
    expect(getRoofSegmentSurfaceY(node, 0, -5)).toBeCloseTo(ridge.backWallHeight, 9)
    expect(getRoofSegmentSurfaceY(node, 0, 1)).toBeCloseTo(ridge.height, 9)
  })

  test('with equal pitches a placed ridge still splits the depth as placed', () => {
    const ridge = getGableRidge(placed({ backPitch: undefined, pitch: 20 }))!
    expect(ridge.ridgeZ).toBeCloseTo(1, 9)
    expect(ridge.backWallHeight).toBeLessThan(ridge.frontWallHeight)
  })

  test('the built roof follows each slope from its own eave', () => {
    const node = placed()
    const ridge = getGableRidge(node)!
    const lift = node.deckThickness + node.shingleThickness
    const skin = (z: number) =>
      Math.min(
        ridge.frontWallHeight + (5 - z) * TAN_25 + lift / Math.cos(25 * DEG),
        ridge.backWallHeight + (5 + z) * TAN_15 + lift / Math.cos(15 * DEG),
      )
    const geometry = generateRoofSegmentGeometry(node)
    for (const z of [4, 2.5, 1.5, 0, -2, -4]) expect(topAt(geometry, 0, z)).toBeCloseTo(skin(z), 2)
    geometry.dispose()
  })

  test('the end walls rise to each eave and peak under the ridge', () => {
    const node = placed()
    const ridge = getGableRidge(node)!
    const right = getRoofSegmentWallFace(node, 'right')
    const apex = right.profile.reduce((best, point) => (point[1] > best[1] ? point : best))
    expect(apex[0]).toBeCloseTo(right.length / 2 - ridge.ridgeZ, 2)
    // u = 0 is the +z end, u = length the −z end
    const eaves = right.profile.filter((point) => point[1] > 0 && point !== apex)
    expect(Math.min(...eaves.map((p) => p[1]))).toBeLessThan(ridge.frontWallHeight)
  })
})

describe('gable with an eave below the plate', () => {
  // ridge 4 m from the +z wall at 0.8 + 4·tan25 ≈ 2.67 m; the 25° back slope
  // reaches 6 m and ends ≈ 0.13 m below the plate, the eave lower still
  const node = segment({
    depth: 10,
    pitch: 25,
    backPitch: 30,
    ridgeOffset: 4,
    wallHeight: 0.8,
    overhang: 0.5,
    cutAtWallTop: true,
  })

  test('off (absent), the deck stays below the plate; the roof walls end at it', () => {
    const geometry = generateRoofSegmentGeometry(segment({ ...node, cutAtWallTop: undefined }))
    geometry.computeBoundingBox()
    expect(geometry.boundingBox!.min.y).toBeLessThan(-0.05)
    // the walls' faces (slot 2, the inside of the roof's walls) stop at the plate
    const position = geometry.getAttribute('position')
    const index = geometry.getIndex()
    let lowest = Number.POSITIVE_INFINITY
    for (const group of geometry.groups) {
      if (group.materialIndex !== 2) continue
      for (let i = group.start; i < group.start + group.count; i++) {
        lowest = Math.min(lowest, position.getY(index ? index.getX(i) : i))
      }
    }
    expect(lowest).toBeGreaterThan(-0.005)
    geometry.dispose()
  })

  test('the underside walls and posts are cut at follows the roof below the plate, unless it is cut there', () => {
    const lowest = (n: RoofSegmentNode) =>
      Math.min(...getRoofSegmentUndersidePolygons(n)!.flatMap((p) => p.map((point) => point.y)))
    // a ceiling following the slope: walls and posts meet it below the plate
    expect(lowest(segment({ ...node, cutAtWallTop: undefined }))).toBeLessThan(-0.05)
    // cut at the wall top: nothing bears below the plate
    expect(lowest(node)).toBeGreaterThan(-0.001)
  })

  test('nothing of the roof stays below the plate inside the walls', () => {
    expect(getGableRidge(node)!.backWallHeight).toBeLessThan(0)
    const geometry = generateRoofSegmentGeometry(node)
    const position = geometry.getAttribute('position')
    const inner = 5 + node.wallThickness / 2 - 0.01
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i)
      const y = position.getY(i)
      const z = position.getZ(i)
      if (Math.abs(x) < inner && Math.abs(z) < inner) expect(y).toBeGreaterThanOrEqual(-1e-4)
    }
    geometry.dispose()
  })

  test('the eave still overhangs beyond the walls', () => {
    const geometry = generateRoofSegmentGeometry(node)
    const y = topAt(geometry, 0, -5.4)
    expect(y).not.toBeNull()
    expect(y!).toBeLessThan(0)
    geometry.dispose()
  })

  test('walls beneath bear on no roof below the plate', () => {
    const points = getRoofSegmentUndersidePolygons(node)!.flat()
    expect(points.length).toBeGreaterThan(0)
    for (const point of points) expect(point.y).toBeGreaterThanOrEqual(-1e-6)
  })
})

describe('low attic wall under a long overhang', () => {
  test('the eave runs out along the slope, not sliced flat at the plate', () => {
    const node = segment({ backPitch: undefined, wallHeight: 0.1, overhang: 0.8 })
    const geometry = generateRoofSegmentGeometry(node)
    // past the wall the deck keeps falling with the slope below the plate
    const lift = node.deckThickness + node.shingleThickness
    const skin = (z: number) => node.wallHeight + (4 - z) * TAN_FRONT + lift / Math.cos(24 * DEG)
    for (const z of [4.3, 4.6]) expect(topAt(geometry, 0, z)).toBeCloseTo(skin(z), 2)
    // and its underside is the slope's own plane, not a flat cut at the plate
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
    const lowest = new THREE.Raycaster(new THREE.Vector3(0, -20, 4.6), new THREE.Vector3(0, 1, 0))
      .intersectObject(mesh)
      .at(0)!.point.y
    expect(lowest).toBeCloseTo(node.wallHeight + (4 - 4.6) * TAN_FRONT, 2)
    geometry.dispose()
  })
})

describe('plate-seated roof with a thick deck', () => {
  // the stand roof drawn by outline: wall 0, 40°, deck 0.2, overhang 0.6
  const node = segment({
    squareEaves: true,
    backPitch: undefined,
    depth: 8.37,
    wallHeight: 0,
    pitch: 40,
    overhang: 0.6,
    wallThickness: 0.05,
    deckThickness: 0.2,
  })
  const tan40 = Math.tan(40 * DEG)
  const cos40 = Math.cos(40 * DEG)
  const lowestAt = (geometry: THREE.BufferGeometry, z: number) => {
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
    return new THREE.Raycaster(new THREE.Vector3(-2, -20, z), new THREE.Vector3(0, 1, 0))
      .intersectObject(mesh)
      .at(0)!.point.y
  }

  test('the eave underside follows the slope, no flat cut', () => {
    const geometry = generateRoofSegmentGeometry(node)
    for (const z of [-4.4, -4.5]) expect(lowestAt(geometry, z)).toBeCloseTo((4.185 + z) * tan40, 2)
    geometry.dispose()
  })

  test('square eaves: the outer face stays on the overhang line, the soffit draws back square', () => {
    const geometry = generateRoofSegmentGeometry(node)
    // the overhang line: the walls' outer face (the depth plus half the wall) and the overhang
    const outerZ = -(4.185 + node.wallThickness / 2 + node.overhang * cos40)
    const thickness = node.deckThickness + node.shingleThickness
    // the cut, square to the slope from the outer face down, ends on the soffit this far in
    const soffitZ = outerZ + thickness * Math.sin(40 * DEG)
    const soffitY = (4.185 + soffitZ) * tan40
    expect(lowestAt(geometry, soffitZ + 0.01)).toBeCloseTo((4.185 + soffitZ + 0.01) * tan40, 2)
    // past it the end rises square to the slope
    for (const out of [0.03, 0.08]) {
      expect(lowestAt(geometry, soffitZ - out)).toBeCloseTo(soffitY + out / tan40, 2)
    }
    // and the farthest point is the outer face, on the overhang line
    geometry.computeBoundingBox()
    expect(geometry.boundingBox!.min.z).toBeCloseTo(outerZ, 2)
    geometry.dispose()
  })
})

describe('roof cut to an outline, square to the slope', () => {
  test('an outline edge across the fall line keeps its reach; its soffit draws back square', () => {
    const node = segment({ squareEaves: true, backPitch: undefined, footprint: L })
    const plumb = generateRoofSegmentGeometry(segment({ backPitch: undefined, footprint: L }))
    const geometry = generateRoofSegmentGeometry(node)
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
    const sin = Math.sin(24 * DEG)
    // the notch edge z = 1 (x > 2) faces down the +z slope like an eave: the
    // outer face on the overhang line, the soffit drawn back by the thickness
    // (plus the cut's 2 mm margin)
    const outerZ = 1 + node.overhang * Math.cos(24 * DEG) + 0.002
    const soffitZ = outerZ - (node.deckThickness + node.shingleThickness) * sin
    const soffitY = node.wallHeight + (4 - soffitZ) * TAN_FRONT
    const lowestAt = (z: number) =>
      new THREE.Raycaster(new THREE.Vector3(3.5, -20, z), new THREE.Vector3(0, 1, 0))
        .intersectObject(mesh)
        .at(0)?.point.y ?? null
    expect(lowestAt(soffitZ - 0.01)).toBeCloseTo(soffitY + 0.01 * TAN_FRONT, 2)
    expect(lowestAt(soffitZ + 0.02)).toBeCloseTo(soffitY + 0.02 / TAN_FRONT, 2)
    expect(lowestAt(outerZ + 0.01)).toBeNull()
    // the whole roof reaches exactly as far as with plumb eaves
    geometry.computeBoundingBox()
    plumb.computeBoundingBox()
    for (const key of ['min', 'max'] as const) {
      for (const axis of ['x', 'z'] as const) {
        expect(geometry.boundingBox![key][axis]).toBeCloseTo(plumb.boundingBox![key][axis], 2)
      }
    }
    geometry.dispose()
    plumb.dispose()
  })
})

describe('square eaves are a switch', () => {
  // the stand roof: wall 0, 40°, deck 0.2, no overhang
  const flat = (extra: Partial<RoofSegmentNode> = {}) =>
    segment({
      backPitch: undefined,
      depth: 8.37,
      wallHeight: 0,
      pitch: 40,
      overhang: 0,
      wallThickness: 0.05,
      deckThickness: 0.2,
      ...extra,
    })
  const reachZ = (node: RoofSegmentNode) => {
    const geometry = generateRoofSegmentGeometry(node)
    geometry.computeBoundingBox()
    const box = geometry.boundingBox!
    geometry.dispose()
    return Math.max(box.max.z, -box.min.z)
  }

  test('off (absent), a zero overhang leaves the roof at the walls on both sides', () => {
    const node = flat()
    // past the wall face only by the shingles' own thickness along the slope
    const limit = node.depth / 2 + node.wallThickness / 2 + node.shingleThickness + 0.005
    expect(reachZ(node)).toBeLessThan(limit)
    expect(reachZ(flat({ ridgeStep: 1 }))).toBeLessThan(limit)
  })

  test('off, cut to an outline with no overhang, the roof ends at the outline: outside and at a notch', () => {
    for (const ridgeStep of [0, 1]) {
      const node = segment({ footprint: L, overhang: 0, ridgeStep })
      const geometry = generateRoofSegmentGeometry(node)
      const position = geometry.getAttribute('position')
      const eps = 0.003
      for (let i = 0; i < position.count; i++) {
        const x = position.getX(i)
        const z = position.getZ(i)
        expect(Math.abs(x)).toBeLessThan(5 + eps)
        expect(Math.abs(z)).toBeLessThan(4 + eps)
        // nothing over the notch (x > 2, z > 1)
        expect(x > 2 + eps && z > 1 + eps).toBe(false)
      }
      geometry.dispose()
    }
  })

  test('on, the roof reaches no farther: the cut only takes away', () => {
    expect(reachZ(flat({ squareEaves: true, overhang: 0.6 }))).toBeLessThan(
      reachZ(flat({ overhang: 0.6 })) + 0.003,
    )
  })
})
