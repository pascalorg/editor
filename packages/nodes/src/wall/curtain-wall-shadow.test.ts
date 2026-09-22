import { expect, test } from 'bun:test'
import { calculateLevelMiters, useLiveNodeOverrides, WallNode, WindowNode } from '@pascal-app/core'
import { generateExtrudedWall } from '@pascal-app/viewer'
import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three'
import { curtainWallGeometryAdapter } from './curtain-wall-adapter'
import { buildCurtainWallGeometry } from './curtain-wall-geometry'
import { buildCurtainWallShadowGeometry } from './curtain-wall-shadow'

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

test('painted opaque glass casts a pane shadow', () => {
  const wall = WallNode.parse({
    start: [0, 0],
    end: [6, 0],
    height: 3,
    thickness: 0.15,
    wallType: 'curtain',
  })
  const visible = buildCurtainWallGeometry(
    wall,
    generateExtrudedWall(wall, [], calculateLevelMiters([wall])),
  )
  const frame = new MeshBasicMaterial()
  const glass = new MeshBasicMaterial({ opacity: 1, transparent: false })
  const solid = new MeshBasicMaterial()
  const mesh = new Mesh(visible, [frame, glass, solid])
  const shadow = new Mesh(buildCurtainWallShadowGeometry(visible, false), new MeshBasicMaterial())
  shadow.name = 'curtain-wall-shadow'
  mesh.add(shadow)
  curtainWallGeometryAdapter.syncAuxiliaryGeometry!(wall, mesh, visible)
  const hit = new Raycaster(new Vector3(0.75, 2.25, 2), new Vector3(0, 0, -1)).intersectObject(
    shadow,
  ).length
  expect(hit).toBeGreaterThan(0)
  shadow.geometry.dispose()
  ;(shadow.material as MeshBasicMaterial).dispose()
  visible.dispose()
  frame.dispose()
  glass.dispose()
  solid.dispose()
})

test('live opening previews defer curtain shadow rebuilding until the final geometry', () => {
  const wall = WallNode.parse({
    start: [0, 0],
    end: [6, 0],
    height: 3,
    thickness: 0.15,
    wallType: 'curtain',
  })
  const window = WindowNode.parse({
    parentId: wall.id,
    position: [1.5, 1.5, 0],
    openingShape: 'rounded',
  })
  const frame = new MeshBasicMaterial()
  const glass = new MeshBasicMaterial({ transparent: true, opacity: 0.4 })
  const solid = new MeshBasicMaterial()
  const visible = buildCurtainWallGeometry(
    wall,
    generateExtrudedWall(wall, [], calculateLevelMiters([wall])),
    [window],
  )
  const mesh = new Mesh(visible, [frame, glass, solid])
  const shadow = new Mesh(buildCurtainWallShadowGeometry(visible, false), new MeshBasicMaterial())
  shadow.name = 'curtain-wall-shadow'
  mesh.add(shadow)
  const committedShadow = shadow.geometry

  useLiveNodeOverrides.getState().set(window.id, {
    cornerRadius: 0.3,
    metadata: { deferParentRebuild: true },
  })
  const previewGeometry = curtainWallGeometryAdapter.buildGeometry!(
    wall,
    generateExtrudedWall(wall, [], calculateLevelMiters([wall])),
    [window],
  )
  curtainWallGeometryAdapter.syncAuxiliaryGeometry!(wall, mesh, previewGeometry)
  expect(shadow.geometry).toBe(committedShadow)

  useLiveNodeOverrides.getState().clear(window.id)
  const finalGeometry = curtainWallGeometryAdapter.buildGeometry!(
    wall,
    generateExtrudedWall(wall, [], calculateLevelMiters([wall])),
    [window],
  )
  curtainWallGeometryAdapter.syncAuxiliaryGeometry!(wall, mesh, finalGeometry)
  expect(shadow.geometry).not.toBe(committedShadow)

  committedShadow.dispose()
  shadow.geometry.dispose()
  ;(shadow.material as MeshBasicMaterial).dispose()
  previewGeometry.dispose()
  finalGeometry.dispose()
  visible.dispose()
  frame.dispose()
  glass.dispose()
  solid.dispose()
})
