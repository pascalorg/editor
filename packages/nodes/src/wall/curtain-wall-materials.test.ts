import { expect, test } from 'bun:test'
import {
  CurtainWallConfig,
  MaterialPresetPayloadSchema,
  registerLibraryMaterials,
  SceneMaterial,
  unregisterLibraryMaterials,
  WallNode,
} from '@pascal-app/core'
import { resolveMaterialRef } from '@pascal-app/viewer'
import { Texture } from 'three'
import type { MeshStandardNodeMaterial } from 'three/webgpu'
import { getCurtainAwareWallMaterials } from './curtain-wall-materials'

test('painted frames keep shared texture updates and do not dispose the paint material on edits', () => {
  const ref = 'library:preset-metal'
  const shared = resolveMaterialRef(ref, undefined, 'rendered') as MeshStandardNodeMaterial
  const wall = WallNode.parse({
    start: [0, 0],
    end: [4, 0],
    wallType: 'curtain',
    slots: { 'curtain-frame': ref },
  })
  const first = getCurtainAwareWallMaterials(wall)
  expect(first.visible[0]).toBe(shared)
  const previousMap = shared.map
  const texture = new Texture()
  let disposed = false
  const onDispose = () => {
    disposed = true
  }
  shared.addEventListener('dispose', onDispose)
  try {
    shared.map = texture
    expect((first.visible[0] as MeshStandardNodeMaterial).map).toBe(texture)
    const next = getCurtainAwareWallMaterials({
      ...wall,
      curtainWall: CurtainWallConfig.parse({ glassOpacity: 0.6 }),
    })
    expect(next.visible[0]).toBe(shared)
    expect(disposed).toBe(false)
    expect(next.visible[1]!.opacity).toBe(0.6)
  } finally {
    shared.map = previousMap
    shared.removeEventListener('dispose', onDispose)
    texture.dispose()
  }
})

test('scene material edits update the frame while preserving glass and solid panel settings', () => {
  const material = SceneMaterial.parse({
    id: 'smat_curtainframe',
    name: 'Frame finish',
    material: { preset: 'metal' },
  })
  const wall = WallNode.parse({
    start: [0, 0],
    end: [4, 0],
    wallType: 'curtain',
    slots: { 'curtain-frame': `scene:${material.id}` },
  })
  const first = getCurtainAwareWallMaterials(wall, 'rendered', true, 'clay', undefined, {
    [material.id]: material,
  })
  const edited = SceneMaterial.parse({
    ...material,
    material: {
      preset: 'custom',
      properties: { color: '#ff0000', roughness: 0.2, metalness: 0.9 },
    },
  })
  const next = getCurtainAwareWallMaterials(wall, 'rendered', true, 'clay', undefined, {
    [material.id]: edited,
  })
  expect(next.visible[0]).not.toBe(first.visible[0])
  expect((next.visible[0] as MeshStandardNodeMaterial).color.getHexString()).toBe('ff0000')
  expect((next.visible[0] as MeshStandardNodeMaterial).roughness).toBe(0.2)
  expect(next.visible[1]!.opacity).toBe(0.3)
})

test('late library frame paint replaces the fallback without turning curtain glass opaque', () => {
  const id = 'mtl_curtain_continuity'
  const ref = `library:${id}`
  const wall = WallNode.parse({
    start: [0, 0],
    end: [4, 0],
    wallType: 'curtain',
    slots: { 'curtain-frame': ref },
    curtainWall: { glassOpacity: 0.42, glassRoughness: 0.19 },
  })
  const first = getCurtainAwareWallMaterials(wall)
  try {
    registerLibraryMaterials([
      {
        id,
        label: 'Late frame paint',
        category: 'colors',
        preset: MaterialPresetPayloadSchema.parse({
          maps: {},
          mapProperties: { color: '#2468ac', metalness: 0.8, roughness: 0.23 },
        }),
      },
    ])
    const next = getCurtainAwareWallMaterials(wall)
    const frame = next.visible[0] as MeshStandardNodeMaterial
    const glass = next.visible[1] as MeshStandardNodeMaterial
    expect(frame).not.toBe(first.visible[0])
    expect(frame).toBe(resolveMaterialRef(ref, undefined, 'rendered'))
    expect(frame.color.getHexString()).toBe('2468ac')
    expect(frame.metalness).toBe(0.8)
    expect(frame.roughness).toBe(0.23)
    expect(glass.transparent).toBe(true)
    expect(glass.opacity).toBe(0.42)
    expect(glass.depthWrite).toBe(false)
    expect(glass.roughness).toBe(0.19)
  } finally {
    unregisterLibraryMaterials([id])
  }
})
