import { expect, test } from 'bun:test'
import { crc32, deflateSync } from 'node:zlib'
import { nodeRegistry, registerNode, sceneRegistry, TreeNode } from '@pascal-app/core'
import { exportSceneToGlb } from '@pascal-app/editor'
import { Group, type Mesh, type MeshStandardMaterial } from 'three'
import { treeRenderDefinition } from './definition.render'
import { buildTreeGeometry, disposeTreeResources } from './geometry'

// Bun has no HTML canvas or FileReader. Supply just the lossless RGBA -> PNG and Blob
// transport; both export preparations, Three's serializer and all binary payloads are real.
function chunk(type: string, bytes: Buffer) {
  const chunk = Buffer.alloc(12 + bytes.length)
  chunk.writeUInt32BE(bytes.length)
  chunk.write(type, 4)
  bytes.copy(chunk, 8)
  chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4)
  return chunk
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
      },
      drawImage: (source: PixelCanvas) => {
        this.pixels = source.pixels.slice()
      },
    }
  }
  png() {
    const header = Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 8, 6, 0, 0, 0])
    header.writeUInt32BE(this.width)
    header.writeUInt32BE(this.height, 4)
    const rowBytes = this.width * 4
    const rows = Buffer.alloc(this.height * (rowBytes + 1))
    for (let y = 0; y < this.height; y++) {
      rows.set(this.pixels.subarray(y * rowBytes, (y + 1) * rowBytes), y * (rowBytes + 1) + 1)
    }
    return Buffer.concat([
      Buffer.from('89504e470d0a1a0a', 'hex'),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(rows)),
      chunk('IEND', Buffer.alloc(0)),
    ])
  }
  toBlob(callback: (blob: Blob) => void) {
    callback(new Blob([this.png()], { type: 'image/png' }))
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

for (const [purpose, textures] of [
  ['portable', 'embed'],
  ['viewer', 'reference'],
] as const) {
  test(`a ${purpose} tree GLB carries its cutout atlas and linear vertex tints`, async () => {
    const dom = {
      document: { createElement: () => new PixelCanvas() },
      HTMLCanvasElement: PixelCanvas,
      FileReader: BlobReader,
    }
    const descriptors = Object.getOwnPropertyDescriptors(globalThis)
    const tree = TreeNode.parse({ form: 'round', seed: 19 })
    const group = buildTreeGeometry(tree)
    const restoreRegistry = nodeRegistry._snapshot()
    try {
      nodeRegistry._reset()
      registerNode(treeRenderDefinition)
      sceneRegistry.nodes.set(tree.id, group)
      Object.assign(globalThis, dom)
      const mesh = group.children[0] as Mesh
      const material = mesh.material as MeshStandardMaterial
      const atlas = material.map!.image
      const expected = new PixelCanvas()
      expected.width = atlas.width
      expected.height = atlas.height
      expected.pixels = new Uint8ClampedArray(atlas.data)
      const glb = Buffer.from(
        await exportSceneToGlb(new Group().add(group), { [tree.id]: tree }, { purpose, textures }),
      )
      expect(glb.toString('ascii', 0, 4)).toBe('glTF')
      const end = 20 + glb.readUInt32LE(12)
      const doc = JSON.parse(glb.toString('utf8', 20, end))
      const bin = glb.subarray(end + 8)
      const primitive = doc.meshes[0].primitives[0]
      const mat = doc.materials[primitive.material]
      expect(mat.alphaMode).toBe('MASK')
      expect(mat.alphaCutoff).toBeCloseTo(material.alphaTest)
      const texture = doc.textures[mat.pbrMetallicRoughness.baseColorTexture.index]
      const image = doc.images[texture.source]
      expect(image.mimeType).toBe('image/png')
      const view = doc.bufferViews[image.bufferView]
      const offset = view.byteOffset ?? 0
      const png = expected.png()
      expect(view.byteLength).toBeGreaterThanOrEqual(png.length)
      expect(bin.subarray(offset, offset + png.length).equals(png)).toBe(true)
      expect(mat.doubleSided).toBe(true)
      for (const [semantic, name] of [
        ['COLOR_0', 'color'],
        ['TEXCOORD_0', 'uv'],
      ] as const) {
        const attribute = mesh.geometry.getAttribute(name)
        const accessor = doc.accessors[primitive.attributes[semantic]]
        const data = doc.bufferViews[accessor.bufferView]
        expect(accessor.count).toBe(attribute.count)
        const start = (data.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
        const stride = data.byteStride ?? attribute.itemSize * 4
        for (let i = 0; i < attribute.count; i++) {
          for (let c = 0; c < attribute.itemSize; c++) {
            if (bin.readFloatLE(start + i * stride + 4 * c) !== attribute.getComponent(i, c)) {
              throw new Error(`Changed ${semantic} at vertex ${i}, component ${c}`)
            }
          }
        }
      }
    } finally {
      sceneRegistry.nodes.delete(tree.id)
      restoreRegistry()
      disposeTreeResources(group)
      for (const key of Object.keys(dom)) {
        if (descriptors[key]) Object.defineProperty(globalThis, key, descriptors[key]!)
        else Reflect.deleteProperty(globalThis, key)
      }
    }
  })
}
