import { expect, test } from 'bun:test'
import { calculateLevelMiters, WallNode } from '@pascal-app/core'
import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three'
import { buildCurtainWallGeometry } from './curtain-wall-geometry'
import { buildCurtainWallShadowGeometry } from './curtain-wall-shadow'
import { generateExtrudedWall } from './wall-system'

test('shadow geometry blocks frames and spandrels but leaves transparent pane openings', () => {
  const wall = WallNode.parse({
    start: [0, 0],
    end: [6, 0],
    height: 3,
    thickness: 0.15,
    wallType: 'curtain',
    curtainWall: { spandrel: 'bottom' },
  })
  const visible = buildCurtainWallGeometry(
    wall,
    generateExtrudedWall(wall, [], calculateLevelMiters([wall])),
  )
  const shadow = buildCurtainWallShadowGeometry(visible, false)
  const opaque = buildCurtainWallShadowGeometry(visible, true)
  const material = new MeshBasicMaterial({ side: DoubleSide })
  const mesh = new Mesh(shadow, material)
  const hit = (x: number, y: number) =>
    new Raycaster(new Vector3(x, y, 2), new Vector3(0, 0, -1)).intersectObject(mesh).length > 0
  expect(hit(0.75, 2.25)).toBe(false)
  expect(hit(1.5, 2.25)).toBe(true)
  expect(hit(0.75, 0.75)).toBe(true)
  mesh.geometry = opaque
  expect(hit(0.75, 2.25)).toBe(true)
  expect(shadow.index!.count).toBeLessThan(opaque.index!.count)
  visible.dispose()
  shadow.dispose()
  opaque.dispose()
  material.dispose()
})
