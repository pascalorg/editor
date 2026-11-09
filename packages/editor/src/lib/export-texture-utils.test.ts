import { afterEach, describe, expect, test } from 'bun:test'
import * as THREE from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import { createExportTextureUtils } from './export-texture-utils'

const globals = globalThis as unknown as { document?: unknown }
const previousDocument = globals.document

type FakeRenderer = {
  renderer: WebGPURenderer
  calls: { render: number; dispose: number; destroy: number; sizes: [number, number][] }
  domElement: object
}

function fakeRenderer(): FakeRenderer {
  const calls = { render: 0, dispose: 0, destroy: 0, sizes: [] as [number, number][] }
  const domElement = { kind: 'renderer-canvas' }
  const renderer = {
    domElement,
    outputColorSpace: THREE.SRGBColorSpace,
    backend: {
      device: {
        destroy: () => {
          calls.destroy += 1
        },
      },
    },
    setSize: (width: number, height: number) => {
      calls.sizes.push([width, height])
    },
    render: () => {
      calls.render += 1
    },
    dispose: async () => {
      calls.dispose += 1
    },
  }
  return { renderer: renderer as unknown as WebGPURenderer, calls, domElement }
}

function installCanvasDocument(drawn: object[]) {
  globals.document = {
    createElement: (tagName: string) => {
      if (tagName !== 'canvas') throw new Error(`Unexpected element request: ${tagName}`)
      return {
        width: 0,
        height: 0,
        getContext: () => ({
          drawImage: (source: object) => {
            drawn.push(source)
          },
        }),
      }
    },
  }
}

function compressedTexture(name: string, width = 8, height = 4): THREE.CompressedTexture {
  const texture = new THREE.CompressedTexture([], width, height)
  texture.name = name
  texture.colorSpace = THREE.NoColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.MirroredRepeatWrapping
  texture.minFilter = THREE.NearestFilter
  texture.magFilter = THREE.NearestFilter
  return texture
}

afterEach(() => {
  globals.document = previousDocument
})

describe('createExportTextureUtils', () => {
  test('starts one renderer for every compressed texture in the export and releases it once', async () => {
    const drawn: object[] = []
    installCanvasDocument(drawn)
    const fake = fakeRenderer()
    let starts = 0
    const utils = createExportTextureUtils(async () => {
      starts += 1
      return fake.renderer
    })

    const readable = await Promise.all([
      utils.decompress(compressedTexture('NormalGL_a')),
      utils.decompress(compressedTexture('Color_b', 16, 16)),
      utils.decompress(compressedTexture('Rough_c', 2, 8)),
    ])

    expect(starts).toBe(1)
    expect(fake.calls.render).toBe(3)
    expect(fake.calls.sizes).toEqual([
      [8, 4],
      [16, 16],
      [2, 8],
    ])
    expect(drawn).toEqual([fake.domElement, fake.domElement, fake.domElement])
    expect(fake.renderer.outputColorSpace).toBe(THREE.SRGBColorSpace)

    const first = readable[0] as THREE.CanvasTexture
    expect(first.isCanvasTexture).toBe(true)
    expect(first.name).toBe('NormalGL_a')
    expect(first.colorSpace).toBe(THREE.NoColorSpace)
    expect(first.wrapS).toBe(THREE.RepeatWrapping)
    expect(first.wrapT).toBe(THREE.MirroredRepeatWrapping)
    expect(first.minFilter).toBe(THREE.NearestFilter)
    expect(first.magFilter).toBe(THREE.NearestFilter)

    await utils.dispose()
    await utils.dispose()
    expect(fake.calls.dispose).toBe(1)
    expect(fake.calls.destroy).toBe(1)
  })

  test('clamps the readback to maxTextureSize', async () => {
    installCanvasDocument([])
    const fake = fakeRenderer()
    const utils = createExportTextureUtils(async () => fake.renderer)

    const readable = await utils.decompress(compressedTexture('Color', 4096, 1024), 2048)

    expect(fake.calls.sizes).toEqual([[2048, 1024]])
    expect((readable.image as { width: number; height: number }).width).toBe(2048)
    await utils.dispose()
  })

  test('rejects when no GPU renderer can start instead of leaving the export pending', async () => {
    installCanvasDocument([])
    const utils = createExportTextureUtils(async () => {
      throw new Error('no adapter')
    })

    await expect(utils.decompress(compressedTexture('Color'))).rejects.toThrow('no adapter')
    await expect(utils.decompress(compressedTexture('Color'))).rejects.toThrow('no adapter')
    await expect(utils.dispose()).resolves.toBeUndefined()
  })

  test('disposing without decompressing never starts a renderer', async () => {
    let starts = 0
    const utils = createExportTextureUtils(async () => {
      starts += 1
      return fakeRenderer().renderer
    })

    await utils.dispose()
    expect(starts).toBe(0)
  })

  test('a decompress after dispose rejects instead of starting an unowned renderer', async () => {
    installCanvasDocument([])
    const fake = fakeRenderer()
    let starts = 0
    const utils = createExportTextureUtils(async () => {
      starts += 1
      return fake.renderer
    })

    await utils.decompress(compressedTexture('Color'))
    await utils.dispose()
    await expect(utils.decompress(compressedTexture('Color'))).rejects.toThrow('abandoned')
    await utils.dispose()

    expect(starts).toBe(1)
    expect(fake.calls.dispose).toBe(1)
    expect(fake.calls.destroy).toBe(1)
  })
})
