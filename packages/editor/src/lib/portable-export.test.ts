import { describe, expect, test } from 'bun:test'
import { strFromU8, unzipSync } from 'fflate'
import {
  Box3,
  BoxGeometry,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  FrontSide,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three'
import { USDZExporter } from 'three/examples/jsm/exporters/USDZExporter.js'
import {
  createUsdzScene,
  expandInstancedMeshes,
  freezeDeformedMeshes,
  normalizePortableScene,
} from './portable-export'

describe('portable vertex-color boundary', () => {
  test('clips only over-bright channels while preserving ordinary linear colors', () => {
    withCanvasCapture((capture) => {
      const colors = new Float32Array([0.25, 0.5, 0.75, 1, 1.5, 0.4, 0.2, 0.5, 0.1, 0.2, 0.3, 0])
      const sourceValues = Array.from(colors)
      const geometry = triangleGeometry(colors)
      const material = new MeshStandardMaterial({ vertexColors: true })
      const mesh = new Mesh(geometry, material)
      const root = new Group()
      root.add(mesh)

      const warnings = normalizePortableScene(root)

      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toMatch(/color.*clip/i)
      expect(Array.from(colors)).toEqual(sourceValues)
      expect(portableColorAt(mesh, 0, capture)).toEqual([
        encodeSrgbByte(0.25),
        encodeSrgbByte(0.5),
        encodeSrgbByte(0.75),
        255,
      ])
      expect(portableColorAt(mesh, 1, capture)).toEqual([
        255,
        encodeSrgbByte(0.4),
        encodeSrgbByte(0.2),
        128,
      ])
      expect(portableColorAt(mesh, 2, capture)).toEqual([
        encodeSrgbByte(0.1),
        encodeSrgbByte(0.2),
        encodeSrgbByte(0.3),
        0,
      ])
      const portableMaterial = mesh.material as MeshStandardMaterial
      expect(portableMaterial.emissive.getHex()).toBe(0)
      expect(portableMaterial.emissiveMap).toBeNull()
    })
  })

  test('does not warn when every channel is already portable', () => {
    withCanvasCapture(() => {
      const geometry = triangleGeometry(
        new Float32Array([0, 0.25, 0.5, 1, 0.75, 1, 0.125, 1, 0.3, 0.4, 0.6, 1]),
      )
      const mesh = new Mesh(geometry, new MeshStandardMaterial({ vertexColors: true }))
      const root = new Group()
      root.add(mesh)

      expect(normalizePortableScene(root)).toEqual([])
    })
  })
})

describe('portable geometry normalization', () => {
  test('preserves two transformed instance populations without changing source data', () => {
    const sourceMaterial = new MeshStandardMaterial({ color: '#808080' })
    const sourceGeometry = new BoxGeometry(1, 2, 3)
    const shaderInstancePayload = new InstancedBufferAttribute(new Float32Array(32), 16)
    sourceGeometry.setAttribute('shaderInstancePayload', shaderInstancePayload)
    const instances = new InstancedMesh(sourceGeometry, sourceMaterial, 2)
    instances.name = 'asymmetric-instance'
    instances.position.set(10, 0, -2)
    const firstMatrix = new Matrix4().compose(
      new Vector3(2, 0, 0),
      new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2),
      new Vector3(1, 2, 1),
    )
    const reflectedMatrix = new Matrix4().compose(
      new Vector3(-3, 1, 4),
      new Quaternion(),
      new Vector3(-2, 1, 0.5),
    )
    instances.setMatrixAt(0, firstMatrix)
    instances.setMatrixAt(1, reflectedMatrix)
    instances.setColorAt(0, new Color('#ff0000'))
    instances.setColorAt(1, new Color('#0000ff'))
    const root = new Group()
    root.add(instances)

    expandInstancedMeshes(root)
    root.updateMatrixWorld(true)

    const firstPopulation = new Box3().makeEmpty()
    const reflectedPopulation = new Box3().makeEmpty()
    let triangleCount = 0
    let firstOutputTint: Color | null = null
    let reflectedOutputTint: Color | null = null
    root.traverse((object) => {
      const mesh = object as Mesh
      if (!mesh.isMesh) return
      const positions = mesh.geometry.getAttribute('position')
      triangleCount += (mesh.geometry.getIndex()?.count ?? positions.count) / 3
      for (const attribute of Object.values(mesh.geometry.attributes)) {
        expect((attribute as InstancedBufferAttribute).isInstancedBufferAttribute).not.toBe(true)
        expect(attribute.count).toBe(positions.count)
      }
      for (let index = 0; index < positions.count; index += 1) {
        const world = new Vector3()
          .fromBufferAttribute(positions, index)
          .applyMatrix4(mesh.matrixWorld)
        if (world.x < 9) {
          reflectedPopulation.expandByPoint(world)
          reflectedOutputTint ??= portableLinearTintAt(mesh, index)
        } else {
          firstPopulation.expandByPoint(world)
          firstOutputTint ??= portableLinearTintAt(mesh, index)
        }
      }
    })
    expect(triangleCount).toBe(24)
    expectVector(firstPopulation.getCenter(new Vector3()), new Vector3(12, 0, -2))
    expectVector(firstPopulation.getSize(new Vector3()), new Vector3(3, 4, 1))
    expectVector(reflectedPopulation.getCenter(new Vector3()), new Vector3(7, 1, 2))
    expectVector(reflectedPopulation.getSize(new Vector3()), new Vector3(2, 2, 1.5))
    expect(firstOutputTint).not.toBeNull()
    expect(reflectedOutputTint).not.toBeNull()
    expectColor(firstOutputTint!, sourceMaterial.color.clone().multiply(new Color('#ff0000')))
    expectColor(reflectedOutputTint!, sourceMaterial.color.clone().multiply(new Color('#0000ff')))
    const retainedMatrix = new Matrix4()
    instances.getMatrixAt(1, retainedMatrix)
    expect(retainedMatrix.equals(reflectedMatrix)).toBe(true)
    const retainedColor = new Color()
    expect(instances.geometry.getAttribute('shaderInstancePayload')).toBe(shaderInstancePayload)
    instances.getColorAt(1, retainedColor)
    expect(retainedColor.equals(new Color('#0000ff'))).toBe(true)
  })

  test('freezes a settled morph pose into static vertex positions without mutating its source', () => {
    const geometry = new BufferGeometry()
    const sourcePositions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])
    const morphDelta = new Float32Array([0, 0, 0, 0, 0, 0, 0, 2, 0])
    geometry.setAttribute('position', new Float32BufferAttribute(sourcePositions, 3))
    geometry.morphAttributes.position = [new Float32BufferAttribute(morphDelta, 3)]
    geometry.morphTargetsRelative = true
    const mesh = new Mesh(geometry, new MeshStandardMaterial())
    mesh.updateMorphTargets()
    mesh.morphTargetInfluences![0] = 0.25
    const root = new Group()
    root.add(mesh)

    freezeDeformedMeshes(root)

    const frozen = mesh.geometry.getAttribute('position')
    expect([frozen.getX(2), frozen.getY(2), frozen.getZ(2)]).toEqual([0, 1.5, 0])
    expect(mesh.geometry.morphAttributes.position).toBeUndefined()
    expect(mesh.morphTargetInfluences).toBeUndefined()
    expect(Array.from(sourcePositions)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0])
    expect(Array.from(morphDelta)).toEqual([0, 0, 0, 0, 0, 0, 0, 2, 0])
  })

  test('bakes reflected USDZ transforms with outward-consistent winding and normals', () => {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 1], 3))
    geometry.computeVertexNormals()
    const source = new Mesh(geometry, new MeshStandardMaterial())
    source.name = 'reflected-triangle'
    source.position.set(2, -1, 3)
    source.scale.set(-2, 1, 0.5)
    const root = new Group()
    root.add(source)

    const portable = createUsdzScene(root)
    const reflected = portable.getObjectByName('reflected-triangle') as Mesh
    const positions = reflected.geometry.getAttribute('position')
    const normals = reflected.geometry.getAttribute('normal')
    const first = new Vector3().fromBufferAttribute(positions, 0)
    const second = new Vector3().fromBufferAttribute(positions, 1)
    const third = new Vector3().fromBufferAttribute(positions, 2)
    const faceNormal = second.clone().sub(first).cross(third.clone().sub(first)).normalize()
    const vertexNormal = new Vector3().fromBufferAttribute(normals, 0).normalize()

    expect(faceNormal.dot(vertexNormal)).toBeGreaterThan(0.999)
    expectVector(reflected.position, new Vector3())
    expectVector(reflected.scale, new Vector3(1, 1, 1))
  })

  test('emits every referenced geometry member for a one-element material array', async () => {
    const root = new Group()
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), [new MeshStandardMaterial()])
    root.add(mesh)

    const archive = await new USDZExporter().parseAsync(createUsdzScene(root))
    const files = unzipSync(archive)
    const modelFile = files['model.usda']
    expect(modelFile).toBeDefined()
    const model = strFromU8(modelFile!)
    const geometryReferences = Array.from(
      model.matchAll(/@\.\/(geometries\/[^@]+)@/g),
      (match) => match[1]!,
    )

    expect(geometryReferences).toHaveLength(1)
    for (const reference of geometryReferences) {
      expect(files[reference]).toBeDefined()
    }
  })

  test('retains RGBA and back-face visibility without prescribing GLB representation', () => {
    withCanvasCapture((capture) => {
      const geometry = triangleGeometry(new Float32Array([1, 0, 0, 1, 0, 1, 0, 0.5, 0, 0, 1, 0]))
      geometry.setAttribute('normal', new Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3))
      const mesh = new Mesh(
        geometry,
        new MeshStandardMaterial({ side: DoubleSide, vertexColors: true }),
      )
      const root = new Group()
      root.add(mesh)

      expect(normalizePortableScene(root)).toEqual([])

      expect(portableColorAt(mesh, 0, capture)).toEqual([255, 0, 0, 255])
      expect(portableColorAt(mesh, 1, capture)).toEqual([0, 255, 0, 128])
      expect(portableColorAt(mesh, 2, capture)).toEqual([0, 0, 255, 0])
      const material = mesh.material as MeshStandardMaterial
      expect(material.transparent).toBe(true)
      if (material.side === FrontSide) {
        expect(mesh.geometry.getAttribute('position').count).toBe(6)
        expect(mesh.geometry.getAttribute('normal').getZ(0)).toBe(1)
        expect(mesh.geometry.getAttribute('normal').getZ(3)).toBe(-1)
      } else {
        expect(material.side).toBe(DoubleSide)
        expect(mesh.geometry.getAttribute('position').count).toBe(3)
      }
    })
  })
})

function expectVector(actual: Vector3, expected: Vector3): void {
  expect(actual.x).toBeCloseTo(expected.x, 6)
  expect(actual.y).toBeCloseTo(expected.y, 6)
  expect(actual.z).toBeCloseTo(expected.z, 6)
}

function triangleGeometry(colors: Float32Array): BufferGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3))
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 4))
  return geometry
}

function portableLinearTintAt(mesh: Mesh, vertexIndex: number): Color {
  const material = (
    Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
  ) as MeshStandardMaterial
  const tint = material.color.clone()
  const color = mesh.geometry.getAttribute('color')
  if (color) {
    tint.multiply(
      new Color(color.getX(vertexIndex), color.getY(vertexIndex), color.getZ(vertexIndex)),
    )
  }
  return tint
}

function expectColor(actual: Color, expected: Color): void {
  expect(actual.r).toBeCloseTo(expected.r, 6)
  expect(actual.g).toBeCloseTo(expected.g, 6)
  expect(actual.b).toBeCloseTo(expected.b, 6)
}

function portableColorAt(mesh: Mesh, vertexIndex: number, capture: () => ImageData): number[] {
  const colors = mesh.geometry.getAttribute('color')
  if (colors) {
    return [
      encodeSrgbByte(colors.getX(vertexIndex)),
      encodeSrgbByte(colors.getY(vertexIndex)),
      encodeSrgbByte(colors.getZ(vertexIndex)),
      Math.round((colors.itemSize >= 4 ? colors.getW(vertexIndex) : 1) * 255),
    ]
  }
  const material = mesh.material as MeshStandardMaterial
  if (!material.map) throw new Error('Portable color has no material-connected carrier')
  const channel = material.map.channel ?? 0
  const uvName = channel === 0 ? 'uv' : `uv${channel}`
  const uvs = mesh.geometry.getAttribute(uvName)
  if (!uvs) throw new Error(`Portable color map has no geometry ${uvName} coordinates`)
  const image = capture()
  const u = Math.max(0, Math.min(1, uvs.getX(vertexIndex)))
  const rawV = Math.max(0, Math.min(1, uvs.getY(vertexIndex)))
  const v = material.map.flipY ? 1 - rawV : rawV
  return pixel(
    image.data,
    image.width,
    Math.min(image.width - 1, Math.floor(u * image.width)),
    Math.min(image.height - 1, Math.floor(v * image.height)),
  )
}

function encodeSrgbByte(linear: number): number {
  const clipped = Math.max(0, Math.min(1, linear))
  const encoded = clipped <= 0.0031308 ? clipped * 12.92 : 1.055 * clipped ** (1 / 2.4) - 0.055
  return Math.round(encoded * 255)
}

function pixel(pixels: Uint8ClampedArray, width: number, x: number, y: number): number[] {
  const offset = (y * width + x) * 4
  return Array.from(pixels.subarray(offset, offset + 4))
}

function withCanvasCapture(run: (capture: () => ImageData) => void): void {
  const globals = globalThis as unknown as { document?: Document }
  const previousDocument = globals.document
  let captured: ImageData | null = null
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({
      createImageData: (width: number, height: number) => {
        captured = {
          colorSpace: 'srgb',
          data: new Uint8ClampedArray(width * height * 4),
          height,
          width,
        } as ImageData
        return captured
      },
      putImageData: (image: ImageData) => {
        captured = image
      },
    }),
  } as unknown as HTMLCanvasElement
  globals.document = {
    createElement: (tagName: string) => {
      if (tagName !== 'canvas') throw new Error(`Unexpected element request: ${tagName}`)
      return canvas
    },
  } as unknown as Document

  try {
    run(() => {
      if (!captured) throw new Error('Portable normalization did not emit atlas pixels')
      return captured
    })
  } finally {
    if (previousDocument) globals.document = previousDocument
    else delete globals.document
  }
}
