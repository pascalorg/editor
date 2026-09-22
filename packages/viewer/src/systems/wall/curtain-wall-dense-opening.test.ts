import { expect, test } from 'bun:test'
import { calculateLevelMiters, DoorNode, WallNode } from '@pascal-app/core'
import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three'
import { buildCurtainWallGeometry } from './curtain-wall-geometry'
import { generateExtrudedWall } from './wall-system'

test('dense-grid curved cuts preserve distant glass and leave the door clear', () => {
  const wall = WallNode.parse({
    start: [0, 0],
    end: [10, 0],
    height: 2.5,
    wallType: 'curtain',
    curtainWall: { columns: { layout: 'count', count: 32 }, rows: { layout: 'count', count: 32 } },
  })
  const door = DoorNode.parse({ position: [2, 1.05, 0], width: 1.5, openingShape: 'arch' })
  const material = new MeshBasicMaterial({ side: DoubleSide })
  const geometry = buildCurtainWallGeometry(
    wall,
    generateExtrudedWall(wall, [], calculateLevelMiters([wall])),
    [door],
  )
  try {
    const mesh = new Mesh(geometry, [material, material, material])
    const hit = (x: number, y: number) =>
      new Raycaster(new Vector3(x, y, 2), new Vector3(0, 0, -1)).intersectObject(mesh, false)
    expect(hit(2, 1)).toHaveLength(0)
    expect(hit(8.28, 1.21)[0]?.face?.materialIndex).toBe(1)
    expect(hit(0.02, 1)[0]?.face?.materialIndex).toBe(0)
    expect(Array.from(geometry.getAttribute('position').array).every(Number.isFinite)).toBe(true)
  } finally {
    geometry.dispose()
    material.dispose()
  }
})
