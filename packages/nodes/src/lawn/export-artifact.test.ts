import { expect, test } from 'bun:test'
import { crc32, deflateSync, inflateSync } from 'node:zlib'
import {
  type AnyNode,
  LawnNode,
  nodeRegistry,
  registerNode,
  SiteNode,
  sceneRegistry,
} from '@pascal-app/core'
import { exportSceneToGlb, exportSceneToUsdz } from '@pascal-app/editor'
import { DataTexture, Group, Mesh, MeshStandardMaterial } from 'three'
import { buildLawnBakeGeometry } from './bake-geometry'
import { LAWN_CUTOUT_ALPHA_FLOOR } from './bake-textures'
import { lawnRenderDefinition } from './definition.render'
import { buildLawnGeometry, disposeLawnGeometry } from './geometry'

function required<T>(value: T | null | undefined, label: string): T {
  if (value == null) throw new Error(`Missing ${label} in exported lawn`)
  return value
}

// Only the browser's lossless PNG/Blob transport is supplied here. The node hook,
// portable normalization, GLTFExporter and USDZExporter are the production paths.
function chunk(type: string, bytes: Buffer) {
  const result = Buffer.alloc(12 + bytes.length)
  result.writeUInt32BE(bytes.length)
  result.write(type, 4)
  bytes.copy(result, 8)
  result.writeUInt32BE(crc32(result.subarray(4, -4)), result.length - 4)
  return result
}

class PixelCanvas {
  width = 0
  height = 0
  pixels = new Uint8ClampedArray()
  getContext() {
    return {
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: (image: ImageData) => {
        this.pixels = new Uint8ClampedArray(image.data)
        for (let i = 0; i < this.pixels.length; i += 4) {
          const alpha = required(this.pixels[i + 3], 'canvas alpha') / 255
          for (let c = 0; c < 3; c++)
            this.pixels[i + c] = alpha
              ? Math.round(required(this.pixels[i + c], 'canvas colour') * alpha) / alpha
              : 0
        }
      },
      drawImage: (source: PixelCanvas) => {
        this.pixels = source.pixels.slice()
      },
    }
  }
  toBlob(callback: (blob: Blob) => void) {
    const header = Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 8, 6, 0, 0, 0])
    header.writeUInt32BE(this.width)
    header.writeUInt32BE(this.height, 4)
    const row = this.width * 4
    const pixels = Buffer.alloc(this.height * (row + 1))
    for (let y = 0; y < this.height; y++)
      pixels.set(this.pixels.subarray(y * row, (y + 1) * row), y * (row + 1) + 1)
    const png = Buffer.concat([
      Buffer.from('89504e470d0a1a0a', 'hex'),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(pixels)),
      chunk('IEND', Buffer.alloc(0)),
    ])
    callback(new Blob([png], { type: 'image/png' }))
  }
}

class BlobReader {
  result?: ArrayBuffer
  onloadend?: () => void
  async readAsArrayBuffer(blob: Blob) {
    this.result = await blob.arrayBuffer()
    this.onloadend?.()
  }
}

function pngPixels(png: Buffer) {
  expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  const width = png.readUInt32BE(16),
    height = png.readUInt32BE(20),
    compressed: Buffer[] = []
  let ended = false
  for (let at = 8; at + 12 <= png.length; ) {
    const size = png.readUInt32BE(at)
    const type = png.toString('ascii', at + 4, at + 8)
    expect(at + size + 12).toBeLessThanOrEqual(png.length)
    if (type === 'IDAT') compressed.push(png.subarray(at + 8, at + 8 + size))
    if (type === 'IEND') {
      ended = true
      break
    }
    at += size + 12
  }
  expect(ended).toBe(true)
  const rows = inflateSync(Buffer.concat(compressed)),
    pixels = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    expect(rows[y * (width * 4 + 1)]).toBe(0)
    pixels.set(rows.subarray(y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1)), y * width * 4)
  }
  return { width, height, pixels }
}

type Picture = ReturnType<typeof pngPixels>

function assertMinifiedTuftPigments(texture: DataTexture, saved: Picture) {
  const { data, width, height } = texture.image
  const linear = Float64Array.from({ length: 256 }, (_, byte) => {
    const value = byte / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  const cutoff = LAWN_CUTOUT_ALPHA_FLOOR + (1 - LAWN_CUTOUT_ALPHA_FLOOR) * 0.32
  let totalError = 0,
    maximumError = 0,
    samples = 0
  for (let y = 0; y < height; y += 8)
    for (let x = 0; x < width; x += 8) {
      let alpha = 0
      const delta = [0, 0, 0]
      for (let row = y; row < y + 8; row++)
        for (let col = x; col < x + 8; col++) {
          const at = (row * width + col) * 4
          alpha += Number(data[at + 3])
          for (let channel = 0; channel < 3; channel++) {
            const savedByte = required(saved.pixels[at + channel], 'saved pigment')
            delta[channel] =
              required(delta[channel], 'colour delta') +
              required(linear[savedByte], 'saved linear pigment') -
              required(linear[Number(data[at + channel])], 'source linear pigment')
          }
        }
      if (alpha <= 255 * cutoff * 64) continue
      const error = delta.reduce((sum, value) => sum + Math.abs(value), 0) / (3 * 64)
      maximumError = Math.max(maximumError, error)
      totalError += error
      samples++
    }
  expect(samples).toBeGreaterThan(100)
  expect(totalError / samples).toBeLessThan(0.002)
  expect(maximumError).toBeLessThan(0.006)
}

function assertPictures(expected: DataTexture[], actual: Picture[]) {
  expect(actual).toHaveLength(expected.length)
  for (const texture of expected) {
    const { width, height, data } = texture.image
    const retained = actual.find((image) => {
      if (image.width !== width || image.height !== height) return false
      for (let i = 0; i < image.pixels.length; i += 4) {
        if (image.pixels[i + 3] !== data[i + 3]) return false
        // Opaque pigments survive exactly. The minified-footprint oracle below
        // also includes cutout gaps, whose RGB is quantized by premultiplication.
        if (data[i + 3] !== 255) continue
        for (let c = 0; c < 3; c++) if (image.pixels[i + c] !== data[i + c]) return false
      }
      return true
    })
    expect(retained).toBeDefined()
    if (retained && texture.name === 'lawn-tuft-colours-and-silhouettes')
      assertMinifiedTuftPigments(texture, retained)
  }
}

type IndexCounts = { tuft: number; other: number }

async function withLawnArtifact(
  run: (
    scene: Group,
    nodes: Record<string, AnyNode>,
    pictures: DataTexture[],
    indices: IndexCounts,
  ) => Promise<void>,
) {
  const lawn = LawnNode.parse({
    id: 'lawn_artifact',
    parentId: 'site_artifact',
    seed: 19,
    outline: [
      [-1, -3],
      [1, -3],
      [1, -1],
      [-1, -1],
    ],
    flowerDensity: 2,
    flowers: [{ species: 'daisy', color: '#df83be', share: 1 }],
  })
  const site = SiteNode.parse({ id: 'site_artifact', children: [lawn.id] })
  const nodes = { [site.id]: site, [lawn.id]: lawn }
  const live = buildLawnGeometry(lawn, { parent: site, sceneNodes: nodes })
  const expected = buildLawnBakeGeometry(lawn, { parent: site, sceneNodes: nodes })
  const pictures = new Set<DataTexture>()
  const indices: IndexCounts = { tuft: 0, other: 0 }
  expected.traverse((object) => {
    if (!(object instanceof Mesh) || !(object.material instanceof MeshStandardMaterial)) return
    expect(object.material.map).toBeInstanceOf(DataTexture)
    pictures.add(object.material.map as DataTexture)
    indices[object.name.startsWith('lawn-blades') ? 'tuft' : 'other'] +=
      object.geometry.index?.count ?? 0
  })
  const dom = {
    document: { createElement: () => new PixelCanvas() },
    HTMLCanvasElement: PixelCanvas,
    FileReader: BlobReader,
  }
  const descriptors = Object.getOwnPropertyDescriptors(globalThis)
  const restoreRegistry = nodeRegistry._snapshot()
  const previous = sceneRegistry.nodes.get(lawn.id)
  const before = JSON.stringify(nodes)
  try {
    nodeRegistry._reset()
    registerNode(lawnRenderDefinition)
    sceneRegistry.nodes.set(lawn.id, live)
    Object.assign(globalThis, dom)
    await run(new Group().add(live), nodes, [...pictures], indices)
    expect(JSON.stringify(nodes)).toBe(before)
  } finally {
    if (previous) sceneRegistry.nodes.set(lawn.id, previous)
    else sceneRegistry.nodes.delete(lawn.id)
    restoreRegistry()
    disposeLawnGeometry(live)
    disposeLawnGeometry(expected)
    for (const key of Object.keys(dom)) {
      const descriptor = descriptors[key]
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
}

type GlbDocument = {
  meshes: {
    name?: string
    primitives: {
      indices?: number
      mode?: number
      material: number
      attributes: Record<string, number>
    }[]
  }[]
  materials: {
    name?: string
    alphaMode?: string
    alphaCutoff?: number
    doubleSided?: boolean
    pbrMetallicRoughness: { baseColorTexture?: { index: number } }
  }[]
  images: { mimeType: string; bufferView: number; uri?: string }[]
  accessors: { count: number; bufferView: number; byteOffset?: number; componentType: number }[]
  bufferViews: { byteOffset?: number; byteLength: number; byteStride?: number }[]
}

function assertUpwardCanopy(doc: GlbDocument, bin: Buffer, normalIndex: number) {
  const accessor = required(doc.accessors[normalIndex], 'tuft normal accessor'),
    view = required(doc.bufferViews[accessor.bufferView], 'tuft normal buffer view')
  expect(accessor.componentType).toBe(5126)
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0),
    stride = view.byteStride ?? 12
  // Both windings are authored surfaces with the live normalNode's upward
  // normal, not an ordinary sheet whose duplicated back normals point down.
  for (let vertex = 0; vertex < accessor.count; vertex++) {
    const offset = start + vertex * stride
    const x = bin.readFloatLE(offset),
      y = bin.readFloatLE(offset + 4),
      z = bin.readFloatLE(offset + 8)
    expect(y).toBeGreaterThan(0.9)
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 5)
  }
}

for (const [purpose, textures] of [
  ['portable', 'embed'],
  ['viewer', 'reference'],
] as const) {
  test(`a real ${purpose} lawn GLB carries the tuft cutout, ground grain and flower pigments`, async () => {
    await withLawnArtifact(async (scene, nodes, pictures, indices) => {
      const glb = Buffer.from(await exportSceneToGlb(scene, nodes, { purpose, textures }))
      expect(glb.toString('ascii', 0, 4)).toBe('glTF')
      const end = 20 + glb.readUInt32LE(12)
      const doc: GlbDocument = JSON.parse(glb.toString('utf8', 20, end)),
        bin = glb.subarray(end + 8)
      assertPictures(
        pictures,
        doc.images.map((image) => {
          expect(image.mimeType).toBe('image/png')
          expect(image.uri).toBeUndefined()
          const view = required(doc.bufferViews[image.bufferView], 'PNG buffer view')
          return pngPixels(
            bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength),
          )
        }),
      )
      let exportedIndices = 0,
        tuft = false,
        flower = false,
        ground = false
      for (const mesh of doc.meshes)
        for (const primitive of mesh.primitives) {
          // Portable sidedness normalization may emit non-indexed triangles.
          const topologyIndex = required(
            primitive.indices ?? primitive.attributes.POSITION,
            'triangle accessor index',
          )
          expect(topologyIndex).toBeDefined()
          const topology = required(doc.accessors[topologyIndex], 'triangle accessor')
          expect(topology).toBeDefined()
          expect(primitive.mode ?? 4).toBe(4)
          expect(topology.count % 3).toBe(0)
          exportedIndices += topology.count
          const material = required(doc.materials[primitive.material], 'lawn material')
          expect(material.pbrMetallicRoughness.baseColorTexture).toBeDefined()
          expect(primitive.attributes.COLOR_0).toBeUndefined()
          expect(primitive.attributes.TEXCOORD_0).toBeDefined()
          if (material.name === 'lawn-tuft-colours-and-silhouettes') {
            tuft = true
            const cutoff = required(material.alphaCutoff, 'tuft alpha cutoff')
            expect((cutoff - LAWN_CUTOUT_ALPHA_FLOOR) / (1 - LAWN_CUTOUT_ALPHA_FLOOR)).toBeCloseTo(
              0.32,
              6,
            )
            expect(material.doubleSided ?? false).toBe(false)
            assertUpwardCanopy(doc, bin, required(primitive.attributes.NORMAL, 'tuft normals'))
          }
          if (material.name === 'lawn-flower-colours-and-corollas') {
            flower = true
            const cutoff = required(material.alphaCutoff, 'flower alpha cutoff')
            expect((cutoff - LAWN_CUTOUT_ALPHA_FLOOR) / (1 - LAWN_CUTOUT_ALPHA_FLOOR)).toBeCloseTo(
              0.28,
              6,
            )
          }
          if (material.name === 'lawn-ground-grain-and-colours') {
            ground = true
            expect(material.alphaMode ?? 'OPAQUE').toBe('OPAQUE')
          }
        }
      expect({ tuft, flower, ground }).toEqual({ tuft: true, flower: true, ground: true })
      expect(exportedIndices).toBe(indices.tuft + indices.other * (purpose === 'portable' ? 2 : 1))
    })
  })
}

function storedZipFiles(zip: Buffer) {
  const files = new Map<string, Buffer>()
  for (let at = 0; at + 30 < zip.length && zip.readUInt32LE(at) === 0x04034b50; ) {
    expect(zip.readUInt16LE(at + 8)).toBe(0)
    const size = zip.readUInt32LE(at + 18),
      nameLength = zip.readUInt16LE(at + 26),
      extraLength = zip.readUInt16LE(at + 28)
    const name = zip.toString('utf8', at + 30, at + 30 + nameLength),
      start = at + 30 + nameLength + extraLength
    files.set(name, zip.subarray(start, start + size))
    at = start + size
  }
  return files
}

test('a real lawn USDZ normalizes map-only appearance without dropping colours or cutouts', async () => {
  await withLawnArtifact(async (scene, nodes, pictures) => {
    const warnings: string[] = []
    const files = storedZipFiles(
      Buffer.from(
        await exportSceneToUsdz(scene, nodes, { onWarning: (warning) => warnings.push(warning) }),
      ),
    )
    expect(warnings).toEqual([])
    const images = [...files]
      .filter(([name]) => name.endsWith('.png'))
      .map(([, bytes]) => pngPixels(bytes))
    assertPictures(pictures, images)
    const usd = [...files]
      .filter(([name]) => /\.usda?$/.test(name))
      .map(([, bytes]) => bytes.toString('utf8'))
      .join('\n')
    const cutoffs = [...usd.matchAll(/inputs:opacityThreshold = ([0-9.eE+-]+)/g)].map(
      (match) => (Number(match[1]) - LAWN_CUTOUT_ALPHA_FLOOR) / (1 - LAWN_CUTOUT_ALPHA_FLOOR),
    )
    for (const cutoff of [0.32, 0.28])
      expect(cutoffs.some((value) => Math.abs(value - cutoff) < 1e-6)).toBe(true)
    expect(usd).toContain('primvars:st')
    expect(usd).toContain('inputs:diffuseColor.connect')
  })
})
