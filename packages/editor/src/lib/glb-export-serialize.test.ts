import { afterEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeDefinition,
  DoorNode,
  nodeRegistry,
  registerNode,
  sceneRegistry,
} from '@pascal-app/core'
import * as THREE from 'three'
import type { ExportTextureUtils } from './export-texture-utils'
import {
  exportSceneToGlb,
  type GlbExport,
  serializePreparedSceneToGlb,
  withExportDeadline,
} from './glb-export'

// GLTFExporter's binary path runs through document.createElement('canvas'),
// canvas.toBlob and three FileReader reads (image bufferView, merged buffer,
// final GLB). Bun has none of those, so a minimal stand-in drives the exporter
// the way a browser does — including the failure the browser reports only via
// `result === null` inside `onloadend`.
type Globals = Record<string, unknown>
const globals = globalThis as unknown as Globals
const DOM_KEYS = ['document', 'FileReader', 'ImageData', 'HTMLCanvasElement'] as const
const previous = new Map<string, unknown>()

class FakeImageData {
  constructor(
    public data: Uint8ClampedArray,
    public width: number,
    public height: number,
  ) {}
}

class FakeCanvas {
  width = 0
  height = 0
  private pixels: Uint8ClampedArray | null = null

  getContext() {
    return {
      translate: () => {},
      scale: () => {},
      drawImage: () => {},
      fillRect: () => {},
      createImageData: (width: number, height: number) =>
        new FakeImageData(new Uint8ClampedArray(width * height * 4), width, height),
      putImageData: (image: FakeImageData) => {
        this.pixels = new Uint8ClampedArray(image.data)
      },
      getImageData: (_x: number, _y: number, width: number, height: number) =>
        new FakeImageData(this.pixels ?? new Uint8ClampedArray(width * height * 4), width, height),
    }
  }

  toBlob(callback: (blob: Blob) => void, mimeType: string) {
    callback(new Blob([new Uint8Array([137, 80, 78, 71])], { type: mimeType }))
  }
}

type FileReaderBehaviour = {
  reads: number
  /** 1-based index of the read whose result is `null`, as after a failed read. */
  failAt: number
}

function installExporterDom(behaviour: FileReaderBehaviour) {
  for (const key of DOM_KEYS) previous.set(key, globals[key])

  class FakeFileReader {
    result: ArrayBuffer | null = null
    onloadend: (() => void) | null = null
    readAsArrayBuffer(blob: Blob) {
      behaviour.reads += 1
      const read = behaviour.reads
      void blob.arrayBuffer().then((buffer) => {
        this.result = read === behaviour.failAt ? null : buffer
        // Browsers report an exception thrown inside the event handler to
        // window.onerror; it never reaches the exporter's promise chain.
        try {
          this.onloadend?.()
        } catch {}
      })
    }
  }

  globals.ImageData = FakeImageData
  globals.HTMLCanvasElement = FakeCanvas
  globals.FileReader = FakeFileReader
  globals.document = {
    createElement: (tagName: string) => {
      if (tagName !== 'canvas') throw new Error(`Unexpected element request: ${tagName}`)
      return new FakeCanvas()
    },
  }
}

afterEach(() => {
  for (const key of DOM_KEYS) globals[key] = previous.get(key)
})

function texturedRoot(texture: THREE.Texture): THREE.Group {
  const root = new THREE.Group()
  root.add(
    new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ map: texture }),
    ),
  )
  return root
}

function texturedScene(texture: THREE.Texture): GlbExport {
  return { scene: texturedRoot(texture), animations: [], warnings: [], dispose: () => {} }
}

function readableTexture(): THREE.DataTexture {
  const texture = new THREE.DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1)
  texture.needsUpdate = true
  return texture
}

function passthroughUtils(): ExportTextureUtils & { calls: THREE.Texture[] } {
  const calls: THREE.Texture[] = []
  return {
    calls,
    decompress: async (texture) => {
      calls.push(texture)
      return readableTexture()
    },
    dispose: async () => {},
  }
}

const GLB_MAGIC = 0x46546c67

describe('serializePreparedSceneToGlb', () => {
  test('resolves a binary glTF and routes compressed textures through the shared decompressor', async () => {
    installExporterDom({ reads: 0, failAt: Number.POSITIVE_INFINITY })
    const compressed = new THREE.CompressedTexture([], 2, 2)
    compressed.name = 'Color_ktx2'
    const textureUtils = passthroughUtils()

    const glb = await serializePreparedSceneToGlb(texturedScene(compressed), { textureUtils })

    expect(glb).toBeInstanceOf(ArrayBuffer)
    expect(new DataView(glb).getUint32(0, true)).toBe(GLB_MAGIC)
    expect(new DataView(glb).getUint32(8, true)).toBe(glb.byteLength)
    expect(textureUtils.calls.map((texture) => texture.name)).toEqual(['Color_ktx2'])
  })

  test('rejects instead of resolving null when the final GLB read fails', async () => {
    installExporterDom({ reads: 0, failAt: 3 })

    await expect(
      serializePreparedSceneToGlb(texturedScene(readableTexture()), {
        textureUtils: passthroughUtils(),
      }),
    ).rejects.toThrow('GLB export produced no data')
  })
})

describe('withExportDeadline', () => {
  test('passes a settled value through and clears its timer', async () => {
    await expect(withExportDeadline(Promise.resolve(7), 1_000, 'GLB')).resolves.toBe(7)
  })

  test('names the format and the wait in the timeout error', async () => {
    const pending = new Promise<never>(() => {})
    await expect(withExportDeadline(pending, 10, 'USDZ')).rejects.toThrow(
      /USDZ export timed out after \d+ s/,
    )
  })

  test('an infinite deadline returns the original promise', () => {
    const pending = new Promise<never>(() => {})
    expect(withExportDeadline(pending, Number.POSITIVE_INFINITY, 'GLB')).toBe(pending)
  })
})

describe('exportSceneToGlb', () => {
  afterEach(() => {
    sceneRegistry.clear()
  })

  test('rejects at the deadline when a FileReader inside GLTFExporter fails silently', async () => {
    // The image bufferView read is the first one; a null result throws inside
    // onloadend, so GLTFExporter's pending list never drains.
    installExporterDom({ reads: 0, failAt: 1 })

    await expect(
      exportSceneToGlb(
        texturedRoot(readableTexture()),
        {},
        {
          textureUtils: passthroughUtils(),
          timeoutMs: 50,
        },
      ),
    ).rejects.toThrow('GLB export timed out')
  })

  test('exports a live scene through a caller-owned decompressor without disposing it', async () => {
    installExporterDom({ reads: 0, failAt: Number.POSITIVE_INFINITY })
    const root = new THREE.Group()
    root.add(
      new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ map: readableTexture() }),
      ),
    )
    const textureUtils = passthroughUtils()
    let disposals = 0
    textureUtils.dispose = async () => {
      disposals += 1
    }

    const glb = await exportSceneToGlb(root, {}, { textureUtils, timeoutMs: 5_000 })

    expect(new DataView(glb).getUint32(0, true)).toBe(GLB_MAGIC)
    expect(disposals).toBe(0)
  })

  test('rejects at the deadline when a plugin bake hook never settles', async () => {
    installExporterDom({ reads: 0, failAt: Number.POSITIVE_INFINITY })
    const restoreRegistry = nodeRegistry._snapshot()
    try {
      const kind = 'test:bake-never-settles'
      registerNode({
        kind,
        schemaVersion: 1,
        schema: DoorNode,
        category: 'furnish',
        defaults: () => ({}) as never,
        capabilities: {},
        bake: 'replace',
        bakeGeometryAsync: () => new Promise<THREE.Object3D>(() => {}),
      } as AnyNodeDefinition)
      const source = new THREE.Group()
      source.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()))
      const root = new THREE.Group()
      root.add(source)
      sceneRegistry.nodes.set('stuck_1', source)
      const nodes = {
        stuck_1: { id: 'stuck_1', type: kind, visible: true },
      } as unknown as Record<string, AnyNode>

      await expect(
        exportSceneToGlb(root, nodes, { textureUtils: passthroughUtils(), timeoutMs: 50 }),
      ).rejects.toThrow('GLB export timed out')
    } finally {
      restoreRegistry()
    }
  })

  test('preparation and serialisation share one decompressor', async () => {
    installExporterDom({ reads: 0, failAt: Number.POSITIVE_INFINITY })
    const map = new THREE.CompressedTexture([], 2, 2)
    map.name = 'Color_ktx2'
    const normalMap = new THREE.CompressedTexture([], 2, 2)
    normalMap.name = 'NormalGL_ktx2'
    const material = new THREE.MeshStandardMaterial({ map, normalMap })
    // A non-unit normalScale forces the preparation pass to bake (and so
    // decompress) the normal map before the exporter ever sees it.
    material.normalScale.set(0.5, 0.5)
    const root = new THREE.Group()
    root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material))
    const textureUtils = passthroughUtils()

    const glb = await exportSceneToGlb(root, {}, { textureUtils, timeoutMs: 5_000 })

    expect(new DataView(glb).getUint32(0, true)).toBe(GLB_MAGIC)
    expect(textureUtils.calls.map((texture) => texture.name).sort()).toEqual([
      'Color_ktx2',
      'NormalGL_ktx2',
    ])
  })
})
