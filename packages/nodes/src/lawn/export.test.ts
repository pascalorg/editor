import { afterEach, expect, test } from 'bun:test'
import { type AnyNode, buildLawn, LawnNode, SiteNode } from '@pascal-app/core'
import {
  BufferGeometry,
  Color,
  DataTexture,
  LinearFilter,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  PerspectiveCamera,
  SRGBColorSpace,
} from 'three'
import { buildLawnBakeGeometry } from './bake-geometry'
import { buildLawnGeometry, disposeLawnGeometry, updateLawnLOD } from './geometry'

const owned: Object3D[] = []
afterEach(() => {
  for (const group of owned.splice(0)) disposeLawnGeometry(group)
})

function fixture(properties: Partial<LawnNode> = {}) {
  const lawn = LawnNode.parse({
    id: 'lawn_export',
    parentId: 'site_export',
    seed: 19,
    outline: [
      [-1, -3],
      [1, -3],
      [1, -1],
      [-1, -1],
    ],
    flowerDensity: 2,
    flowers: [{ species: 'daisy', share: 1 }],
    ...properties,
  })
  const site = SiteNode.parse({ id: 'site_export', children: [lawn.id] })
  const nodes: Record<string, AnyNode> = { [site.id]: site, [lawn.id]: lawn }
  const context = { parent: site, sceneNodes: nodes }
  const root = buildLawnBakeGeometry(lawn, context)
  owned.push(root)
  return { root, nodes, lawn, context }
}

function portableBlades(root: Object3D) {
  const blades: { geometry: BufferGeometry; material: MeshStandardMaterial }[] = []
  root.traverse((object) => {
    if (
      object instanceof Mesh &&
      object.name.startsWith('lawn-blades-static-') &&
      object.material instanceof MeshStandardMaterial
    )
      blades.push({ geometry: object.geometry, material: object.material })
  })
  return blades
}

function textureColor(texture: DataTexture, u: number, v: number): Color {
  const { data, width, height } = texture.image
  if (!(data instanceof Uint8Array)) throw new Error('Expected an RGBA8 portable colour ramp.')
  const offset = (Math.floor(v * height) * width + Math.floor(u * width)) * 4
  return new Color().setRGB(
    (data[offset] ?? 0) / 255,
    (data[offset + 1] ?? 0) / 255,
    (data[offset + 2] ?? 0) / 255,
    SRGBColorSpace,
  )
}

test('portable lawn geometry retains every canonical blade and complete flower while the runtime view is far', () => {
  const { root, nodes, lawn, context } = fixture()
  const before = JSON.stringify(nodes),
    canonical = buildLawn(lawn, nodes)
  const interactive = buildLawnGeometry(lawn, context)
  owned.push(interactive)
  const camera = new PerspectiveCamera(50, 1, 0.1, 5000)
  camera.position.set(0, 1000, 1000)
  camera.lookAt(0, 0, 0)
  expect(updateLawnLOD(interactive, camera, 900)).toEqual({ near: 0, mid: 0, flowers: 0 })
  let indices = 0
  const names: string[] = []
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return
    names.push(object.name)
    expect(object.material).toBeInstanceOf(MeshStandardMaterial)
    expect(object.geometry.getAttribute('lawnRootHeight')).toBeUndefined()
    expect(object.geometry.getAttribute('lawnTraits')).toBeUndefined()
    const position = object.geometry.getAttribute('position'),
      index = object.geometry.index
    if (!index) throw new Error('Portable lawn geometry must be indexed.')
    expect(index.array).toBeInstanceOf(Uint16Array)
    expect(position.count).toBeLessThanOrEqual(65535)
    for (const value of index.array) expect(value).toBeLessThan(position.count)
    for (const name of ['position', 'normal'])
      expect([...object.geometry.getAttribute(name).array].every(Number.isFinite)).toBe(true)
    indices += index.count
  })
  expect(canonical.flowers.count).toBeGreaterThan(0)
  expect(names).toContain('lawn-ground')
  expect(names).toContain('lawn-flowers')
  expect(indices).toBe(
    canonical.base.indices.length + canonical.blades.count * 15 + canonical.flowers.indices.length,
  )
  expect(JSON.stringify(nodes)).toBe(before)
})

test.each(['#617c36', '#fafafa'])(
  'portable ramps preserve all curved-blade vertex colours at RGBA8 precision for %s',
  (color) => {
    const { root, nodes, lawn } = fixture({ color })
    const canonical = buildLawn(lawn, nodes),
      tint = new Color(color)
    const blades = portableBlades(root)
    expect(blades.length).toBeGreaterThan(0)
    let blade = 0
    for (const { geometry, material } of blades) {
      const map = material.map,
        uv = geometry.getAttribute('uv')
      if (!(map instanceof DataTexture))
        throw new Error('Portable blades need a compact derived colour ramp.')
      expect(material.vertexColors).toBe(false)
      expect(geometry.getAttribute('color')).toBeUndefined()
      expect(map.colorSpace).toBe(SRGBColorSpace)
      expect(map.minFilter).toBe(LinearFilter)
      expect(map.magFilter).toBe(LinearFilter)
      expect(map.generateMipmaps).toBe(false)
      expect(map.image.data.byteLength).toBeLessThanOrEqual(192 * 1024)
      for (let vertex = 0; vertex < uv.count; vertex++) {
        const progress = [0, 0, 0.4, 0.4, 0.75, 0.75, 1][vertex % 7] ?? 0
        const tone = canonical.blades.traits[(blade + Math.floor(vertex / 7)) * 4 + 2] ?? 1
        const actual = textureColor(map, uv.getX(vertex), uv.getY(vertex))
        const shade = tone * (0.86 + progress * 0.3)
        for (const channel of ['r', 'g', 'b'] as const)
          expect(actual[channel]).toBeCloseTo(Math.min(1, Math.max(0, tint[channel] * shade)), 2)
      }
      blade += uv.count / 7
    }
    expect(blade).toBe(canonical.blades.count)
  },
)

test('lawn cleanup disposes its derived ramps once without disposing a borrowed texture', () => {
  const { root } = fixture()
  let ownedDisposals = 0,
    borrowedDisposals = 0
  const blades = portableBlades(root)
  for (const { material } of blades) {
    if (!(material.map instanceof DataTexture)) throw new Error('Expected an owned colour ramp.')
    material.map.addEventListener('dispose', () => {
      ownedDisposals++
    })
  }
  const borrowed = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)
  borrowed.addEventListener('dispose', () => {
    borrowedDisposals++
  })
  root.add(new Mesh(new BufferGeometry(), new MeshStandardMaterial({ map: borrowed })))
  disposeLawnGeometry(root)
  disposeLawnGeometry(root)
  expect(ownedDisposals).toBe(blades.length)
  expect(borrowedDisposals).toBe(0)
  borrowed.dispose()
})
