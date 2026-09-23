import { expect, test } from 'bun:test'
import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector2, Vector3 } from 'three'
import type { CurtainWallPiece } from './curtain-wall-layout'
import {
  buildStraightCurtainPieces,
  buildStraightCurtainPiecesWithCutouts,
} from './curtain-wall-piece-geometry'

test('a pane around a doorway has no internal glass faces above the header', () => {
  const common = { front: 0.07, back: 0.05, role: 'glass' as const }
  const pieces: CurtainWallPiece[] = [
    { ...common, left: 0, right: 1, bottom: 0, top: 3 },
    { ...common, left: 1, right: 2, bottom: 2, top: 3 },
  ]
  const geometry = buildStraightCurtainPieces(pieces, 0)
  const material = new MeshBasicMaterial({ side: DoubleSide })
  const mesh = new Mesh(geometry, material)
  const ray = (x: number, y: number) =>
    new Raycaster(new Vector3(x, y, 0.06), new Vector3(1, 0, 0)).intersectObject(mesh, false)
  // Through the glass thickness, only the outer edge should remain.
  expect(ray(0.5, 2.5).every((hit) => Math.abs(hit.point.x - 2) < 1e-6)).toBe(true)
  expect(ray(0.5, 2.5).length).toBeGreaterThan(0)
  expect(ray(0.5, 1)[0]?.point.x).toBeCloseTo(1)
  expect(
    new Raycaster(new Vector3(1.5, 1, 1), new Vector3(0, 0, -1)).intersectObject(mesh, false),
  ).toHaveLength(0)
  geometry.dispose()
  material.dispose()
})

test('the live-preview path emits complete boxes from preallocated buffers', () => {
  const common = { front: 0.07, back: 0.05, role: 'glass' as const }
  const pieces: CurtainWallPiece[] = [
    { ...common, left: 0, right: 1, bottom: 0, top: 1 },
    { ...common, left: 1, right: 2, bottom: 1, top: 2 },
  ]
  const geometry = buildStraightCurtainPieces(pieces, 0.5, false)
  const positions = geometry.getAttribute('position')
  const normals = geometry.getAttribute('normal')

  geometry.computeBoundingBox()
  expect(positions.count).toBe(72)
  expect(normals.count).toBe(positions.count)
  expect(Array.from(positions.array).every(Number.isFinite)).toBe(true)
  expect(Array.from(normals.array).every(Number.isFinite)).toBe(true)
  expect(geometry.boundingBox?.min.x).toBeCloseTo(0)
  expect(geometry.boundingBox?.min.y).toBeCloseTo(0.5)
  expect(geometry.boundingBox?.min.z).toBeCloseTo(0.05)
  expect(geometry.boundingBox?.max.x).toBeCloseTo(2)
  expect(geometry.boundingBox?.max.y).toBeCloseTo(2.5)
  expect(geometry.boundingBox?.max.z).toBeCloseTo(0.07)
  geometry.dispose()
})

test('the straight shaped-opening path preserves a cutout contained inside a pane', () => {
  const geometry = buildStraightCurtainPiecesWithCutouts(
    [{ left: 0, right: 2, bottom: 0, top: 2, front: 0.07, back: 0.05, role: 'glass' }],
    0,
    [
      [
        new Vector2(0.75, 0.75),
        new Vector2(1.25, 0.75),
        new Vector2(1.25, 1.25),
        new Vector2(0.75, 1.25),
      ],
    ],
  )
  const material = new MeshBasicMaterial({ side: DoubleSide })
  const mesh = new Mesh(geometry, material)
  const ray = (x: number, y: number) =>
    new Raycaster(new Vector3(x, y, 1), new Vector3(0, 0, -1)).intersectObject(mesh, false)

  expect(ray(1, 1)).toHaveLength(0)
  expect(ray(0.25, 1).length).toBeGreaterThan(0)
  geometry.dispose()
  material.dispose()
})
