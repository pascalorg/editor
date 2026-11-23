import { afterEach, expect, test } from 'bun:test'
import { type AnyNode, buildLawn, LawnNode, SiteNode } from '@pascal-app/core'
import {
  BufferGeometry,
  Color,
  DataTexture,
  FrontSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  PerspectiveCamera,
  SRGBColorSpace,
} from 'three'
import { buildLawnBakeGeometry } from './bake-geometry'
import { LAWN_CUTOUT_ALPHA_FLOOR, lawnBakeMaterial } from './bake-textures'
import { corollaMap } from './flower-material'
import { buildLawnGeometry, disposeLawnGeometry, updateLawnLOD } from './geometry'
import { NEAR_ORDER, NEAR_TUFT } from './tuft-shape'
import { swardTexture, tuftTexture } from './turf-textures'

function required<T>(value: T | null | undefined, label: string): T {
  if (value == null) throw new Error(`Missing ${label} in exported lawn`)
  return value
}

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

function meshes(root: Object3D, prefix: string) {
  const found: { geometry: BufferGeometry; material: MeshStandardMaterial }[] = []
  root.traverse((object) => {
    if (
      object instanceof Mesh &&
      object.name.startsWith(prefix) &&
      object.material instanceof MeshStandardMaterial
    )
      found.push({ geometry: object.geometry, material: object.material })
  })
  return found
}

function mapOf(material: MeshStandardMaterial): DataTexture {
  if (!(material.map instanceof DataTexture))
    throw new Error('Portable lawn needs its RGBA appearance picture.')
  expect(material.map.colorSpace).toBe(SRGBColorSpace)
  expect(material.vertexColors).toBe(false)
  expect(material.alphaToCoverage).toBe(false)
  return material.map
}

function textureColor(texture: DataTexture, u: number, v: number): Color {
  const { data, width, height } = texture.image
  const offset = (Math.floor(v * height) * width + Math.floor(u * width)) * 4
  return new Color().setRGB(
    Number(data[offset]) / 255,
    Number(data[offset + 1]) / 255,
    Number(data[offset + 2]) / 255,
    SRGBColorSpace,
  )
}

// Independent sampling of the linear live procedural pictures.
function sample(texture: DataTexture, channels: number, u: number, v: number, channel = 0): number {
  const { data, width, height } = texture.image
  const px = u * width - 0.5,
    py = v * height - 0.5,
    x = Math.floor(px),
    y = Math.floor(py)
  const wrap = (n: number, size: number) => ((n % size) + size) % size
  let value = 0
  for (let dy = 0; dy <= 1; dy++)
    for (let dx = 0; dx <= 1; dx++) {
      const weight = (dx ? px - x : 1 - px + x) * (dy ? py - y : 1 - py + y)
      value +=
        (Number(data[(wrap(y + dy, height) * width + wrap(x + dx, width)) * channels + channel]) *
          weight) /
        255
    }
  return value
}

function smooth(low: number, high: number, value: number) {
  const t = Math.max(0, Math.min(1, (value - low) / (high - low)))
  return t * t * (3 - 2 * t)
}

function barycentric(x: number, y: number, uv: number[]): [number, number, number] {
  const [ax = 0, ay = 0, bx = 0, by = 0, cx = 0, cy = 0] = uv
  const determinant = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
  if (!determinant) return [1, 0, 0]
  const a = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / determinant
  const b = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / determinant
  return [a, b, 1 - a - b]
}

function canonicalTuft(geometry: BufferGeometry, local: number, roots: Float32Array) {
  const position = geometry.getAttribute('position')
  const x = (position.getX(local * 10) + position.getX(local * 10 + 1)) / 2,
    z = (position.getZ(local * 10) + position.getZ(local * 10 + 1)) / 2
  for (let blade = 0; blade < roots.length / 4; blade++)
    if (Math.hypot(x - (roots[blade * 4] ?? 0), z - (roots[blade * 4 + 2] ?? 0)) < 1e-5)
      return blade
  throw new Error('Exported tuft moved off its canonical root.')
}

test('portable lawn geometry retains every canonical tuft and complete flower while the runtime view is far', () => {
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
    expect(object.geometry.getAttribute('color')).toBeUndefined()
    const position = object.geometry.getAttribute('position'),
      index = object.geometry.index
    if (!index) throw new Error('Portable lawn geometry must be indexed.')
    expect(index.array).toBeInstanceOf(Uint16Array)
    expect(position.count).toBeLessThanOrEqual(65535)
    for (const value of index.array) expect(value).toBeLessThan(position.count)
    for (const name of ['position', 'normal', 'uv'])
      expect([...object.geometry.getAttribute(name).array].every(Number.isFinite)).toBe(true)
    indices += index.count
  })
  expect(canonical.flowers.count).toBeGreaterThan(0)
  expect(names).toContain('lawn-ground')
  expect(names).toContain('lawn-flowers')
  expect(indices).toBe(
    canonical.base.indices.length +
      canonical.blades.count * NEAR_ORDER.length * 2 +
      canonical.flowers.indices.length,
  )
  expect(JSON.stringify(nodes)).toBe(before)
})

test.each(['#617c36', '#fafafa'])(
  'portable tuft pictures retain the live cutouts, cool/ripe colours and crossed silhouette for %s',
  (color) => {
    const { root, nodes, lawn } = fixture({ color, roughness: 0.8 })
    const canonical = buildLawn(lawn, nodes),
      tint = new Color(color),
      lease = new MeshStandardMaterial(),
      picture = tuftTexture(lease)
    try {
      const blades = meshes(root, 'lawn-blades-static-')
      expect(blades.length).toBeGreaterThan(0)
      let tuft = 0,
        coloured = 0,
        gaps = 0
      const seen = new Set<number>()
      const maps = new Set<DataTexture>()
      for (const { geometry, material } of blades) {
        const map = mapOf(material),
          uv = geometry.getAttribute('uv'),
          position = geometry.getAttribute('position')
        maps.add(map)
        expect(
          (material.alphaTest - LAWN_CUTOUT_ALPHA_FLOOR) / (1 - LAWN_CUTOUT_ALPHA_FLOOR),
        ).toBeCloseTo(0.32, 6)
        expect(material.side).toBe(FrontSide)
        const normal = geometry.getAttribute('normal'),
          index = required(geometry.index, 'tuft triangle index')
        for (let vertex = 0; vertex < normal.count; vertex++)
          expect(normal.getY(vertex)).toBeGreaterThan(0.9)
        for (let face = 0; face < index.count; face += 6) {
          expect(index.getX(face)).toBe(index.getX(face + 5))
          expect(index.getX(face + 1)).toBe(index.getX(face + 4))
          expect(index.getX(face + 2)).toBe(index.getX(face + 3))
        }
        expect(map.image.width).toBeLessThanOrEqual(1024)
        expect(map.image.height).toBeLessThanOrEqual(1024)
        expect(map.image.data.byteLength).toBeLessThanOrEqual(4 * 1024 * 1024)
        for (let local = 0; local < uv.count / 10; local++) {
          const blade = canonicalTuft(geometry, local, canonical.blades.rootHeight)
          seen.add(blade)
          if (local >= 20) continue
          const yaw = canonical.blades.traits[blade * 4] ?? 0,
            lean = canonical.blades.traits[blade * 4 + 1] ?? 0,
            tone = canonical.blades.traits[blade * 4 + 2] ?? 1,
            width = canonical.blades.traits[blade * 4 + 3] ?? 0,
            height = canonical.blades.rootHeight[blade * 4 + 3] ?? 0
          for (let vertex = 0; vertex < 10; vertex++) {
            const side = NEAR_TUFT[vertex * 3] ?? 0,
              progress = NEAR_TUFT[vertex * 3 + 1] ?? 0,
              plane = NEAR_TUFT[vertex * 3 + 2] ?? 0,
              angle = yaw + plane * 1.83,
              bend = progress * progress * height * lean * 1.6
            expect(position.getX(local * 10 + vertex)).toBeCloseTo(
              (canonical.blades.rootHeight[blade * 4] ?? 0) +
                Math.cos(angle) * side * width * canonical.blades.tuftWidthScale +
                Math.sin(angle) * bend,
              5,
            )
            expect(position.getY(local * 10 + vertex)).toBeCloseTo(
              (canonical.blades.rootHeight[blade * 4 + 1] ?? 0) +
                progress * height * (1 - plane * 0.11),
              5,
            )
            expect(position.getZ(local * 10 + vertex)).toBeCloseTo(
              (canonical.blades.rootHeight[blade * 4 + 2] ?? 0) -
                Math.sin(angle) * side * width * canonical.blades.tuftWidthScale +
                Math.cos(angle) * bend,
              5,
            )
          }
          for (let plane = 0; plane < 2; plane++) {
            const base = local * 10 + (plane ? 6 : 0),
              top = base + (plane ? 2 : 4)
            const pick = yaw * 2.37 + plane * 0.47,
              fract = (n: number) => n - Math.floor(n),
              column = fract(pick) >= 0.5 ? 1 : 0,
              row = lawn.roughness ** 2 >= fract(pick * 1.71) ? 1 : 0
            for (let y = 12; y < 128; y += 17)
              for (let x = 3; x < 128; x += 19) {
                const u = (x + 0.5) / 128,
                  progress = (y + 0.5) / 128,
                  coverage = sample(picture, 2, (u + column) / 2, (progress + row) / 2, 1)
                const mapU = uv.getX(base) + (uv.getX(base + 1) - uv.getX(base)) * u,
                  mapV = uv.getY(base) + (uv.getY(top) - uv.getY(base)) * progress
                const pixel =
                  (Math.floor(mapV * map.image.height) * map.image.width +
                    Math.floor(mapU * map.image.width)) *
                  4
                const effectiveCoverage = (Number(map.image.data[pixel + 3]) - 128) / 127
                expect(Math.abs(effectiveCoverage - coverage)).toBeLessThanOrEqual(0.5 / 127 + 1e-6)
                if (coverage < 0.1) {
                  gaps++
                  continue
                }
                if (coverage < 0.9) continue
                const actual = textureColor(map, mapU, mapV)
                const ripe = row * smooth(0.36, 1, progress) * smooth(0.88, 1.14, tone)
                const shade =
                  tone * (sample(picture, 2, (u + column) / 2, (progress + row) / 2) * 1.48 + 0.22)
                const expected = [
                  tint.r * (0.64 + ripe * 0.48) * shade,
                  tint.g * (0.81 + ripe * 0.17) * shade,
                  tint.b * (1.22 - ripe * 0.14) * shade,
                ]
                for (const [channel, component] of ['r', 'g', 'b'].entries())
                  expect(
                    Math.abs(
                      actual[component as 'r' | 'g' | 'b'] - Math.min(1, expected[channel] ?? 0),
                    ),
                  ).toBeLessThan(0.03)
                coloured++
              }
          }
        }
        tuft += uv.count / 10
      }
      expect(maps.size).toBeLessThanOrEqual(2)
      const mapBytes = [...maps].reduce((bytes, map) => bytes + map.image.data.byteLength, 0)
      expect(mapBytes).toBeLessThanOrEqual(8 * 1024 * 1024)
      expect(tuft).toBe(canonical.blades.count)
      expect(seen.size).toBe(canonical.blades.count)
      expect(coloured).toBeGreaterThan(100)
      expect(gaps).toBeGreaterThan(100)
    } finally {
      lease.dispose()
    }
  },
)

test.each([false, true])(
  'portable ground keeps the two grain frequencies and painted soil (painted=%s)',
  (painted) => {
    const { root, nodes, lawn } = fixture({
      strokes: painted ? [{ points: [[0, -2]], effect: 'bare', radiusM: 0.75, strength: 1 }] : [],
    })
    const canonical = buildLawn(lawn, nodes),
      lease = new MeshStandardMaterial(),
      picture = swardTexture(lease)
    let checked = 0
    try {
      for (const { geometry, material } of meshes(root, 'lawn-ground')) {
        const map = mapOf(material),
          uv = geometry.getAttribute('uv'),
          position = geometry.getAttribute('position'),
          index = required(geometry.index, 'ground triangle index')
        expect(material.alphaTest).toBe(0)
        for (let face = 0; face < index.count; face += 3) {
          const corners = [index.getX(face), index.getX(face + 1), index.getX(face + 2)]
          const coords = corners.flatMap((i) => [uv.getX(i), uv.getY(i)])
          const u = ((coords[0] ?? 0) + (coords[2] ?? 0) + (coords[4] ?? 0)) / 3,
            v = ((coords[1] ?? 0) + (coords[3] ?? 0) + (coords[5] ?? 0)) / 3
          const pixelU = (Math.floor(u * map.image.width) + 0.5) / map.image.width,
            pixelV = (Math.floor(v * map.image.height) + 0.5) / map.image.height
          const weights = barycentric(pixelU, pixelV, coords)
          if (Math.min(...weights) < 0.05) continue
          const source = corners.map((i) => {
            for (let vertex = 0; vertex < canonical.base.positions.length / 3; vertex++)
              if (
                canonical.base.positions[vertex * 3] === position.getX(i) &&
                canonical.base.positions[vertex * 3 + 2] === position.getZ(i)
              )
                return vertex
            throw new Error('Exported ground moved off its canonical terrain.')
          })
          const x = corners.reduce(
              (sum, i, corner) =>
                sum + position.getX(i) * required(weights[corner], 'triangle weight'),
              0,
            ),
            z = corners.reduce(
              (sum, i, corner) =>
                sum + position.getZ(i) * required(weights[corner], 'triangle weight'),
              0,
            ),
            phase = (lawn.seed % 113) / 113
          const coverage = source.reduce(
            (sum, i, corner) =>
              sum + (canonical.base.cover?.[i] ?? 1) * required(weights[corner], 'triangle weight'),
            0,
          )
          const grain =
            sample(picture, 1, x * 1.28 + phase, z * 1.28 + phase) * 1.75 +
            sample(picture, 1, z * 0.72 - phase, -x * 0.72 - phase) * 0.55 +
            0.04
          const actual = textureColor(map, pixelU, pixelV)
          for (const [channel, component] of ['r', 'g', 'b'].entries()) {
            const tint = source.reduce(
              (sum, i, corner) =>
                sum +
                (canonical.base.colors[i * 3 + channel] ?? 0) *
                  required(weights[corner], 'triangle weight'),
              0,
            )
            expect(actual[component as 'r' | 'g' | 'b']).toBeCloseTo(
              Math.min(1, tint * (1 + (grain - 1) * coverage)),
              2,
            )
          }
          checked++
        }
      }
      expect(checked).toBeGreaterThan(4)
    } finally {
      lease.dispose()
    }
  },
)

test.each(['daisy', 'clover', 'yarrow'] as const)(
  'portable %s flowers retain corolla detail and authored species colours',
  (species) => {
    const { root, nodes, lawn } = fixture({ flowers: [{ species, color: '#df83be', share: 1 }] })
    const canonical = buildLawn(lawn, nodes),
      lease = new MeshStandardMaterial(),
      picture = corollaMap(lease)
    expect(canonical.flowers.count).toBeGreaterThan(0)
    const sourceFaces = new Map<string, number>()
    const faceKey = (positions: ArrayLike<number>) => Array.from(positions).join(',')
    for (let face = 0; face < canonical.flowers.indices.length; face += 3)
      sourceFaces.set(faceKey(canonical.flowers.positions.subarray(face * 3, face * 3 + 9)), face)
    let checked = 0,
      masked = 0
    try {
      for (const { geometry, material } of meshes(root, 'lawn-flowers')) {
        const map = mapOf(material),
          uv = geometry.getAttribute('uv'),
          positions = geometry.getAttribute('position'),
          index = required(geometry.index, 'flower triangle index')
        expect(
          (material.alphaTest - LAWN_CUTOUT_ALPHA_FLOOR) / (1 - LAWN_CUTOUT_ALPHA_FLOOR),
        ).toBeCloseTo(0.28, 6)
        for (let pixel = 3; pixel < map.image.data.length; pixel += 4)
          if (map.image.data[pixel] === 128) masked++
        for (let face = 0; face < index.count; face += 3) {
          const corners = [index.getX(face), index.getX(face + 1), index.getX(face + 2)]
          const key = faceKey(
            corners.flatMap((i) => [positions.getX(i), positions.getY(i), positions.getZ(i)]),
          )
          const sourceFace = sourceFaces.get(key)
          if (sourceFace === undefined) throw new Error('Portable flower lost a canonical face.')
          const coords = corners.flatMap((i) => [uv.getX(i), uv.getY(i)])
          const u = corners.reduce((sum, i) => sum + uv.getX(i), 0) / 3,
            v = corners.reduce((sum, i) => sum + uv.getY(i), 0) / 3
          const pixelU = (Math.floor(u * map.image.width) + 0.5) / map.image.width,
            pixelV = (Math.floor(v * map.image.height) + 0.5) / map.image.height
          const weights = barycentric(pixelU, pixelV, coords)
          if (Math.min(...weights) < -0.01) continue
          const source = [0, 1, 2].map((i) => canonical.flowers.indices[sourceFace + i] ?? 0)
          const sourceU = source.reduce(
              (sum, i, corner) =>
                sum +
                ((canonical.flowers.uv[i * 2] ?? 0) / 65535) *
                  required(weights[corner], 'triangle weight'),
              0,
            ),
            sourceV = source.reduce(
              (sum, i, corner) =>
                sum +
                ((canonical.flowers.uv[i * 2 + 1] ?? 0) / 65535) *
                  required(weights[corner], 'triangle weight'),
              0,
            )
          const actual = textureColor(map, pixelU, pixelV)
          for (const [channel, component] of ['r', 'g', 'b'].entries()) {
            const tint = source.reduce(
              (sum, i, corner) =>
                sum +
                (Math.round((canonical.flowers.colors[i * 3 + channel] ?? 0) * 255) / 255) *
                  required(weights[corner], 'triangle weight'),
              0,
            )
            expect(actual[component as 'r' | 'g' | 'b']).toBeCloseTo(
              Math.min(1, tint * sample(picture, 4, sourceU, sourceV, channel)),
              2,
            )
          }
          checked++
        }
      }
      expect(checked).toBeGreaterThan(20)
      if (species !== 'clover') expect(masked).toBeGreaterThan(0)
    } finally {
      lease.dispose()
    }
  },
)

test.each([0.32, 0.28])(
  'canvas-safe alpha keeps filtered live mask decisions at cutoff %s',
  (cutoff) => {
    const source = [0, 32, 64, 80, 81, 82, 83, 96, 112, 128, 144, 160, 192, 224, 254, 255]
    const pixels = new Uint8Array(16 * 4)
    for (const [pixel, alpha] of source.entries()) pixels.set([87, 132, 53, alpha], pixel * 4)
    const material = lawnBakeMaterial('mask-filter-oracle', pixels, 4, 4, 0.9, cutoff)
    owned.push(new Group().add(new Mesh(new BufferGeometry(), material)))
    const check = (weights: number[]) => {
      const total = weights.reduce((sum, value) => sum + value, 0)
      const original =
        weights.reduce(
          (sum, weight, i) => sum + (weight * required(source[i], 'source alpha')) / 255,
          0,
        ) / total
      const encoded =
        weights.reduce(
          (sum, weight, i) => sum + (weight * required(pixels[i * 4 + 3], 'encoded alpha')) / 255,
          0,
        ) / total
      const effective = (encoded - LAWN_CUTOUT_ALPHA_FLOOR) / (1 - LAWN_CUTOUT_ALPHA_FLOOR)
      const quantum = 0.5 / 127 + 1e-12
      expect(Math.abs(effective - original)).toBeLessThanOrEqual(quantum)
      if (Math.abs(original - cutoff) > quantum)
        expect(encoded >= material.alphaTest).toBe(original >= cutoff)
    }
    // Bilinear footprints at different sub-texel positions.
    for (let y = 0; y < 3; y++)
      for (let x = 0; x < 3; x++)
        for (const u of [0, 0.25, 0.5, 0.75, 1])
          for (const v of [0, 0.25, 0.5, 0.75, 1]) {
            const weights = Array<number>(16).fill(0)
            weights[y * 4 + x] = (1 - u) * (1 - v)
            weights[y * 4 + x + 1] = u * (1 - v)
            weights[(y + 1) * 4 + x] = (1 - u) * v
            weights[(y + 1) * 4 + x + 1] = u * v
            check(weights)
          }
    // A coarse mip also commutes with the affine transform.
    check(Array<number>(16).fill(1))
    for (let pixel = 0; pixel < 16; pixel++) {
      expect(pixels[pixel * 4 + 3]).toBeGreaterThanOrEqual(128)
      expect([...pixels.subarray(pixel * 4, pixel * 4 + 3)]).toEqual([87, 132, 53])
    }
  },
)

test('lawn cleanup disposes every derived appearance map once without disposing a borrowed texture', () => {
  const { root } = fixture()
  let ownedDisposals = 0,
    borrowedDisposals = 0
  const maps = new Set<DataTexture>()
  root.traverse((object) => {
    if (object instanceof Mesh && object.material instanceof MeshStandardMaterial)
      maps.add(mapOf(object.material))
  })
  expect(maps.size).toBeGreaterThanOrEqual(3)
  for (const map of maps)
    map.addEventListener('dispose', () => {
      ownedDisposals++
    })
  const borrowed = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)
  borrowed.addEventListener('dispose', () => {
    borrowedDisposals++
  })
  root.add(new Mesh(new BufferGeometry(), new MeshStandardMaterial({ map: borrowed })))
  disposeLawnGeometry(root)
  disposeLawnGeometry(root)
  expect(ownedDisposals).toBe(maps.size)
  expect(borrowedDisposals).toBe(0)
  borrowed.dispose()
})
