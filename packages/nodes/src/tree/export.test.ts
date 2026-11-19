import { expect, test } from 'bun:test'
import { crc32, deflateSync, inflateSync } from 'node:zlib'
import { nodeRegistry, registerNode, sceneRegistry, TreeNode } from '@pascal-app/core'
import { exportSceneToGlb, exportSceneToUsdz } from '@pascal-app/editor'
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  SRGBColorSpace,
} from 'three'
import { unzipSync } from 'three/examples/jsm/libs/fflate.module.js'
import { USDAParser } from 'three/examples/jsm/loaders/usd/USDAParser.js'
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

// Canvas stores premultiplied channels. A straight RGBA readback loses RGB at alpha zero.
function canvasPixels(source: Uint8ClampedArray): Uint8ClampedArray<ArrayBuffer> {
  const pixels = new Uint8ClampedArray(source)
  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3]! / 255
    for (let c = 0; c < 3; c++)
      pixels[i + c] = alpha ? Math.round(pixels[i + c]! * alpha) / alpha : 0
  }
  return pixels
}

class PixelCanvas {
  width = 0
  height = 0
  pixels = new Uint8ClampedArray()
  getContext() {
    let flipY = false
    return {
      translate: () => {},
      scale: (_x: number, y: number) => {
        flipY = y < 0
      },
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: (image: ImageData) => {
        this.pixels = canvasPixels(image.data)
      },
      drawImage: (source: PixelCanvas) => {
        this.pixels = source.pixels.slice()
        if (flipY)
          for (let row = 0; row < this.height; row++)
            this.pixels.set(
              source.pixels.subarray(
                (this.height - row - 1) * this.width * 4,
                (this.height - row) * this.width * 4,
              ),
              row * this.width * 4,
            )
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
      expected.pixels = canvasPixels(new Uint8ClampedArray(atlas.data))
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

test('minified leaves keep their tone after a canvas PNG round trip', () => {
  const group = buildTreeGeometry(TreeNode.parse({}))
  try {
    const material = (group.children[0] as Mesh).material as MeshStandardMaterial
    const { width, height, data } = material.map!.image
    const saved = canvasPixels(new Uint8ClampedArray(data))
    // A mip footprint mixes linear RGB from gaps as well as blades. Compare only
    // footprints that pass the leaf mask at this distance.
    const linear = Array.from({ length: 256 }, (_, byte) => {
      const s = byte / 255
      return 255 * (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4)
    })
    const size = 8
    let totalError = 0
    let samples = 0
    for (let y = 0; y < height; y += size)
      for (let x = 0; x < width; x += size) {
        let alpha = 0
        const delta = [0, 0, 0]
        for (let row = y; row < y + size; row++)
          for (let col = x; col < x + size; col++) {
            const at = 4 * (row * width + col)
            alpha += data[at + 3]!
            for (let c = 0; c < 3; c++)
              delta[c]! += linear[saved[at + c]!]! - linear[data[at + c]!]!
          }
        if (alpha <= 255 * material.alphaTest * size * size) continue
        samples++
        totalError += delta.reduce((sum, error) => sum + Math.abs(error), 0)
      }
    expect(samples).toBeGreaterThan(0)
    expect(totalError / (3 * samples * size * size)).toBeLessThan(2)
  } finally {
    disposeTreeResources(group)
  }
})

type UsdSpecs = Record<
  string,
  {
    fields: {
      typeName?: string
      default?: unknown
      references?: string[]
      targetPaths?: string[]
      connectionPaths?: string[]
    }
  }
>

function parseUsdz(archive: Uint8Array) {
  const files = unzipSync(archive)
  expect(Object.keys(files)[0]).toBe('model.usda')
  const layers = new Map<string, UsdSpecs>()
  for (const [name, bytes] of Object.entries(files)) {
    if (name.endsWith('.usda')) {
      const text = new TextDecoder().decode(bytes)
      expect(text.startsWith('#usda 1.0')).toBe(true)
      const { specsByPath } = new USDAParser().parseData(text)
      layers.set(name, specsByPath)
    }
  }
  const model = layers.get('model.usda')!
  for (const spec of Object.values(model)) {
    for (const reference of spec.fields.references ?? []) {
      const name = reference.match(/@\.\/([^@]+)@/)![1]!
      expect(layers.has(name)).toBe(true)
    }
    if (spec.fields.typeName === 'asset') expect(files[spec.fields.default as string]).toBeDefined()
  }
  return { files, layers, model }
}

function decodePng(bytes: Uint8Array) {
  const png = Buffer.from(bytes)
  expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  const width = png.readUInt32BE(16)
  const height = png.readUInt32BE(20)
  const chunks: Buffer[] = []
  for (let offset = 8; offset < png.length; ) {
    const length = png.readUInt32BE(offset)
    if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT')
      chunks.push(png.subarray(offset + 8, offset + 8 + length))
    offset += length + 12
  }
  const rows = inflateSync(Buffer.concat(chunks))
  const pixels = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    const start = y * (width * 4 + 1)
    expect(rows[start]).toBe(0)
    pixels.set(rows.subarray(start + 1, start + 1 + width * 4), y * width * 4)
  }
  return { width, height, pixels }
}

function leafColor(
  image: ReturnType<typeof decodePng>,
  row: number,
  scale: number[],
  cutoff: number,
) {
  const mean = new Color(0, 0, 0)
  const pixel = new Color()
  let samples = 0
  const tile = image.width / 4
  for (let y = row * tile; y < (row + 1) * tile; y++)
    for (let x = 0; x < tile; x++) {
      const offset = (y * image.width + x) * 4
      if (image.pixels[offset + 3]! < cutoff * 255) continue
      mean.add(
        pixel.setRGB(
          image.pixels[offset]! / 255,
          image.pixels[offset + 1]! / 255,
          image.pixels[offset + 2]! / 255,
          SRGBColorSpace,
        ),
      )
      samples++
    }
  expect(samples).toBeGreaterThan(0)
  expect(samples).toBeLessThan(tile * tile)
  return mean
    .multiplyScalar(1 / samples)
    .multiply(new Color(scale[0]!, scale[1]!, scale[2]!))
    .convertLinearToSRGB()
}

async function withUsdzFixture(
  trees: TreeNode[],
  besideBuilding: boolean,
  run: (root: Group, groups: Group[], nodes: Record<string, TreeNode>) => Promise<void>,
) {
  const dom = {
    document: { createElement: () => new PixelCanvas() },
    HTMLCanvasElement: PixelCanvas,
    FileReader: BlobReader,
  }
  const descriptors = Object.getOwnPropertyDescriptors(globalThis)
  const groups = trees.map((tree) => buildTreeGeometry(tree))
  const root = new Group()
  for (const group of groups) root.add(group)
  const building = new Mesh(
    new BoxGeometry(6, 3, 0.2),
    new MeshStandardMaterial({ color: '#d0c5b5' }),
  )
  building.name = 'building-wall'
  building.position.set(8, 1.5, 0)
  if (besideBuilding) root.add(building)
  const nodes = Object.fromEntries(trees.map((tree) => [tree.id, tree]))
  const restoreRegistry = nodeRegistry._snapshot()
  try {
    nodeRegistry._reset()
    registerNode(treeRenderDefinition)
    for (const [index, tree] of trees.entries()) sceneRegistry.nodes.set(tree.id, groups[index]!)
    Object.assign(globalThis, dom)
    await run(root, groups, nodes)
  } finally {
    for (const tree of trees) sceneRegistry.nodes.delete(tree.id)
    restoreRegistry()
    for (const group of groups) disposeTreeResources(group)
    building.geometry.dispose()
    building.material.dispose()
    for (const key of Object.keys(dom)) {
      if (descriptors[key]) Object.defineProperty(globalThis, key, descriptors[key]!)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
}

for (const form of ['round', 'spreading', 'upright', 'conifer', 'weeping', 'multistem'] as const) {
  for (const density of [0, 0.85]) {
    for (const besideBuilding of [false, true]) {
      test(`a ${form} tree at density ${density} exports to USDZ ${besideBuilding ? 'beside a building' : 'alone'}`, async () => {
        const tree = TreeNode.parse({ form, seed: 19, density })
        await withUsdzFixture([tree], besideBuilding, async (root, groups, nodes) => {
          const source = groups[0]!.children[0] as Mesh
          const geometry = source.geometry
          const material = source.material as MeshStandardMaterial
          const atlas = material.map!.image
          const warnings: string[] = []
          const { files, layers, model } = parseUsdz(
            await exportSceneToUsdz(root, nodes, {
              onWarning: (warning) => warnings.push(warning),
            }),
          )
          const treePath = Object.keys(model).find((path) => path.endsWith('/treenear'))!
          expect(treePath).toBeDefined()
          expect(Object.keys(model).some((path) => path.endsWith('/buildingwall'))).toBe(
            besideBuilding,
          )
          const reference = model[treePath]!.fields.references![0]!.match(/@\.\/([^@]+)@/)![1]!
          const mesh = layers.get(reference)!
          const points = mesh['/Geometry/Geometry.points']!.fields.default as number[]
          const indices = mesh['/Geometry/Geometry.faceVertexIndices']!.fields.default as number[]
          const uv = mesh['/Geometry/Geometry.primvars:st']!.fields.default as number[]
          expect(points.length).toBeGreaterThan(0)
          expect(points.every(Number.isFinite)).toBe(true)
          expect(indices.length % 3).toBe(0)
          expect(indices.every((index) => index >= 0 && index < points.length / 3)).toBe(true)
          expect(uv.length).toBe((points.length / 3) * 2)

          const binding = model[`${treePath}.material:binding`]!.fields.targetPaths![0]!
          const diffuse =
            model[`${binding}/PreviewSurface.inputs:diffuseColor`]!.fields.connectionPaths![0]!
          const texturePath = diffuse.replace(/\.outputs:rgb$/, '')
          expect(model[`${binding}/PreviewSurface.inputs:opacity`]!.fields.connectionPaths).toEqual(
            [`${texturePath}.outputs:a`],
          )
          const cutoff = model[`${binding}/PreviewSurface.inputs:opacityThreshold`]!.fields
            .default as number
          expect(cutoff).toBeCloseTo(material.alphaTest)
          const scale = model[`${texturePath}.inputs:scale`]!.fields.default as number[]
          expect(scale[3]).toBeCloseTo(material.opacity)
          const imageName = model[`${texturePath}.inputs:file`]!.fields.default as string
          const image = decodePng(files[imageName]!)
          expect([image.width, image.height]).toEqual([atlas.width, atlas.height])
          let gaps = 0
          let leaves = 0
          for (let i = 3; i < image.pixels.length; i += 4) {
            if (image.pixels[i]! >= cutoff * 255) leaves++
            else gaps++
            if (image.pixels[i]! >= cutoff * 255 !== atlas.data[i] >= cutoff * 255)
              throw new Error(`Changed atlas cutout at texel ${(i - 3) / 4}`)
          }
          expect(gaps).toBeGreaterThan(0)
          expect(leaves).toBeGreaterThan(0)
          if (density > 0) {
            expect(uv.some((value, index) => index % 2 === 0 && value < 0.25)).toBe(true)
            const tint = new Color(scale[0]!, scale[1]!, scale[2]!).convertLinearToSRGB()
            const foliage = new Color(tree.foliage).convertLinearToSRGB()
            for (const channel of ['r', 'g', 'b'] as const)
              expect(Math.abs(tint[channel] - foliage[channel])).toBeLessThan(0.16)
            expect(tint.g).toBeGreaterThan(tint.r)
            expect(tint.g).toBeGreaterThan(tint.b)
            const row =
              form === 'conifer'
                ? 3
                : form === 'weeping'
                  ? 2
                  : form === 'upright' || form === 'multistem'
                    ? 1
                    : 0
            const exported = leafColor(image, row, scale, cutoff)
            for (const channel of ['r', 'g', 'b'] as const)
              expect(Math.abs(exported[channel] - foliage[channel])).toBeLessThan(0.2)
          }
          expect(warnings).toHaveLength(1)
          expect(warnings[0]).toMatch(/tree foliage.*simplified.*USDZ/i)
          expect(source.geometry).toBe(geometry)
          expect(source.material).toBe(material)
          expect(material.vertexColors).toBe(true)
          expect(material.color.getHex()).toBe(0xffffff)
          expect(material.map!.image).toBe(atlas)
          expect(geometry.hasAttribute('color')).toBe(true)
        })
      })
    }
  }
}

test('an ordinary building USDZ has no foliage simplification warning', async () => {
  await withUsdzFixture([], true, async (root, _groups, nodes) => {
    const warnings: string[] = []
    const { model } = parseUsdz(
      await exportSceneToUsdz(root, nodes, { onWarning: (warning) => warnings.push(warning) }),
    )
    expect(Object.keys(model).some((path) => path.endsWith('/buildingwall'))).toBe(true)
    expect(warnings).toEqual([])
  })
})

test('USDZ keeps an autumn foliage colour and warns once for several trees', async () => {
  const trees = [
    TreeNode.parse({ foliage: '#d18b32', seed: 19 }),
    TreeNode.parse({ foliage: '#d18b32', form: 'weeping', seed: 41, position: [8, 0, 0] }),
  ]
  await withUsdzFixture(trees, true, async (root, _groups, nodes) => {
    const warnings: string[] = []
    const { model } = parseUsdz(
      await exportSceneToUsdz(root, nodes, { onWarning: (warning) => warnings.push(warning) }),
    )
    const scales = Object.entries(model)
      .filter(([path]) => /\/Texture_\w+_diffuse\.inputs:scale$/.test(path))
      .map(([, spec]) => spec.fields.default as number[])
    expect(scales).toHaveLength(2)
    const foliage = new Color(trees[0]!.foliage).convertLinearToSRGB()
    for (const scale of scales) {
      const tint = new Color(scale[0]!, scale[1]!, scale[2]!).convertLinearToSRGB()
      for (const channel of ['r', 'g', 'b'] as const)
        expect(Math.abs(tint[channel] - foliage[channel])).toBeLessThan(0.16)
      expect(tint.r).toBeGreaterThan(tint.g)
      expect(tint.g).toBeGreaterThan(tint.b)
    }
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/tree foliage.*simplified.*USDZ/i)
  })
})

function mappedTriangles(colors: BufferAttribute, grouped = false) {
  const geometry = new BufferGeometry()
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 2, 0, 0, 3, 0, 0, 2, 1, 0], 3),
  )
  geometry.setAttribute('uv', new Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 2))
  geometry.setAttribute('color', colors)
  geometry.setIndex([0, 1, 2, 3, 4, 5])
  geometry.computeVertexNormals()
  if (grouped) {
    geometry.addGroup(0, 3, 0)
    geometry.addGroup(3, 3, 1)
  }
  const map = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)
  map.colorSpace = SRGBColorSpace
  const material = new MeshStandardMaterial({
    map,
    vertexColors: true,
    color: new Color(0.5, 0.5, 0.5),
    opacity: 0.8,
    alphaTest: 0.4,
  })
  return new Mesh(geometry, grouped ? [material, material] : material)
}

test('USDZ reduces generic mapped RGBA tints per material group, not by node kind', async () => {
  await withUsdzFixture([], false, async (root, _groups, nodes) => {
    const mesh = mappedTriangles(
      new BufferAttribute(
        new Uint8Array([
          255, 0, 0, 64, 204, 0, 0, 128, 153, 0, 0, 192, 0, 255, 0, 64, 0, 204, 0, 128, 0, 153, 0,
          192,
        ]),
        4,
        true,
      ),
      true,
    )
    root.add(mesh)
    try {
      const warnings: string[] = []
      const { model } = parseUsdz(
        await exportSceneToUsdz(root, nodes, { onWarning: (warning) => warnings.push(warning) }),
      )
      const scales = Object.entries(model)
        .filter(([path]) => /\/Texture_\w+_diffuse\.inputs:scale$/.test(path))
        .map(([, spec]) => spec.fields.default as number[])
      expect(scales).toHaveLength(2)
      for (const [index, scale] of scales.entries()) {
        expect(scale[index]).toBeGreaterThan(0.25)
        expect(scale[index]).toBeLessThan(0.55)
        expect(scale[1 - index]).toBe(0)
        expect(scale[2]).toBe(0)
        expect(scale[3]).toBeGreaterThan(0.2)
        expect(scale[3]).toBeLessThan(0.6)
      }
      const thresholds = Object.entries(model)
        .filter(([path]) => path.endsWith('.inputs:opacityThreshold'))
        .map(([, spec]) => spec.fields.default)
      expect(thresholds).toEqual([0.4, 0.4])
      expect(warnings).toHaveLength(1)
    } finally {
      mesh.geometry.dispose()
      const material = (mesh.material as MeshStandardMaterial[])[0]!
      material.map!.dispose()
      material.dispose()
    }
  })
})

test('a constant mapped vertex tint reaches USDZ without a simplification warning', async () => {
  await withUsdzFixture([], false, async (root, _groups, nodes) => {
    const mesh = mappedTriangles(
      new Float32BufferAttribute(Array.from({ length: 6 }, () => [1, 0.5, 0.25]).flat(), 3),
    )
    root.add(mesh)
    try {
      const warnings: string[] = []
      const { model } = parseUsdz(
        await exportSceneToUsdz(root, nodes, { onWarning: (warning) => warnings.push(warning) }),
      )
      const scale = Object.entries(model).find(([path]) =>
        /\/Texture_\w+_diffuse\.inputs:scale$/.test(path),
      )![1].fields.default as number[]
      expect(scale).toEqual([0.5, 0.25, 0.125, 0.8])
      expect(warnings).toEqual([])
    } finally {
      mesh.geometry.dispose()
      const material = mesh.material as MeshStandardMaterial
      material.map!.dispose()
      material.dispose()
    }
  })
})

for (const surface of ['map without vertex tints', 'vertex tints without a map'] as const) {
  test(`USDZ keeps ${surface} without a simplification warning`, async () => {
    await withUsdzFixture([], false, async (root, _groups, nodes) => {
      const mesh = mappedTriangles(
        new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0, 1], 3),
      )
      const material = mesh.material as MeshStandardMaterial
      const sourceMap = material.map!
      if (surface === 'map without vertex tints') material.vertexColors = false
      else material.map = null
      root.add(mesh)
      try {
        const warnings: string[] = []
        const { files, model } = parseUsdz(
          await exportSceneToUsdz(root, nodes, { onWarning: (warning) => warnings.push(warning) }),
        )
        const imageName = Object.values(model).find((spec) => spec.fields.typeName === 'asset')!
          .fields.default as string
        const image = decodePng(files[imageName]!)
        if (surface === 'map without vertex tints') {
          expect([image.width, image.height]).toEqual([1, 1])
          const scale = Object.entries(model).find(([path]) =>
            /\/Texture_\w+_diffuse\.inputs:scale$/.test(path),
          )![1].fields.default as number[]
          expect(scale).toEqual([0.5, 0.5, 0.5, 0.8])
        } else {
          for (let channel = 0; channel < 3; channel++) {
            const others = [0, 1, 2].filter((value) => value !== channel)
            let found = false
            for (let i = 0; i < image.pixels.length; i += 4)
              if (
                image.pixels[i + channel]! > 200 &&
                others.every((other) => image.pixels[i + other]! < 20)
              )
                found = true
            expect(found).toBe(true)
          }
        }
        expect(warnings).toEqual([])
      } finally {
        mesh.geometry.dispose()
        sourceMap.dispose()
        material.dispose()
      }
    })
  })
}

test('USDZ preparation leaves subsequent tree downloads and viewer bakes with native GLB tints', async () => {
  await withUsdzFixture([TreeNode.parse({ seed: 19 })], false, async (root, _groups, nodes) => {
    await exportSceneToUsdz(root, nodes)
    for (const [purpose, textures] of [
      ['portable', 'embed'],
      ['viewer', 'reference'],
    ] as const) {
      const warnings: string[] = []
      const glb = Buffer.from(
        await exportSceneToGlb(root, nodes, {
          purpose,
          textures,
          onWarning: (warning) => warnings.push(warning),
        }),
      )
      const end = 20 + glb.readUInt32LE(12)
      const doc = JSON.parse(glb.toString('utf8', 20, end))
      const primitive = doc.meshes[0].primitives[0]
      expect(primitive.attributes.COLOR_0).toBeDefined()
      expect(primitive.attributes.TEXCOORD_0).toBeDefined()
      const material = doc.materials[primitive.material]
      expect(material.alphaMode).toBe('MASK')
      expect(material.alphaCutoff).toBeCloseTo(0.29)
      expect(material.doubleSided).toBe(true)
      expect(material.pbrMetallicRoughness.baseColorTexture).toBeDefined()
      expect(warnings).toEqual([])
    }
  })
})
