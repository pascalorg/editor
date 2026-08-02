// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, test } from 'bun:test'
import * as THREE from 'three'
import { getPascalTextureRef, stampPascalTextureRef } from './texture-reference'

// The module reads the storage origin lazily on first use, so setting the env
// here (before any stamp call) pins it for the whole test file.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://test-storage.supabase.co'
const STORAGE_ORIGIN = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin

describe('Pascal texture references', () => {
  test("resolves 'material' input to library-material for storage-bucket URLs", () => {
    const texture = new THREE.Texture()
    texture.colorSpace = THREE.SRGBColorSpace
    const src = `${STORAGE_ORIGIN}/storage/v1/object/public/materials/user/mtl_1/oak_basecolor_512.ktx2`

    const ref = stampPascalTextureRef(texture, { kind: 'material', src, slot: 'map' })

    expect(ref).toEqual({
      v: 1,
      kind: 'library-material',
      src,
      map: 'basecolor',
      colorSpace: 'srgb',
    })
    expect(getPascalTextureRef(texture)).toEqual(ref)
  })

  test("resolves 'material' input to app-material for assets-CDN catalog URLs", () => {
    const cdnOrigin = new URL(process.env.NEXT_PUBLIC_ASSETS_CDN_URL || 'https://editor.pascal.app')
      .origin
    const texture = new THREE.Texture()
    const src = `${cdnOrigin}/material/concrete/prepared_drywall/prepared_drywall_normal_512.ktx2`

    const ref = stampPascalTextureRef(texture, { kind: 'material', src, slot: 'normalMap' })

    expect(ref).toEqual({ v: 1, kind: 'app-material', src, map: 'normal', colorSpace: 'linear' })
    expect(getPascalTextureRef(texture)).toEqual(ref)

    const foreign = new THREE.Texture()
    expect(
      stampPascalTextureRef(foreign, {
        kind: 'material',
        src: 'https://example.com/material/concrete/x/x_basecolor_512.ktx2',
        slot: 'map',
      }),
    ).toBeNull()
  })

  test('stamps the exact project-asset payload for Pascal storage URLs', () => {
    const texture = new THREE.Texture()
    texture.colorSpace = THREE.SRGBColorSpace

    const ref = stampPascalTextureRef(texture, {
      kind: 'project-asset',
      src: `${STORAGE_ORIGIN}/storage/v1/object/public/project-assets/project/asset.png`,
      slot: 'map',
    })

    expect(ref).toEqual({
      v: 1,
      kind: 'project-asset',
      src: `${STORAGE_ORIGIN}/storage/v1/object/public/project-assets/project/asset.png`,
      map: 'basecolor',
      colorSpace: 'srgb',
    })
    expect(getPascalTextureRef(texture)).toEqual(ref)
  })

  test('keeps local and non-Pascal URLs unstamped', () => {
    for (const src of [
      'asset://project/asset',
      'blob:https://editor.pascal.app/asset',
      'data:image/png;base64,AAAA',
      'https://example.com/storage/v1/object/public/project-assets/project/asset.png',
    ]) {
      const texture = new THREE.Texture()
      expect(stampPascalTextureRef(texture, { kind: 'project-asset', src, slot: 'map' })).toBeNull()
      expect(texture.userData.pascalTextureRef).toBeUndefined()
    }
  })

  test('includes imageIndex only for item GLB references', () => {
    const texture = new THREE.Texture()
    const ref = stampPascalTextureRef(texture, {
      kind: 'item-glb',
      src: `${STORAGE_ORIGIN}/storage/v1/object/public/items/system/chair/model.glb`,
      slot: 'normalMap',
      imageIndex: 2,
    })

    expect(ref).toEqual({
      v: 1,
      kind: 'item-glb',
      src: `${STORAGE_ORIGIN}/storage/v1/object/public/items/system/chair/model.glb`,
      imageIndex: 2,
      map: 'normal',
      colorSpace: 'linear',
    })
  })
})
