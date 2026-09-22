import { expect, test } from 'bun:test'
import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three'
import type { CurtainWallPiece } from './curtain-wall-layout'
import { buildStraightCurtainPieces } from './curtain-wall-piece-geometry'

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
