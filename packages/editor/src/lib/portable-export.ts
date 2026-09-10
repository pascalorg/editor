import * as THREE from 'three'
import { StaticGeometryGenerator } from 'three-mesh-bvh'

const VERTEX_COLOR_UV_CHANNEL = 0
const VERTEX_COLOR_TILE_SIZE = 8
const MAX_VERTEX_COLOR_ATLAS_SIZE = 2048

const MATERIAL_TEXTURE_SLOTS = [
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'aoMap',
  'emissiveMap',
  'alphaMap',
  'lightMap',
  'bumpMap',
  'displacementMap',
  'clearcoatMap',
  'clearcoatNormalMap',
  'clearcoatRoughnessMap',
  'iridescenceMap',
  'iridescenceThicknessMap',
  'transmissionMap',
  'thicknessMap',
  'specularIntensityMap',
  'specularColorMap',
  'sheenRoughnessMap',
  'sheenColorMap',
  'anisotropyMap',
] as const

type TexturedMaterial = THREE.Material & Record<string, unknown>
type DisposableResource = THREE.BufferGeometry | THREE.Material | THREE.Texture

function uvAttributeName(channel: number): string {
  return channel === 0 ? 'uv' : `uv${channel}`
}

const discardedResources = new WeakMap<THREE.Object3D, Set<DisposableResource>>()

function rememberDiscarded(root: THREE.Object3D, resource: DisposableResource): void {
  let resources = discardedResources.get(root)
  if (!resources) {
    resources = new Set()
    discardedResources.set(root, resources)
  }
  resources.add(resource)
}

function materialsOf(mesh: THREE.Mesh): THREE.Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material]
}

function copyObjectState(source: THREE.Object3D, target: THREE.Object3D): void {
  target.name = source.name
  target.up.copy(source.up)
  target.position.copy(source.position)
  target.quaternion.copy(source.quaternion)
  target.scale.copy(source.scale)
  target.matrix.copy(source.matrix)
  target.matrixAutoUpdate = source.matrixAutoUpdate
  target.visible = source.visible
  target.layers.mask = source.layers.mask
  target.renderOrder = source.renderOrder
  target.frustumCulled = source.frustumCulled
  target.userData = structuredClone(source.userData)
}

function replaceObject(source: THREE.Object3D, replacement: THREE.Object3D): void {
  const parent = source.parent
  if (!parent) throw new Error(`Cannot replace detached export object "${source.name}"`)
  const index = parent.children.indexOf(source)
  parent.remove(source)
  parent.add(replacement)
  const appended = parent.children.indexOf(replacement)
  parent.children.splice(appended, 1)
  parent.children.splice(index, 0, replacement)
}

function tintMaterial(material: THREE.Material, tint: THREE.Color | null): THREE.Material {
  if (!tint) return material
  const clone = material.clone() as TexturedMaterial
  const color = clone.color
  if (!(color instanceof THREE.Color)) {
    throw new Error(`Instance-colored material "${material.name}" has no portable color factor`)
  }
  color.multiply(tint)
  return clone
}

function tintMaterials(
  material: THREE.Material | THREE.Material[],
  tint: THREE.Color | null,
): THREE.Material | THREE.Material[] {
  return Array.isArray(material)
    ? material.map((entry) => tintMaterial(entry, tint))
    : tintMaterial(material, tint)
}
type InstancedGeometryAttribute = [string, THREE.InstancedBufferAttribute]

function geometryForInstance(
  source: THREE.BufferGeometry,
  instancedAttributes: readonly InstancedGeometryAttribute[],
  instanceIndex: number,
): THREE.BufferGeometry {
  if (instancedAttributes.length === 0) return source

  const vertexCount = source.getAttribute('position')?.count
  if (vertexCount === undefined) {
    throw new Error('Instanced geometry has no position attribute')
  }
  const geometry = source.clone()
  for (const [name, attribute] of instancedAttributes) {
    const valueIndex = Math.floor(instanceIndex / attribute.meshPerAttribute)
    if (valueIndex >= attribute.count) {
      geometry.dispose()
      throw new Error(`Instanced attribute "${name}" has no value for instance ${instanceIndex}`)
    }
    const ArrayType = attribute.array.constructor as new (length: number) => typeof attribute.array
    const values = new ArrayType(vertexCount * attribute.itemSize)
    const sourceOffset = valueIndex * attribute.itemSize
    for (let vertex = 0; vertex < vertexCount; vertex++) {
      const targetOffset = vertex * attribute.itemSize
      for (let component = 0; component < attribute.itemSize; component++) {
        values[targetOffset + component] = attribute.array[sourceOffset + component]!
      }
    }
    const resolved = new THREE.BufferAttribute(values, attribute.itemSize, attribute.normalized)
    resolved.name = attribute.name
    resolved.setUsage(attribute.usage)
    resolved.gpuType = attribute.gpuType
    geometry.setAttribute(name, resolved)
  }
  return geometry
}

/** Replace every InstancedMesh with ordinary meshes in the same local hierarchy. */
export function expandInstancedMeshes(root: THREE.Object3D): void {
  const instances: THREE.InstancedMesh[] = []
  root.traverse((object) => {
    if ((object as THREE.InstancedMesh).isInstancedMesh) {
      instances.push(object as THREE.InstancedMesh)
    }
  })

  const matrix = new THREE.Matrix4()
  const tint = new THREE.Color()
  for (const source of instances) {
    const wrapper = new THREE.Group()
    copyObjectState(source, wrapper)
    const instancedAttributes = Object.entries(source.geometry.attributes).filter(
      ([, attribute]) => (attribute as THREE.InstancedBufferAttribute).isInstancedBufferAttribute,
    ) as InstancedGeometryAttribute[]

    for (let index = 0; index < source.count; index++) {
      const color = source.instanceColor ? source.getColorAt(index, tint).clone() : null
      const geometry = geometryForInstance(source.geometry, instancedAttributes, index)
      const mesh = new THREE.Mesh(geometry, tintMaterials(source.material, color))
      mesh.name = source.name ? `${source.name}_${index + 1}` : `instance_${index + 1}`
      mesh.castShadow = source.castShadow
      mesh.receiveShadow = source.receiveShadow
      mesh.frustumCulled = source.frustumCulled
      source.getMatrixAt(index, matrix)
      matrix.decompose(mesh.position, mesh.quaternion, mesh.scale)

      if (source.morphTexture) {
        source.getMorphAt(index, mesh)
      }
      wrapper.add(mesh)
    }
    if (instancedAttributes.length > 0) rememberDiscarded(root, source.geometry)

    for (const child of [...source.children]) wrapper.add(child)
    replaceObject(source, wrapper)
  }
}

function bakeDeformedGeometry(mesh: THREE.Mesh): THREE.BufferGeometry {
  const geometry = mesh.geometry
  const generator = new StaticGeometryGenerator(mesh)
  generator.applyWorldTransforms = false
  generator.useGroups = false
  generator.attributes = Object.keys(geometry.attributes).filter(
    (name) => name !== 'skinIndex' && name !== 'skinWeight',
  )

  const savedMatrixWorld = mesh.matrixWorld.clone()
  mesh.matrixWorld.identity()
  try {
    const baked = generator.generate()
    baked.groups = geometry.groups.map((group) => ({ ...group }))
    baked.setDrawRange(geometry.drawRange.start, geometry.drawRange.count)
    return baked
  } finally {
    mesh.matrixWorld.copy(savedMatrixWorld)
  }
}

/** Freeze current morph and skin deformation into ordinary vertex buffers. */
export function freezeDeformedMeshes(root: THREE.Object3D): void {
  const meshes: THREE.Mesh[] = []
  root.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) meshes.push(object as THREE.Mesh)
  })

  for (const mesh of meshes) {
    const skinnedMesh = mesh as THREE.SkinnedMesh
    const hasMorphTargets = Object.values(mesh.geometry.morphAttributes).some(
      (attributes) => attributes.length > 0,
    )
    if (!(skinnedMesh.isSkinnedMesh || hasMorphTargets)) continue

    const originalGeometry = mesh.geometry
    mesh.geometry = bakeDeformedGeometry(mesh)
    mesh.geometry.morphAttributes = {}
    mesh.morphTargetDictionary = undefined
    mesh.morphTargetInfluences = undefined
    if (skinnedMesh.isSkinnedMesh) {
      const ordinaryMesh = mesh as unknown as { isSkinnedMesh: boolean }
      ordinaryMesh.isSkinnedMesh = false
    }
    rememberDiscarded(root, originalGeometry)
  }
}

function canvas2d(
  width: number,
  height: number,
): {
  canvas: HTMLCanvasElement
  context: CanvasRenderingContext2D
} {
  if (typeof document === 'undefined') {
    throw new Error('Portable texture baking requires a browser canvas')
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Portable texture baking could not create a 2D canvas')
  return { canvas, context }
}

function srgbByte(linear: number): number {
  const value = Math.max(0, Math.min(1, linear))
  const encoded = value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055
  return Math.round(encoded * 255)
}

function colorComponent(
  attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  index: number,
  component: number,
): number {
  if (component === 0) return attribute.getX(index)
  if (component === 1) return attribute.getY(index)
  if (component === 2) return attribute.getZ(index)
  return attribute.itemSize >= 4 ? attribute.getW(index) : 1
}

function buildVertexColorAtlas(
  geometry: THREE.BufferGeometry,
  materials: readonly THREE.Material[],
  relocatedUvChannel?: number,
): {
  geometry: THREE.BufferGeometry
  texture: THREE.CanvasTexture
  hasAlpha: boolean
  clampedHdr: boolean
} {
  const expanded = geometry.index ? geometry.toNonIndexed() : geometry.clone()
  if (relocatedUvChannel !== undefined) {
    const sourceUv = expanded.getAttribute('uv')
    if (!sourceUv) {
      expanded.dispose()
      throw new Error('Textured vertex-color geometry has no UV coordinates to preserve')
    }
    expanded.setAttribute(uvAttributeName(relocatedUvChannel), sourceUv.clone())
  }
  const color = expanded.getAttribute('color')
  const position = expanded.getAttribute('position')
  if (!color || !position || position.count === 0 || position.count % 3 !== 0) {
    expanded.dispose()
    throw new Error('Vertex-color baking requires triangle geometry with a color attribute')
  }

  const faceCount = position.count / 3
  const tilesPerRow = Math.ceil(Math.sqrt(faceCount))
  const atlasSize = THREE.MathUtils.ceilPowerOfTwo(tilesPerRow * VERTEX_COLOR_TILE_SIZE)
  if (atlasSize > MAX_VERTEX_COLOR_ATLAS_SIZE) {
    expanded.dispose()
    throw new Error(
      `Vertex-color atlas requires ${atlasSize}px, exceeding the ${MAX_VERTEX_COLOR_ATLAS_SIZE}px export limit`,
    )
  }

  const { canvas, context } = canvas2d(atlasSize, atlasSize)
  const image = context.createImageData(atlasSize, atlasSize)

  const uv = new Float32Array(position.count * 2)
  let hasAlpha = false
  let clampedHdr = false
  for (let index = 0; index < color.count && !clampedHdr; index++) {
    const triangleOffset = index - (index % 3)
    const materialIndex = materialIndexForTriangle(expanded, triangleOffset)
    if (!materials[materialIndex]?.vertexColors) continue
    const red = colorComponent(color, index, 0)
    const green = colorComponent(color, index, 1)
    const blue = colorComponent(color, index, 2)
    clampedHdr = red < 0 || red > 1 || green < 0 || green > 1 || blue < 0 || blue > 1
  }

  for (let face = 0; face < faceCount; face++) {
    const tileX = (face % tilesPerRow) * VERTEX_COLOR_TILE_SIZE
    const tileY = Math.floor(face / tilesPerRow) * VERTEX_COLOR_TILE_SIZE
    const vertices = [face * 3, face * 3 + 1, face * 3 + 2]
    const colors = vertices.map((vertex) => [
      colorComponent(color, vertex, 0),
      colorComponent(color, vertex, 1),
      colorComponent(color, vertex, 2),
      colorComponent(color, vertex, 3),
    ])
    if (
      materials[materialIndexForTriangle(expanded, face * 3)]?.vertexColors &&
      colors.some((entry) => entry[3]! < 1)
    ) {
      hasAlpha = true
    }

    const inset = 0.5
    const span = VERTEX_COLOR_TILE_SIZE - 1
    const atlasUvs = [
      [tileX + inset, tileY + inset],
      [tileX + inset + span, tileY + inset],
      [tileX + inset, tileY + inset + span],
    ]
    for (let corner = 0; corner < 3; corner++) {
      uv[(face * 3 + corner) * 2] = atlasUvs[corner]![0]! / atlasSize
      uv[(face * 3 + corner) * 2 + 1] = 1 - atlasUvs[corner]![1]! / atlasSize
    }

    for (let y = 0; y < VERTEX_COLOR_TILE_SIZE; y++) {
      for (let x = 0; x < VERTEX_COLOR_TILE_SIZE; x++) {
        let b = x / span
        let c = y / span
        if (b + c > 1) {
          const sum = b + c
          b /= sum
          c /= sum
        }
        const a = 1 - b - c
        const pixel = ((tileY + y) * atlasSize + tileX + x) * 4
        image.data[pixel] = srgbByte(colors[0]![0]! * a + colors[1]![0]! * b + colors[2]![0]! * c)
        image.data[pixel + 1] = srgbByte(
          colors[0]![1]! * a + colors[1]![1]! * b + colors[2]![1]! * c,
        )
        image.data[pixel + 2] = srgbByte(
          colors[0]![2]! * a + colors[1]![2]! * b + colors[2]![2]! * c,
        )
        image.data[pixel + 3] = Math.round(
          255 *
            Math.max(0, Math.min(1, colors[0]![3]! * a + colors[1]![3]! * b + colors[2]![3]! * c)),
        )
      }
    }
  }
  // Dilate each row's terminal tile through all unused power-of-two cells.
  // Importers may generate their own mip chain (USDZ in particular), so sampler
  // flags cannot prevent transparent-black padding from bleeding into Grass.
  for (let y = 0; y < atlasSize; y++) {
    const tileRow = Math.floor(y / VERTEX_COLOR_TILE_SIZE)
    for (let x = 0; x < atlasSize; x++) {
      const tileColumn = Math.floor(x / VERTEX_COLOR_TILE_SIZE)
      const tileIndex = tileRow * tilesPerRow + tileColumn
      if (tileColumn < tilesPerRow && tileIndex < faceCount) continue
      const sourceFace =
        tileRow * tilesPerRow < faceCount
          ? Math.min((tileRow + 1) * tilesPerRow - 1, faceCount - 1)
          : faceCount - 1
      const sourceX =
        (sourceFace % tilesPerRow) * VERTEX_COLOR_TILE_SIZE + (x % VERTEX_COLOR_TILE_SIZE)
      const sourceY =
        Math.floor(sourceFace / tilesPerRow) * VERTEX_COLOR_TILE_SIZE + (y % VERTEX_COLOR_TILE_SIZE)
      const sourcePixel = (sourceY * atlasSize + sourceX) * 4
      const targetPixel = (y * atlasSize + x) * 4
      image.data[targetPixel] = image.data[sourcePixel]!
      image.data[targetPixel + 1] = image.data[sourcePixel + 1]!
      image.data[targetPixel + 2] = image.data[sourcePixel + 2]!
      image.data[targetPixel + 3] = image.data[sourcePixel + 3]!
    }
  }

  context.putImageData(image, 0, 0)
  expanded.setAttribute(uvAttributeName(VERTEX_COLOR_UV_CHANNEL), new THREE.BufferAttribute(uv, 2))
  expanded.deleteAttribute('color')
  const texture = new THREE.CanvasTexture(canvas)
  texture.name = 'pascal_vertex_color_atlas'
  texture.channel = VERTEX_COLOR_UV_CHANNEL
  texture.colorSpace = THREE.SRGBColorSpace
  texture.flipY = true
  texture.needsUpdate = true
  return { geometry: expanded, texture, hasAlpha, clampedHdr }
}
function hasDeformedGeometry(mesh: THREE.Mesh): boolean {
  const skinnedMesh = mesh as THREE.SkinnedMesh
  return (
    skinnedMesh.isSkinnedMesh ||
    Object.values(mesh.geometry.morphAttributes).some((attributes) => attributes.length > 0)
  )
}

function bakeVertexColors(root: THREE.Object3D, preserveDeformations = false): boolean {
  const meshes: THREE.Mesh[] = []
  root.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) meshes.push(object as THREE.Mesh)
  })
  let clampedHdr = false

  for (const mesh of meshes) {
    if (preserveDeformations && hasDeformedGeometry(mesh)) continue
    const color = mesh.geometry.getAttribute('color')
    if (!color) continue
    const materials = materialsOf(mesh)
    if (!materials.some((material) => material.vertexColors)) {
      const originalGeometry = mesh.geometry
      mesh.geometry = originalGeometry.clone()
      mesh.geometry.deleteAttribute('color')
      rememberDiscarded(root, originalGeometry)
      continue
    }
    const occupiedUvChannels = new Set<number>()
    for (let channel = 1; channel <= 3; channel++) {
      if (mesh.geometry.getAttribute(uvAttributeName(channel))) occupiedUvChannels.add(channel)
    }
    const channelZeroTextures = new Set<THREE.Texture>()
    for (const material of materials) {
      const textured = material as TexturedMaterial
      if (material.vertexColors && textured.map instanceof THREE.Texture) {
        throw new Error(
          `Material "${material.name}" combines a diffuse map with varying vertex colors; portable atlas composition is unavailable`,
        )
      }
      for (const slot of MATERIAL_TEXTURE_SLOTS) {
        const texture = textured[slot]
        if (!(texture instanceof THREE.Texture)) continue
        if (texture.channel === 0) channelZeroTextures.add(texture)
        else occupiedUvChannels.add(texture.channel)
      }
    }

    const relocatedUvChannel =
      channelZeroTextures.size === 0
        ? undefined
        : [1, 2, 3].find((channel) => !occupiedUvChannels.has(channel))
    if (channelZeroTextures.size > 0 && relocatedUvChannel === undefined) {
      throw new Error(
        `Vertex-color geometry "${mesh.name}" has no free portable UV channel for its PBR maps`,
      )
    }

    const originalGeometry = mesh.geometry
    const baked = buildVertexColorAtlas(originalGeometry, materials, relocatedUvChannel)
    mesh.geometry = baked.geometry
    if (baked.clampedHdr) mesh.userData.pascalHdrVertexColor = 'clamped-to-portable-range'
    clampedHdr ||= baked.clampedHdr
    const relocatedTextures = new Map<THREE.Texture, THREE.Texture>()
    const convertedMaterials = new Map<THREE.Material, THREE.Material>()
    const converted = materials.map((material) => {
      const cached = convertedMaterials.get(material)
      if (cached) return cached
      if (!material.vertexColors && relocatedUvChannel === undefined) return material
      const clone = material.clone() as TexturedMaterial
      if (relocatedUvChannel !== undefined) {
        for (const slot of MATERIAL_TEXTURE_SLOTS) {
          const sourceTexture = clone[slot]
          if (!(sourceTexture instanceof THREE.Texture) || sourceTexture.channel !== 0) continue
          let relocatedTexture = relocatedTextures.get(sourceTexture)
          if (!relocatedTexture) {
            relocatedTexture = sourceTexture.clone()
            relocatedTexture.channel = relocatedUvChannel
            relocatedTexture.needsUpdate = true
            relocatedTextures.set(sourceTexture, relocatedTexture)
            rememberDiscarded(root, sourceTexture)
          }
          clone[slot] = relocatedTexture
        }
      }
      if (material.vertexColors) {
        clone.vertexColors = false
        clone.map = baked.texture
        if (baked.hasAlpha) clone.transparent = true
      }
      convertedMaterials.set(material, clone)
      return clone
    })
    mesh.material = Array.isArray(mesh.material) ? converted : converted[0]!
    rememberDiscarded(root, originalGeometry)
    for (const material of materials) rememberDiscarded(root, material)
  }
  return clampedHdr
}

function sourcePixels(texture: THREE.Texture): {
  width: number
  height: number
  data: Uint8ClampedArray
} {
  const image = texture.image as {
    width?: number
    height?: number
    data?: ArrayLike<number>
  } | null
  const width = image?.width
  const height = image?.height
  if (!(width && height)) throw new Error(`Texture "${texture.name}" has no readable dimensions`)

  if (image?.data) {
    if (
      !(image.data instanceof Uint8Array || image.data instanceof Uint8ClampedArray) ||
      image.data.length !== width * height * 4
    ) {
      throw new Error(`Texture "${texture.name}" is not an 8-bit RGBA texture`)
    }
    return { width, height, data: Uint8ClampedArray.from(image.data) }
  }

  const { context } = canvas2d(width, height)
  try {
    context.drawImage(texture.image as CanvasImageSource, 0, 0, width, height)
  } catch {
    throw new Error(`Texture "${texture.name}" cannot be read for portable export`)
  }
  return { width, height, data: context.getImageData(0, 0, width, height).data }
}

function cloneTextureSettings(source: THREE.Texture, target: THREE.Texture): void {
  target.name = source.name
  target.mapping = source.mapping
  target.channel = source.channel
  target.wrapS = source.wrapS
  target.wrapT = source.wrapT
  target.magFilter = source.magFilter
  target.minFilter = source.minFilter
  target.anisotropy = source.anisotropy
  target.offset.copy(source.offset)
  target.repeat.copy(source.repeat)
  target.center.copy(source.center)
  target.rotation = source.rotation
  target.matrixAutoUpdate = source.matrixAutoUpdate
  target.matrix.copy(source.matrix)
  target.generateMipmaps = source.generateMipmaps
  target.premultiplyAlpha = source.premultiplyAlpha
  target.flipY = source.flipY
  target.unpackAlignment = source.unpackAlignment
  target.colorSpace = THREE.NoColorSpace
  target.userData = structuredClone(source.userData)
  target.needsUpdate = true
}
function materializeDataTextures(root: THREE.Object3D): void {
  const converted = new Map<THREE.Texture, THREE.CanvasTexture>()
  root.traverse((object) => {
    if (!(object as THREE.Mesh).isMesh) return
    for (const material of materialsOf(object as THREE.Mesh)) {
      const textured = material as TexturedMaterial
      for (const slot of MATERIAL_TEXTURE_SLOTS) {
        const source = textured[slot]
        if (!(source instanceof THREE.Texture) || !(source as THREE.DataTexture).isDataTexture)
          continue
        let texture = converted.get(source)
        if (!texture) {
          if (source.format !== THREE.RGBAFormat || source.type !== THREE.UnsignedByteType) {
            throw new Error(`Data texture "${source.name}" is not portable 8-bit RGBA`)
          }
          const pixels = sourcePixels(source)
          const { canvas, context } = canvas2d(pixels.width, pixels.height)
          const image = context.createImageData(pixels.width, pixels.height)
          image.data.set(pixels.data)
          context.putImageData(image, 0, 0)
          texture = new THREE.CanvasTexture(canvas)
          cloneTextureSettings(source, texture)
          texture.colorSpace = source.colorSpace
          converted.set(source, texture)
          rememberDiscarded(root, source)
        }
        textured[slot] = texture
      }
    }
  })
}

function canonicalizeAlphaMaps(root: THREE.Object3D): void {
  const materials = new Set<THREE.Material>()
  root.traverse((object) => {
    if (!(object as THREE.Mesh).isMesh) return
    for (const material of materialsOf(object as THREE.Mesh)) materials.add(material)
  })

  for (const material of materials) {
    const standard = material as THREE.MeshStandardMaterial
    if (!standard.alphaMap) continue
    const alphaMap = standard.alphaMap
    const map = standard.map
    alphaMap.updateMatrix()
    map?.updateMatrix()
    if (
      map &&
      (map.channel !== alphaMap.channel ||
        map.flipY !== alphaMap.flipY ||
        !map.matrix.equals(alphaMap.matrix))
    ) {
      throw new Error(
        `Material "${material.name}" uses incompatible diffuse and alpha texture coordinates`,
      )
    }

    const alpha = sourcePixels(alphaMap)
    const color = map ? sourcePixels(map) : null
    if (color && (color.width !== alpha.width || color.height !== alpha.height)) {
      throw new Error(`Material "${material.name}" uses mismatched diffuse and alpha map sizes`)
    }
    const { canvas, context } = canvas2d(alpha.width, alpha.height)
    const output = context.createImageData(alpha.width, alpha.height)
    for (let index = 0; index < alpha.data.length; index += 4) {
      output.data[index] = color?.data[index] ?? 255
      output.data[index + 1] = color?.data[index + 1] ?? 255
      output.data[index + 2] = color?.data[index + 2] ?? 255
      output.data[index + 3] = Math.round(
        ((color?.data[index + 3] ?? 255) * alpha.data[index + 1]!) / 255,
      )
    }
    context.putImageData(output, 0, 0)
    const texture = new THREE.CanvasTexture(canvas)
    cloneTextureSettings(map ?? alphaMap, texture)
    texture.colorSpace = map?.colorSpace ?? THREE.SRGBColorSpace
    texture.name = map?.name || alphaMap.name
    standard.map = texture
    standard.alphaMap = null
    standard.transparent = true
    rememberDiscarded(root, alphaMap)
    if (map) rememberDiscarded(root, map)
  }
}

function canonicalNormalTexture(source: THREE.Texture, scale: THREE.Vector2): THREE.CanvasTexture {
  const compressed = source as THREE.CompressedTexture
  if (compressed.isCompressedTexture) {
    throw new Error(`Compressed normal map "${source.name}" must be baked before portable export`)
  }
  const pixels = sourcePixels(source)
  const { canvas, context } = canvas2d(pixels.width, pixels.height)
  const output = context.createImageData(pixels.width, pixels.height)
  for (let index = 0; index < pixels.data.length; index += 4) {
    let x = (pixels.data[index]! / 255) * 2 - 1
    let y = (pixels.data[index + 1]! / 255) * 2 - 1
    let z = (pixels.data[index + 2]! / 255) * 2 - 1
    x *= scale.x
    y *= scale.y
    const inverseLength = 1 / Math.max(Math.hypot(x, y, z), 1e-8)
    x *= inverseLength
    y *= inverseLength
    z *= inverseLength
    output.data[index] = Math.round((x * 0.5 + 0.5) * 255)
    output.data[index + 1] = Math.round((y * 0.5 + 0.5) * 255)
    output.data[index + 2] = Math.round((z * 0.5 + 0.5) * 255)
    output.data[index + 3] = pixels.data[index + 3]!
  }
  context.putImageData(output, 0, 0)
  const texture = new THREE.CanvasTexture(canvas)
  cloneTextureSettings(source, texture)
  return texture
}

function canonicalizeNormalMaps(root: THREE.Object3D): void {
  const materials = new Set<THREE.Material>()
  root.traverse((object) => {
    if (!(object as THREE.Mesh).isMesh) return
    for (const material of materialsOf(object as THREE.Mesh)) materials.add(material)
  })

  const cache = new Map<THREE.Texture, Map<string, THREE.CanvasTexture>>()
  for (const material of materials) {
    const standard = material as THREE.MeshStandardMaterial
    if (!standard.normalMap || !standard.normalScale) continue
    if (standard.normalScale.x === 1 && standard.normalScale.y === 1) continue
    const source = standard.normalMap
    const key = `${standard.normalScale.x}:${standard.normalScale.y}`
    let variants = cache.get(source)
    if (!variants) {
      variants = new Map()
      cache.set(source, variants)
    }
    let canonical = variants.get(key)
    if (!canonical) {
      canonical = canonicalNormalTexture(source, standard.normalScale)
      variants.set(key, canonical)
    }
    rememberDiscarded(root, source)
    standard.normalMap = canonical
    standard.normalScale.set(1, 1)
  }
}

function materialIndexForTriangle(geometry: THREE.BufferGeometry, triangleOffset: number): number {
  for (const group of geometry.groups) {
    if (triangleOffset >= group.start && triangleOffset < group.start + group.count) {
      return group.materialIndex ?? 0
    }
  }
  return 0
}

function expandPortableSidedGeometry(
  geometry: THREE.BufferGeometry,
  materials: THREE.Material[],
): THREE.BufferGeometry | null {
  if (materials.every((material) => material.side === THREE.FrontSide)) return null
  const source = geometry.index ? geometry.toNonIndexed() : geometry.clone()
  const position = source.getAttribute('position')
  if (!position || position.count % 3 !== 0) {
    source.dispose()
    throw new Error('Portable sidedness export requires triangle geometry')
  }

  const triangles: Array<{ offset: number; materialIndex: number; reverse: boolean }> = []
  for (let offset = 0; offset < position.count; offset += 3) {
    const materialIndex = materialIndexForTriangle(source, offset)
    const side = materials[materialIndex]?.side ?? THREE.FrontSide
    if (side !== THREE.BackSide) triangles.push({ offset, materialIndex, reverse: false })
    if (side !== THREE.FrontSide) triangles.push({ offset, materialIndex, reverse: true })
  }

  const output = new THREE.BufferGeometry()
  for (const [name, attribute] of Object.entries(source.attributes)) {
    const ArrayType = attribute.array.constructor as new (length: number) => typeof attribute.array
    const values = new ArrayType(triangles.length * 3 * attribute.itemSize)
    const target = new THREE.BufferAttribute(values, attribute.itemSize, attribute.normalized)
    for (let triangle = 0; triangle < triangles.length; triangle++) {
      const entry = triangles[triangle]!
      const order = entry.reverse ? [0, 2, 1] : [0, 1, 2]
      for (let corner = 0; corner < 3; corner++) {
        const sourceIndex = entry.offset + order[corner]!
        const targetIndex = triangle * 3 + corner
        for (let component = 0; component < attribute.itemSize; component++) {
          let value = attribute.getComponent(sourceIndex, component)
          if (entry.reverse && name === 'normal') value = -value
          if (entry.reverse && name === 'tangent' && component === 3) value = -value
          target.setComponent(targetIndex, component, value)
        }
      }
    }
    output.setAttribute(name, target)
  }

  let groupStart = 0
  let groupMaterial = triangles[0]?.materialIndex ?? 0
  for (let index = 1; index <= triangles.length; index++) {
    const materialIndex = triangles[index]?.materialIndex
    if (index < triangles.length && materialIndex === groupMaterial) continue
    output.addGroup(groupStart * 3, (index - groupStart) * 3, groupMaterial)
    groupStart = index
    groupMaterial = materialIndex ?? 0
  }
  source.dispose()
  return output
}

function bakeDoubleSidedMeshes(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return
    const materials = materialsOf(mesh)
    const geometry = expandPortableSidedGeometry(mesh.geometry, materials)
    if (!geometry) return
    const original = mesh.geometry
    mesh.geometry = geometry
    const converted = materials.map((material) => {
      if (material.side === THREE.FrontSide) return material
      const clone = material.clone()
      clone.side = THREE.FrontSide
      rememberDiscarded(root, material)
      return clone
    })
    mesh.material = Array.isArray(mesh.material) ? converted : converted[0]!
    rememberDiscarded(root, original)
  })
}
const PORTABLE_COLOR_PROPERTIES = [
  'color',
  'emissive',
  'sheenColor',
  'specularColor',
  'attenuationColor',
] as const

function clampPortableMaterialColors(root: THREE.Object3D): boolean {
  const materials = new Set<THREE.Material>()
  root.traverse((object) => {
    if (!(object as THREE.Mesh).isMesh) return
    for (const material of materialsOf(object as THREE.Mesh)) materials.add(material)
  })

  let clipped = false
  for (const material of materials) {
    const properties = material as unknown as Record<string, unknown>
    for (const property of PORTABLE_COLOR_PROPERTIES) {
      const color = properties[property] as THREE.Color | undefined
      if (!color?.isColor) continue
      if (color.r < 0 || color.r > 1 || color.g < 0 || color.g > 1 || color.b < 0 || color.b > 1) {
        clipped = true
        color.r = THREE.MathUtils.clamp(color.r, 0, 1)
        color.g = THREE.MathUtils.clamp(color.g, 0, 1)
        color.b = THREE.MathUtils.clamp(color.b, 0, 1)
      }
    }
  }
  return clipped
}

export function normalizePortableScene(root: THREE.Object3D): string[] {
  expandInstancedMeshes(root)
  root.updateMatrixWorld(true)
  freezeDeformedMeshes(root)
  const clampedMaterialColors = clampPortableMaterialColors(root)
  materializeDataTextures(root)
  const clampedVertexColors = bakeVertexColors(root)
  const clampedHdr = clampedMaterialColors || clampedVertexColors
  canonicalizeAlphaMaps(root)
  canonicalizeNormalMaps(root)
  bakeDoubleSidedMeshes(root)
  root.updateMatrixWorld(true)
  return clampedHdr
    ? [
        'Some rendered colors were outside the portable range (including colors brighter than the portable range) and were clipped to 0–1; the brightest areas may lose contrast.',
      ]
    : []
}
/**
 * Canonicalize baked static material details without freezing authored item
 * deformation that existing saved-viewer animation clips still target.
 */
export function normalizeViewerArtifactMaterials(root: THREE.Object3D): string[] {
  const clampedMaterialColors = clampPortableMaterialColors(root)
  materializeDataTextures(root)
  const clampedVertexColors = bakeVertexColors(root, true)
  canonicalizeAlphaMaps(root)
  canonicalizeNormalMaps(root)
  return clampedMaterialColors || clampedVertexColors
    ? [
        'Some rendered colors were outside the portable range (including colors brighter than the portable range) and were clipped to 0–1; the brightest areas may lose contrast.',
      ]
    : []
}

function cloneMaterialForUsdz(material: THREE.Material): THREE.Material {
  const clone = material.clone()
  clone.side = THREE.FrontSide
  return clone
}

function reverseWindingPreservingNormals(geometry: THREE.BufferGeometry): void {
  const index = geometry.getIndex()
  if (index) {
    for (let offset = 0; offset < index.count; offset += 3) {
      const first = index.getX(offset)
      index.setX(offset, index.getX(offset + 2))
      index.setX(offset + 2, first)
    }
    index.needsUpdate = true
    return
  }

  for (const attribute of Object.values(geometry.attributes)) {
    for (let offset = 0; offset < attribute.count; offset += 3) {
      for (let component = 0; component < attribute.itemSize; component++) {
        const first = attribute.getComponent(offset, component)
        attribute.setComponent(offset, component, attribute.getComponent(offset + 2, component))
        attribute.setComponent(offset + 2, component, first)
      }
    }
    attribute.needsUpdate = true
  }
}

/** Make reflected static geometry agree with exported normals after world transforms. */
export function fixReflectedMeshWinding(root: THREE.Object3D): void {
  root.updateMatrixWorld(true)
  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh || mesh.matrixWorld.determinant() >= 0) return
    const original = mesh.geometry
    mesh.geometry = original.clone()
    reverseWindingPreservingNormals(mesh.geometry)
    rememberDiscarded(root, original)
  })
}

/**
 * Build a USDZ-only clone with world transforms baked into geometry. This
 * removes unsupported negative-scale transforms without changing the shared
 * prepared artifact or its identity hierarchy. Empty mesh containers become
 * groups because USDZ requires vertex positions for every mesh primitive.
 */
export function createUsdzScene(source: THREE.Object3D): THREE.Object3D {
  source.updateMatrixWorld(true)

  const cloneObject = (object: THREE.Object3D): THREE.Object3D => {
    let clone: THREE.Object3D
    const mesh = object as THREE.Mesh
    if (mesh.isMesh && (mesh.geometry.getAttribute('position')?.count ?? 0) > 0) {
      const geometry = mesh.geometry.clone()
      geometry.applyMatrix4(mesh.matrixWorld)
      if (mesh.matrixWorld.determinant() < 0) reverseWindingPreservingNormals(geometry)
      const material = Array.isArray(mesh.material)
        ? mesh.material.length === 1
          ? cloneMaterialForUsdz(mesh.material[0]!)
          : mesh.material.map(cloneMaterialForUsdz)
        : cloneMaterialForUsdz(mesh.material)
      clone = new THREE.Mesh(geometry, material)
    } else {
      clone = new THREE.Group()
    }

    clone.name = object.name
    clone.visible = object.visible
    clone.layers.mask = object.layers.mask
    clone.renderOrder = object.renderOrder
    clone.userData = structuredClone(object.userData)
    for (const child of object.children) clone.add(cloneObject(child))
    return clone
  }

  return cloneObject(source)
}

/** Dispose geometry, materials, and export-owned texture handles exactly once. */
export function disposeExportResources(
  root: THREE.Object3D,
  options: { textures?: boolean } = {},
): void {
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  const textures = new Set<THREE.Texture>()
  root.traverse((object) => {
    const renderable = object as THREE.Mesh
    if (renderable.geometry) geometries.add(renderable.geometry)
    if (!renderable.material) return
    for (const material of materialsOf(renderable)) {
      materials.add(material)
      if (options.textures === false) continue
      const textured = material as TexturedMaterial
      for (const slot of MATERIAL_TEXTURE_SLOTS) {
        const texture = textured[slot]
        if (texture instanceof THREE.Texture) textures.add(texture)
      }
    }
  })

  for (const resource of discardedResources.get(root) ?? []) {
    if (resource instanceof THREE.Texture) textures.add(resource)
    else if (resource instanceof THREE.Material) materials.add(resource)
    else geometries.add(resource)
  }
  discardedResources.delete(root)

  for (const geometry of geometries) geometry.dispose()
  for (const material of materials) material.dispose()
  for (const texture of textures) texture.dispose()
}
