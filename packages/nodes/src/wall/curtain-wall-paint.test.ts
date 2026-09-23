import { afterEach, expect, test } from 'bun:test'
import { sceneRegistry, useScene, WallNode } from '@pascal-app/core'
import { getVisibleWallMaterials } from '@pascal-app/viewer'
import { BoxGeometry, Mesh, Ray, Vector3 } from 'three'
import { resolveWallRole, wallPaint } from './paint'

const initial = useScene.getState()
globalThis.requestAnimationFrame ??= (callback) => {
  callback(0)
  return 0
}
globalThis.cancelAnimationFrame ??= () => {}
afterEach(() => {
  sceneRegistry.clear()
  useScene.setState(initial)
})

test('frame paint resolves through the wall proxy, previews only the frame, and commits a material reference', () => {
  const wall = WallNode.parse({ start: [0, 0], end: [4, 0], wallType: 'curtain' })
  useScene.setState({ nodes: { [wall.id]: wall }, materials: {} })
  const geometry = new BoxGeometry(0.1, 2, 0.1)
  geometry.clearGroups()
  geometry.addGroup(0, geometry.index!.count, 0)
  const original = getVisibleWallMaterials(wall)
  const mesh = new Mesh(geometry, original)
  sceneRegistry.nodes.set(wall.id, mesh)
  mesh.updateMatrixWorld(true)
  const role = resolveWallRole({
    node: wall,
    materialIndex: 1,
    normal: [0, 0, 1],
    localPosition: [0, 0, 0.05],
    ray: new Ray(new Vector3(0, 0, 1), new Vector3(0, 0, -1)),
  })
  expect(role).toBe('curtain-frame')
  const materialPreset = 'library:preset-metal'
  const restore = wallPaint.applyPreview({
    node: wall,
    root: mesh,
    role: role!,
    material: undefined,
    materialPreset,
  })
  expect(restore).not.toBeNull()
  expect(mesh.material[0]).not.toBe(original[0])
  expect(mesh.material[1]).toBe(original[1])
  expect(mesh.material[2]).toBe(original[2])
  expect(useScene.getState().nodes[wall.id]).toBe(wall)
  restore?.()
  expect(mesh.material).toBe(original)
  wallPaint.commit?.({ node: wall, role: role!, material: undefined, materialPreset })
  const updated = useScene.getState().nodes[wall.id] as WallNode
  expect(updated.slots).toEqual({ 'curtain-frame': materialPreset })
  expect(
    wallPaint.getEffectiveMaterial?.({
      node: updated,
      role: role!,
      nodes: useScene.getState().nodes,
    })?.materialPreset,
  ).toBe(materialPreset)
  wallPaint.commit?.({ node: updated, role: role!, material: undefined, materialPreset: undefined })
  const reset = useScene.getState().nodes[wall.id] as WallNode
  expect(reset.slots?.['curtain-frame']).toBeUndefined()
  expect(
    wallPaint.getEffectiveMaterial?.({ node: reset, role: role!, nodes: useScene.getState().nodes })
      ?.material?.properties?.color,
  ).toBe('#303942')
  geometry.dispose()
})
