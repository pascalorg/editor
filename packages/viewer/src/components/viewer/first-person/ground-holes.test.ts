import { describe, expect, test } from 'bun:test'
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  Vector3,
} from 'three'
import { cutGroundCollider } from './ground-holes'

/** A 10 × 10 m square on the plane y = 0.1 x (two triangles, facing up), plan 0..10 × 0..10. */
function slopedSquare(flip = false) {
  const corner = (x: number, z: number): [number, number, number] => [x, 0.1 * x, z]
  const up = [
    corner(0, 0),
    corner(0, 10),
    corner(10, 0),
    corner(10, 0),
    corner(0, 10),
    corner(10, 10),
  ]
  const vertices = flip ? [...up].reverse() : up
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(vertices.flat()), 3))
  const slope = new Vector3(-0.1, 1, 0).normalize()
  const normal = flip ? slope.clone().negate() : slope
  geometry.setAttribute(
    'normal',
    new BufferAttribute(
      new Float32Array(vertices.flatMap(() => [normal.x, normal.y, normal.z])),
      3,
    ),
  )
  return geometry
}

const HOLE: Array<[number, number]> = [
  [3, 3],
  [7, 3],
  [7, 6],
  [3, 6],
]

/** The up (1) or down (-1) facing of every triangle of a non-indexed geometry. */
function triangles(geometry: BufferGeometry) {
  const position = geometry.getAttribute('position')
  const out: Array<{ facing: number }> = []
  for (let i = 0; i < position.count; i += 3) {
    const [a, b, c] = [0, 1, 2].map(
      (k) => new Vector3(position.getX(i + k), position.getY(i + k), position.getZ(i + k)),
    ) as [Vector3, Vector3, Vector3]
    const normal = b.clone().sub(a).cross(c.clone().sub(a))
    out.push({ facing: Math.sign(normal.y) })
  }
  return out
}

function hitUnder(geometry: BufferGeometry, x: number, z: number): number | null {
  const mesh = new Mesh(geometry, new MeshBasicMaterial())
  mesh.updateMatrixWorld(true)
  const raycaster = new Raycaster()
  raycaster.set(new Vector3(x, 50, z), new Vector3(0, -1, 0))
  return raycaster.intersectObject(mesh, false)[0]?.point.y ?? null
}

describe('cutGroundCollider', () => {
  test('without holes the geometry is returned as it is', () => {
    const geometry = slopedSquare()
    expect(cutGroundCollider(geometry, [])).toBe(geometry)
  })

  test('the ground is gone over the hole and is the same surface everywhere else', () => {
    const cut = cutGroundCollider(slopedSquare(), [HOLE])
    expect(hitUnder(cut, 5, 4)).toBeNull()
    expect(hitUnder(cut, 3.2, 3.2)).toBeNull()
    expect(hitUnder(cut, 6.8, 5.8)).toBeNull()
    // Past the rim, on the slope the uncut triangle had: y = 0.1 x.
    for (const [x, z] of [
      [2.8, 4],
      [7.2, 4],
      [5, 2.8],
      [5, 6.2],
      [1, 1],
      [9, 9],
    ] as const)
      expect(hitUnder(cut, x, z)).toBeCloseTo(0.1 * x, 5)
  })

  test('what is left has the area of the ground less the hole, and faces as the ground did', () => {
    for (const flip of [false, true]) {
      const cut = cutGroundCollider(slopedSquare(flip), [HOLE])
      const pieces = triangles(cut)
      // The slope stretches the surface, so compare in plan: 100 - 12 m².
      const position = cut.getAttribute('position')
      let plan = 0
      for (let i = 0; i < position.count; i += 3) {
        const [a, b, c] = [0, 1, 2].map((k) => [position.getX(i + k), position.getZ(i + k)]) as [
          [number, number],
          [number, number],
          [number, number],
        ]
        plan += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2
      }
      expect(plan).toBeCloseTo(100 - 12, 3)
      for (const piece of pieces) expect(piece.facing).toBe(flip ? -1 : 1)
    }
  })

  test('the normals follow the ground and stay unit length', () => {
    const cut = cutGroundCollider(slopedSquare(), [HOLE])
    const normal = cut.getAttribute('normal')
    for (let i = 0; i < normal.count; i += 1) {
      expect(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i))).toBeCloseTo(1, 5)
      expect(normal.getX(i)).toBeCloseTo(-0.1 / Math.hypot(0.1, 1), 5)
    }
  })

  test('a triangle wholly inside the hole is dropped, vertical faces are kept', () => {
    const box = new BoxGeometry(2, 2, 2).toNonIndexed()
    box.translate(5, 0, 4.5)
    const before = box.getAttribute('position').count
    const cut = cutGroundCollider(box, [HOLE])
    // Top and bottom faces lie wholly inside the hole and go; the four sides (no plan area) stay.
    expect(cut.getAttribute('position').count).toBe(before - 12)
  })
})
