import { describe, expect, test } from 'bun:test'
import { RoofCovering, RoofNode, RoofSegmentNode } from '@pascal-app/core'
import {
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Vector2,
  Vector3,
} from 'three'
import { float } from 'three/tsl'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import {
  createRoofCoveringGeometry,
  createRoofCoveringMaterial,
  RoofCoveringDetail,
  supportsRoofCovering,
} from './covering-detail'

// A planar right triangle: 2 m across, 1 m along its slope. Independent of
// production roof triangulation, UV projection and detail-pattern algorithms.
function metreTriangle(pitch: number, yaw = 0, offset = new Vector3()) {
  const angle = (pitch * Math.PI) / 180
  const vertices = [
    new Vector3(),
    new Vector3(0, Math.sin(angle), Math.cos(angle)),
    new Vector3(2, 0, 0),
  ]
  for (const vertex of vertices) vertex.applyAxisAngle(new Vector3(0, 1, 0), yaw).add(offset)
  const geometry = new BufferGeometry()
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array(vertices.flatMap((p) => p.toArray())), 3),
  )
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 0, 0.2, 0.4, 0]), 2))
  geometry.setIndex([0, 1, 2])
  geometry.addGroup(0, 3, 3)
  geometry.computeVertexNormals()
  return geometry
}

const covering = () => RoofCovering.parse({ profile: 'tile', distance: 5 })

describe('roof-plane detail coordinates', () => {
  test('rotating or mirroring unrelated base UVs cannot change metre coordinates or the covering tangent basis', () => {
    const source = metreTriangle(35, 0.7, new Vector3(12, 3, -8))
    const reference = createRoofCoveringGeometry(source)
    try {
      const originalUv = Array.from(source.getAttribute('uv').array)
      for (const transform of [
        (u: number, v: number) => [-v, u],
        (u: number, v: number) => [-u, v],
      ]) {
        const variant = source.clone()
        const uv = variant.getAttribute('uv')
        for (let i = 0; i < uv.count; i++) {
          const [u, v] = transform(uv.getX(i), uv.getY(i))
          uv.setXY(i, u!, v!)
        }
        const detailed = createRoofCoveringGeometry(variant)
        try {
          expect(Array.from(uv.array)).not.toEqual(originalUv)
          expect(Array.from(detailed.getAttribute('uv').array)).toEqual(Array.from(uv.array))
          // The real material consumes this explicit basis, not derivatives of
          // the unrelated base UV0. Positions, normals and metre UV3 stay fixed.
          for (const attribute of ['position', 'normal', 'uv3', 'tangent']) {
            expect(detailed.getAttribute(attribute)).toBeDefined()
            expect(Array.from(detailed.getAttribute(attribute).array)).toEqual(
              Array.from(reference.getAttribute(attribute).array),
            )
          }
          expect(detailed.groups).toEqual(reference.groups)
        } finally {
          detailed.dispose()
          variant.dispose()
        }
      }
      expect(Array.from(source.getAttribute('uv').array)).toEqual(originalUv)
    } finally {
      reference.dispose()
      source.dispose()
    }
  })

  test.each([10, 35, 70])(
    'preserves real metre distances at %d° and after yaw/translation',
    (pitch) => {
      for (const [yaw, offset] of [
        [0, new Vector3()],
        [0.7, new Vector3(12, 3, -8)],
      ] as const) {
        const source = metreTriangle(pitch, yaw, offset)
        const positions = Array.from(source.getAttribute('position').array)
        const originalUv = Array.from(source.getAttribute('uv').array)
        const detailed = createRoofCoveringGeometry(source)
        try {
          const uv = detailed.getAttribute('uv3')
          const at = (index: number) => new Vector2(uv.getX(index), uv.getY(index))
          // Float32 coordinates below 20 m: 1e-4 m is far below a tile course.
          expect(at(0).distanceTo(at(1))).toBeCloseTo(1, 4)
          expect(at(0).distanceTo(at(2))).toBeCloseTo(2, 4)
          expect(at(1).distanceTo(at(2))).toBeCloseTo(Math.sqrt(5), 4)
          expect(Math.abs(at(1).x - at(0).x)).toBeLessThan(1e-4)
          const normal = detailed.getAttribute('normal')
          const tangent = detailed.getAttribute('tangent')
          for (let i = 0; i < 3; i++) {
            const n = new Vector3().fromBufferAttribute(normal, i)
            const t = new Vector3(tangent.getX(i), tangent.getY(i), tangent.getZ(i))
            expect(t.length()).toBeCloseTo(1, 5)
            expect(Math.abs(n.dot(t))).toBeLessThan(1e-5)
            expect(Math.abs(tangent.getW(i))).toBe(1)
          }
          expect(Array.from(source.getAttribute('position').array)).toEqual(positions)
          expect(Array.from(detailed.getAttribute('position').array)).toEqual(positions)
          expect(Array.from(detailed.getAttribute('uv').array)).toEqual(originalUv)
          expect(source.getAttribute('uv3')).toBeUndefined()
          expect(detailed.groups).toEqual(source.groups)
        } finally {
          detailed.dispose()
          source.dispose()
        }
      }
    },
  )
})

describe('opt-in detail and resource ownership', () => {
  test('covering retains authored opacity and roughness nodes, including at zero fade strength', () => {
    const source = new MeshStandardNodeMaterial({ opacity: 0.3, transparent: true })
    source.opacityNode = float(0.92)
    source.roughnessNode = float(0.73)
    const opacity = source.opacityNode
    const roughness = source.roughnessNode
    const detail = createRoofCoveringMaterial(source, covering())!
    try {
      expect(detail).not.toBeNull()
      const material = detail.material as MeshStandardNodeMaterial
      for (const strength of [1, 0.5, 0]) {
        detail.strength.value = strength
        expect(material.opacityNode).toBe(opacity)
        expect(material.roughnessNode).toBe(roughness)
        expect(material.opacity).toBe(0.3)
        expect(material.transparent).toBe(true)
      }
      expect(source.opacityNode).toBe(opacity)
      expect(source.roughnessNode).toBe(roughness)
      expect(source.map).toBeNull()
      expect(source.normalMap).toBeNull()
    } finally {
      detail.dispose()
      source.dispose()
    }
  })

  test('legacy schemas do not silently opt existing roofs into detail', () => {
    expect(RoofNode.parse({}).covering).toBeUndefined()
    expect(RoofSegmentNode.parse({}).covering).toBeUndefined()
    expect(supportsRoofCovering(RoofSegmentNode.parse({ roofType: 'gable' }))).toBe(true)
    for (const roofType of ['flat', 'conical', 'barrel'] as const)
      expect(supportsRoofCovering(RoofSegmentNode.parse({ roofType }))).toBe(false)
    expect(supportsRoofCovering(RoofSegmentNode.parse({ roofSystem: 'glazed' }))).toBe(false)
  })

  test('zero relief is a neutral normal, while generated detail preserves the authored colour', () => {
    const source = new MeshStandardMaterial({ color: '#a0522d', roughness: 0.8 })
    const neutral = createRoofCoveringMaterial(source, { ...covering(), relief: 0 })!
    try {
      expect(neutral.material).not.toBe(source)
      expect((neutral.material as MeshStandardMaterial).color.equals(source.color)).toBe(true)
      expect(source.normalMap).toBeNull()
      const pixels = (neutral.texture as DataTexture).image.data
      expect(
        Array.from(pixels).filter((value, index) => value !== [128, 128, 255, 255][index % 4]),
      ).toEqual([])
    } finally {
      neutral.dispose()
      source.dispose()
    }
  })

  test('a library texture is not overlaid with an unrelated generated course pattern', () => {
    const source = new MeshStandardMaterial()
    const texture = new DataTexture(new Uint8Array([128, 80, 40, 255]), 1, 1)
    source.map = texture
    try {
      expect(createRoofCoveringMaterial(source, covering())).toBeNull()
      expect(source.map).toBe(texture)
      expect(source.normalMap).toBeNull()
    } finally {
      texture.dispose()
      source.dispose()
    }
  })

  test('near detail restores exact far geometry/materials and export can force it without extra meshes', () => {
    const geometry = metreTriangle(30)
    const materials = Array.from(
      { length: 7 },
      () => new MeshStandardMaterial({ color: '#8b5140' }),
    )
    const mesh = new Mesh(geometry, materials)
    const camera = new PerspectiveCamera()
    const controller = new RoofCoveringDetail(mesh, materials, covering())
    let sourceDisposed = 0
    geometry.addEventListener('dispose', () => sourceDisposed++)
    for (const material of materials) material.addEventListener('dispose', () => sourceDisposed++)
    try {
      camera.position.set(0, 2, 0)
      controller.update(camera)
      const nearGeometry = mesh.geometry
      const nearMaterials = mesh.material as MeshStandardMaterial[]
      expect(nearGeometry).not.toBe(geometry)
      expect(nearMaterials[3]).not.toBe(materials[3])
      expect(nearMaterials[3]!.normalMap).not.toBeNull()
      expect(mesh.children).toHaveLength(0)
      for (const slot of [0, 1, 2, 4, 5, 6]) expect(nearMaterials[slot]).toBe(materials[slot])
      camera.position.set(0, 50, 0)
      controller.update(camera)
      expect(mesh.geometry).toBe(geometry)
      expect(mesh.material).toBe(materials)
      controller.update(camera, true, true)
      expect(mesh.geometry).toBe(nearGeometry)
      expect(mesh.material).toBe(nearMaterials)
      controller.update(camera, false)
      expect(mesh.geometry).toBe(geometry)
      expect(mesh.material).toBe(materials)
      controller.dispose()
      expect(sourceDisposed).toBe(0)
    } finally {
      controller.dispose()
      geometry.dispose()
      for (const material of materials) material.dispose()
    }
  })

  test('replacement geometry and veil suspension do not steal or mutate shared resources', () => {
    const original = metreTriangle(30)
    const replacement = metreTriangle(60).translate(0.2, 0, 0)
    const materials = Array.from({ length: 7 }, () => new MeshStandardMaterial())
    materials[3]!.userData.__pascalCachedMaterial = true
    const mesh = new Mesh(original, materials)
    const camera = new PerspectiveCamera()
    camera.position.set(0, 2, 0)
    const controller = new RoofCoveringDetail(mesh, materials, covering())
    let oldDisposals = 0
    let replacementDisposals = 0
    let materialDisposals = 0
    original.addEventListener('dispose', () => oldDisposals++)
    replacement.addEventListener('dispose', () => replacementDisposals++)
    for (const material of materials)
      material.addEventListener('dispose', () => materialDisposals++)
    const veil = materials.map((material) => material.clone())
    try {
      controller.update(camera)
      const oldNear = mesh.geometry
      mesh.geometry = replacement
      controller.update(camera)
      expect(oldDisposals).toBe(1)
      expect(mesh.geometry).not.toBe(oldNear)
      expect(mesh.geometry).not.toBe(replacement)
      expect(Array.from(mesh.geometry.getAttribute('position').array)).toEqual(
        Array.from(replacement.getAttribute('position').array),
      )
      controller.suspend()
      expect(mesh.geometry).toBe(replacement)
      expect(mesh.material).toBe(materials)
      mesh.material = veil
      controller.update(camera)
      expect(mesh.material).toBe(veil)
      expect(mesh.geometry).toBe(replacement)
      mesh.material = materials
      controller.update(camera)
      expect(mesh.geometry).not.toBe(replacement)
      expect((mesh.material as MeshStandardMaterial[])[3]!.normalMap).not.toBeNull()
      expect(materials[3]!.normalMap).toBeNull()
      expect(materials[3]!.userData.__pascalCachedMaterial).toBe(true)
      controller.dispose()
      expect(mesh.geometry).toBe(replacement)
      expect(mesh.material).toBe(materials)
      expect(oldDisposals).toBe(1)
      expect(replacementDisposals).toBe(0)
      expect(materialDisposals).toBe(0)
    } finally {
      controller.dispose()
      replacement.dispose()
      for (const material of [...materials, ...veil]) material.dispose()
    }
  })
})

// BRIEF-2: all three profiles have a portable metre-bound finish as well as
// live TSL. This checks the public material/controller seam, not GPU appearance.
// Staggered joints, rounded clay, shadows and continuous fade are judged on
// real WebGPU/WebGL2 captures in the acceptance-owned standalone harness.
describe('plain tile, clay and slate covering contracts', () => {
  test.each(['tile', 'clay', 'slate'] as const)(
    '%s has finite portable normals/contact shade and zero relief stays neutral',
    (profile) => {
      const source = new MeshStandardMaterial({ color: '#8c5140', roughness: 0.9 })
      const spec = RoofCovering.parse({ profile, width: 0.3, course: 0.32 })
      const detailed = createRoofCoveringMaterial(source, spec)!
      const neutral = createRoofCoveringMaterial(source, { ...spec, relief: 0 })!
      try {
        const material = detailed.material as MeshStandardMaterial
        expect(material.color.equals(source.color)).toBe(true)
        expect(material.normalMap).toBe(detailed.texture)
        expect(material.map).not.toBeNull()
        expect(material.map!.channel).toBe(3)
        expect(detailed.texture.channel).toBe(3)
        const normals = (detailed.texture as DataTexture).image.data
        let variedNormal = false
        let maximumNormalError = 0
        let positiveZ = true
        let opaque = true
        for (let i = 0; i < normals.length; i += 4) {
          const x = (2 * normals[i]!) / 255 - 1
          const y = (2 * normals[i + 1]!) / 255 - 1
          const z = (2 * normals[i + 2]!) / 255 - 1
          // Each byte's error is at most 1/255; three components give <.007
          // norm error. No requirement for identical atlas resolution/layout.
          maximumNormalError = Math.max(maximumNormalError, Math.abs(Math.hypot(x, y, z) - 1))
          positiveZ &&= z > 0
          opaque &&= normals[i + 3] === 255
          variedNormal ||= normals[i] !== 128 || normals[i + 1] !== 128
        }
        expect(maximumNormalError).toBeLessThan(0.007)
        expect(positiveZ).toBe(true)
        expect(opaque).toBe(true)
        expect(variedNormal).toBe(true)
        const contactTexture = material.map as DataTexture
        const contact = contactTexture.image.data
        expect(Array.from(contact).some((value, index) => index % 4 !== 3 && value < 255)).toBe(
          true,
        )
        const shade = (tileX: number, courseY: number) => {
          // Public texture repeat maps metres to atlas coordinates. Probe halfway
          // down each course, away from its lip: joints alternate by half a tile.
          const u = tileX * spec.width * contactTexture.repeat.x
          const v = courseY * spec.course * contactTexture.repeat.y
          const x = Math.floor((u - Math.floor(u)) * contactTexture.image.width)
          const y = Math.floor((v - Math.floor(v)) * contactTexture.image.height)
          return contact[(y * contactTexture.image.width + x) * 4]!
        }
        expect(shade(0.01, 0.5)).toBeLessThan(shade(0.51, 0.5))
        expect(shade(0.51, 1.5)).toBeLessThan(shade(0.01, 1.5))
        const neutralPixels = (neutral.texture as DataTexture).image.data
        expect(
          Array.from(neutralPixels).every(
            (value, index) => value === [128, 128, 255, 255][index % 4],
          ),
        ).toBe(true)
        expect(source.map).toBeNull()
        expect(source.normalMap).toBeNull()
      } finally {
        detailed.dispose()
        neutral.dispose()
        source.dispose()
      }
    },
  )

  test.each(['tile', 'clay', 'slate'] as const)(
    '%s reuses detail through approach/retreat and restores exact far state after capture',
    (profile) => {
      const geometry = metreTriangle(30)
      const materials = Array.from({ length: 7 }, () => new MeshStandardMaterial())
      const mesh = new Mesh(geometry, materials)
      const camera = new PerspectiveCamera()
      const controller = new RoofCoveringDetail(
        mesh,
        materials,
        RoofCovering.parse({ profile, distance: 10 }),
      )
      try {
        camera.position.set(1, 2, 0)
        controller.update(camera)
        const detailedGeometry = mesh.geometry
        const detailedMaterial = mesh.material
        // Only placement varies: changing camera must not regenerate tessellation.
        for (const distance of [6, 8, 6, 2]) {
          camera.position.set(1, distance, 0)
          controller.update(camera)
          expect(mesh.geometry).toBe(detailedGeometry)
          expect(mesh.material).toBe(detailedMaterial)
          expect(mesh.children).toHaveLength(0)
        }
        camera.position.set(1, 50, 0)
        controller.update(camera)
        expect(mesh.geometry).toBe(geometry)
        expect(mesh.material).toBe(materials)
        const restore = controller.beginCapture(camera)
        expect(mesh.geometry).toBe(detailedGeometry)
        expect(mesh.material).toBe(detailedMaterial)
        restore()
        expect(mesh.geometry).toBe(geometry)
        expect(mesh.material).toBe(materials)
      } finally {
        controller.dispose()
        geometry.dispose()
        for (const material of materials) material.dispose()
      }
    },
  )
})
