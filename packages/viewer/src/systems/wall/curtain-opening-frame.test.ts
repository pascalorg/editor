import { expect, test } from 'bun:test'
import {
  calculateLevelMiters,
  DoorNode,
  sceneRegistry,
  WallNode,
  WindowNode,
} from '@pascal-app/core'
import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three'
import {
  buildCurtainOpeningFrame,
  curtainOpeningProfile,
  curtainProfileSpan,
} from './curtain-opening-frame'
import { buildCurtainWallGeometry } from './curtain-wall-geometry'
import { generateExtrudedWall } from './wall-system'

for (const type of ['door', 'window'] as const) {
  for (const shape of ['rectangle', 'rounded', 'arch'] as const) {
    test(`${type} ${shape} surround follows the opening and leaves its center clear`, () => {
      const opening = (type === 'door' ? DoorNode : WindowNode).parse({
        position: [1.5, 1.05, 0],
        width: 1,
        height: 2.1,
        openingShape: shape,
        cornerRadius: 0.3,
        archHeight: 0.6,
        openingRadiusMode: 'individual',
        openingTopRadii: [0.2, 0.4],
        openingCornerRadii: [0.2, 0.4, 0.1, 0.3],
      })
      const { frame, cutter } = buildCurtainOpeningFrame(opening, 0.05, 0.15)
      const material = new MeshBasicMaterial({ side: DoubleSide })
      const mesh = new Mesh(frame, material)
      const hit = (x: number, y: number) =>
        new Raycaster(new Vector3(x, y, 2), new Vector3(0, 0, -1)).intersectObject(mesh, false)
      expect(hit(1.5, 1)).toHaveLength(0)
      expect(hit(0.975, 1).length).toBeGreaterThan(0)
      expect(hit(1.5, 2.125).length).toBeGreaterThan(0)
      expect(hit(1.5, -0.025).length > 0).toBe(type === 'window')
      if (shape === 'arch') expect(hit(1.025, 2)).toHaveLength(0)
      expect(Array.from(frame.getAttribute('position').array).every(Number.isFinite)).toBe(true)
      frame.dispose()
      cutter.dispose()
      material.dispose()
    })
  }
}

test('arched curtain opening retains glass at the shoulders and painted frame material index', () => {
  const wall = WallNode.parse({ start: [0, 0], end: [6, 0], height: 3, wallType: 'curtain' })
  const door = DoorNode.parse({
    position: [2.25, 1.05, 0],
    width: 1,
    height: 2.1,
    openingShape: 'arch',
    archHeight: 0.6,
  })
  sceneRegistry.nodes.set(wall.id, new Mesh())
  const material = new MeshBasicMaterial({ side: DoubleSide })
  try {
    const geometry = buildCurtainWallGeometry(
      wall,
      generateExtrudedWall(wall, [], calculateLevelMiters([wall])),
      [door],
    )
    const mesh = new Mesh(geometry, [material, material, material])
    const hit = (x: number, y: number) =>
      new Raycaster(new Vector3(x, y, 2), new Vector3(0, 0, -1)).intersectObject(mesh, false)
    expect(hit(2.25, 1)).toHaveLength(0)
    expect(hit(2.25, 2.125)[0]?.face?.materialIndex).toBe(0)
    expect(hit(1.8, 2.05)[0]?.face?.materialIndex).toBe(1)
    geometry.dispose()
  } finally {
    sceneRegistry.nodes.delete(wall.id)
    material.dispose()
  }
})

test('rounded profiles respect individual radii and arch height edits', () => {
  const opening = WindowNode.parse({
    width: 2,
    height: 2,
    position: [1, 1, 0],
    openingShape: 'rounded',
    openingRadiusMode: 'individual',
    openingCornerRadii: [0.1, 0.7, 0.2, 0.3],
  })
  const span = curtainProfileSpan(curtainOpeningProfile(opening, 0.05).inner, 1.95)!
  expect(span[0]).toBeLessThan(0.1)
  expect(span[1]).toBeLessThan(1.7)
  const arch = { ...opening, openingShape: 'arch' as const, archHeight: 0.8 }
  const first = curtainProfileSpan(curtainOpeningProfile(arch, 0.05).inner, 1.8)!
  const changed = curtainProfileSpan(
    curtainOpeningProfile({ ...arch, archHeight: 0.3 }, 0.05).inner,
    1.8,
  )!
  expect(changed[1] - changed[0]).toBeGreaterThan(first[1] - first[0])
})

test('arched surrounds stop at the host wall top', () => {
  const wall = WallNode.parse({ start: [0, 0], end: [6, 0], height: 3, wallType: 'curtain' })
  const opening = WindowNode.parse({
    position: [2.25, 2.5, 0],
    width: 1,
    height: 1,
    openingShape: 'arch',
  })
  const geometry = buildCurtainWallGeometry(
    wall,
    generateExtrudedWall(wall, [], calculateLevelMiters([wall])),
    [opening],
  )
  geometry.computeBoundingBox()
  expect(geometry.boundingBox!.max.y).toBeCloseTo(3)
  expect(Array.from(geometry.getAttribute('position').array).every(Number.isFinite)).toBe(true)
  geometry.dispose()
})
