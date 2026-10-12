// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, test } from 'bun:test'
import {
  getGableRidge,
  getRoofSegmentCoverOutline,
  getRoofSegmentSurfaceY,
  pullRoofSegmentCoverEdge,
  RoofSegmentNode,
} from '@pascal-app/core'
import * as THREE from 'three'
import { ROOF_SLOT_ROLES } from './roof-materials'
import { generateRoofSegmentGeometry } from './roof-system'

/** A house 10 × 8 drawn as an outline; the roof's rectangle bounds it. */
const house = RoofSegmentNode.parse({
  type: 'roof-segment',
  squareEaves: true,
  roofType: 'gable',
  width: 10,
  depth: 8,
  wallHeight: 0,
  pitch: 30,
  backPitch: 20,
  ridgeOffset: 3.5,
  overhang: 0.4,
  wallThickness: 0.2,
  footprint: [
    [-5, -4],
    [5, -4],
    [5, 4],
    [-5, 4],
  ],
})

// the +z edge (index 2: [5,4] → [-5,4]) pulled 3 m out over a terrace
const pulled = { ...house, ...pullRoofSegmentCoverEdge(house, 2, 3)! }
// the segment's origin moved with its rectangle; a point at house-local (x, z)
// is at (x − shift.x, z − shift.z) in the pulled segment
const shift = {
  x: pulled.position[0] - house.position[0],
  z: pulled.position[2] - house.position[2],
}

describe('canopy pulled out of a gable', () => {
  test('the slopes stay in their planes and the ridge keeps its place and height', () => {
    const before = getGableRidge(house)!
    const after = getGableRidge(pulled)!
    expect(after.height).toBeCloseTo(before.height, 9)
    expect(after.ridgeZ + shift.z).toBeCloseTo(before.ridgeZ, 9)
    for (const [x, z] of [
      [0, 3],
      [2, -3],
      [-4, 1],
    ] as const) {
      expect(getRoofSegmentSurfaceY(pulled, x - shift.x, z - shift.z)).toBeCloseTo(
        getRoofSegmentSurfaceY(house, x, z),
        9,
      )
    }
    expect(pulled.depth).toBeCloseTo(11, 9)
  })

  test('the walls stay on the house; the covering reaches over the canopy', () => {
    const walls = pulled.footprint!.map(([x, z]) => [x + shift.x, z + shift.z])
    expect(walls).toEqual(house.footprint!.map(([x, z]) => [x, z]))
    const reach = Math.max(...pulled.coverFootprint!.map(([, z]) => z + shift.z))
    expect(reach).toBeCloseTo(7, 9)
  })

  test('over the canopy there is roof but no attic wall beneath it', () => {
    const geometry = generateRoofSegmentGeometry(pulled)
    const mesh = new THREE.Mesh(
      geometry,
      ROOF_SLOT_ROLES.map(() => new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })),
    )
    // above the terrace (house-local z = 5.5): the covering, in the slope's plane
    const z = 5.5 - shift.z
    const hits = new THREE.Raycaster(
      new THREE.Vector3(0, 30, z),
      new THREE.Vector3(0, -1, 0),
    ).intersectObject(mesh)
    expect(hits.length).toBeGreaterThan(0)
    expect(ROOF_SLOT_ROLES[hits[0]!.face!.materialIndex]).toBe('top')
    // nothing of the roof's own walls (the gables) out there
    expect(hits.some((hit) => ROOF_SLOT_ROLES[hit.face!.materialIndex] === 'edge')).toBe(false)
    geometry.dispose()
  })

  test('an edge does not come in past the walls', () => {
    const back = pullRoofSegmentCoverEdge(house, 2, -2)!
    const reach =
      Math.max(...back.coverFootprint!.map(([, z]) => z)) + (back.position![2] - house.position[2])
    expect(reach).toBeCloseTo(4, 9)
  })

  test('a gable end pulls out along the ridge as an open gable over a porch', () => {
    // edge 1: [5,-4] → [5,4], facing +x
    const porch = { ...house, ...pullRoofSegmentCoverEdge(house, 1, 2)! }
    const dx = porch.position[0] - house.position[0]
    expect(porch.width).toBeCloseTo(12, 9)
    expect(getGableRidge(porch)!.height).toBeCloseTo(getGableRidge(house)!.height, 9)
    const geometry = generateRoofSegmentGeometry(porch)
    const mesh = new THREE.Mesh(
      geometry,
      ROOF_SLOT_ROLES.map(() => new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })),
    )
    const hits = new THREE.Raycaster(
      new THREE.Vector3(6 - dx, 30, 0),
      new THREE.Vector3(0, -1, 0),
    ).intersectObject(mesh)
    expect(ROOF_SLOT_ROLES[hits[0]!.face!.materialIndex]).toBe('top')
    expect(hits.some((hit) => ROOF_SLOT_ROLES[hit.face!.materialIndex] === 'edge')).toBe(false)
    geometry.dispose()
  })
})

/** A segment's covering in house-local coordinates (undoing the rectangle's shift). */
function coverInHouse(node: ReturnType<typeof RoofSegmentNode.parse>) {
  const dx = node.position[0] - house.position[0]
  const dz = node.position[2] - house.position[2]
  return node.coverFootprint!.map(([x, z]) => [+(x + dx).toFixed(6), +(z + dz).toFixed(6)])
}

describe('a canopy grows out of the edge it was pulled from', () => {
  const pull = (node: ReturnType<typeof RoofSegmentNode.parse>, edge: number, by: number) =>
    RoofSegmentNode.parse({ ...node, ...pullRoofSegmentCoverEdge(node, edge, by)! })
  const out = pull(house, 2, 3)

  test('the wall corners stay; the piece reaches out from them, the pulled edge keeps its index', () => {
    const ring = coverInHouse(out)
    expect(ring).toContainEqual([5, 4])
    expect(ring).toContainEqual([-5, 4])
    expect(ring).toContainEqual([5, 7])
    expect(ring).toContainEqual([-5, 7])
    expect(ring[2]).toEqual([5, 7])
    expect(ring[3]).toEqual([-5, 7])
  })

  test("a side narrows the piece alone; the roof's own corners stay", () => {
    // the piece's +x side runs [5,4] → [5,7]
    const ring = coverInHouse(out)
    const side = ring.findIndex(
      (p, i) => p[0] === 5 && p[1] === 4 && ring[(i + 1) % ring.length]![1] === 7,
    )
    const narrow = coverInHouse(pull(out, side, -4))
    expect(narrow).toContainEqual([5, -4])
    expect(narrow).toContainEqual([5, 4])
    expect(narrow).toContainEqual([1, 4])
    expect(narrow).toContainEqual([1, 7])
    expect(narrow).toContainEqual([-5, 7])
    expect(narrow).not.toContainEqual([5, 7])
    // no further in than the piece's other side: narrowed to nothing it is gone
    expect(coverInHouse(pull(out, side, -50))).toHaveLength(4)
  })

  test('pulled back to the wall the piece is gone and the edge is whole again', () => {
    const back = coverInHouse(pull(out, 2, -3))
    expect(back).toHaveLength(4)
    for (const corner of house.footprint!) expect(back).toContainEqual(corner)
    // and no further in than the walls
    expect(coverInHouse(pull(out, 2, -10))).toHaveLength(4)
  })

  test('pulled further, the piece only grows longer', () => {
    const longer = coverInHouse(pull(out, 2, 1))
    expect(longer).toContainEqual([5, 8])
    expect(longer).toContainEqual([-5, 8])
    expect(longer).toHaveLength(6)
  })
})

describe('a canopy pulled the old way, its edge slid whole', () => {
  // the +z edge slid out to z = 7: the wall corners are not in the covering
  const old = RoofSegmentNode.parse({
    ...house,
    coverFootprint: [
      [-5, -4],
      [5, -4],
      [5, 7],
      [-5, 7],
    ],
  })

  test('its edges split at the wall corners, so the piece past the walls has sides', () => {
    const ring = getRoofSegmentCoverOutline(old)
    expect(ring).toContainEqual([5, 4])
    expect(ring).toContainEqual([-5, 4])
  })

  test('a side narrows that piece alone', () => {
    const ring = getRoofSegmentCoverOutline(old)
    const side = ring.findIndex(
      (p, i) => p[0] === 5 && p[1] === 4 && ring[(i + 1) % ring.length]![1] === 7,
    )
    expect(side).toBeGreaterThanOrEqual(0)
    const narrow = coverInHouse(
      RoofSegmentNode.parse({ ...old, ...pullRoofSegmentCoverEdge(old, side, -4)! }),
    )
    expect(narrow).toContainEqual([5, -4])
    expect(narrow).toContainEqual([5, 4])
    expect(narrow).toContainEqual([1, 4])
    expect(narrow).toContainEqual([1, 7])
    expect(narrow).toContainEqual([-5, 7])
  })
})

describe('a canopy with a slot narrower than the overhang', () => {
  test('the slot closes under the overhang; nothing hangs below the eaves', () => {
    // pulled edge by edge on a house's annex, a 5.5 cm slot left at a wall corner
    const slotted = RoofSegmentNode.parse({
      type: 'roof-segment',
      roofType: 'gable',
      width: 9.92,
      depth: 10.82,
      pitch: 23,
      backPitch: 17,
      ridgeOffset: 4.09,
      wallHeight: 1.1139,
      overhang: 0.5,
      squareEaves: true,
      fascia: true,
      wallThickness: 0.1,
      deckThickness: 0.1,
      shingleThickness: 0.05,
      footprint: [
        [-4.96, -2.96],
        [3.115, -2.96],
        [3.115, 1.19],
        [4.71, 1.19],
        [4.71, 5.41],
        [0.005, 5.41],
        [0.005, 3.91],
        [-4.96, 3.91],
      ],
      coverFootprint: [
        [4.71, 1.19],
        [4.71, 0.29],
        [4.96, 0.29],
        [4.96, 5.41],
        [4.71, 5.41],
        [0.005, 5.41],
        [0.005, 3.91],
        [-4.96, 3.91],
        [-4.96, -2.96],
        [-4.96, -5.41],
        [4.655, -5.41],
        [4.655, 1.19],
      ],
    })
    const lowest = Math.min(
      ...slotted.coverFootprint!.map(([x, z]) => getRoofSegmentSurfaceY(slotted, x, z)),
    )
    const geometry = generateRoofSegmentGeometry(slotted)
    const position = geometry.getAttribute('position')
    const index = geometry.index
    let low = Number.POSITIVE_INFINITY
    for (const group of geometry.groups) {
      const role = ROOF_SLOT_ROLES[group.materialIndex!]
      if (role === 'wall' || role === 'edge') continue
      for (let i = group.start; i < group.start + group.count; i++) {
        low = Math.min(low, position.getY(index ? index.getX(i) : i))
      }
    }
    geometry.dispose()
    expect(low).toBeGreaterThan(lowest - slotted.overhang - 0.4)
  })
})
