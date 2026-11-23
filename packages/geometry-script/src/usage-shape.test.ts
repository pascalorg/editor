import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import {
  BoxGeometry,
  type BufferGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { blenderRun, compileBlenderBuild } from './blender'
import { compileGeometryScript } from './compile'
import { readUsageShape, SHAPE_MAX_BYTES } from './usage-shape'

const material = new MeshStandardMaterial()

function box(width: number, height: number, depth: number, x: number, y: number, z: number) {
  const mesh = new Mesh(new BoxGeometry(width, height, depth), material)
  mesh.position.set(x, y, z)
  return mesh
}

function shapeOf(...meshes: Mesh[]) {
  const group = new Group()
  group.add(...meshes)
  group.updateWorldMatrix(true, true)
  return readUsageShape(meshes)!
}

const extent = (ring: [number, number][], axis: 0 | 1) => {
  const values = ring.map((p) => p[axis])
  return [Math.min(...values), Math.max(...values)] as const
}

describe('the usage shape of a build', () => {
  test('a table is four legs below its top and one slab above them', () => {
    const legs = [-0.55, 0.55].flatMap((x) =>
      [-0.3, 0.3].map((z) => box(0.05, 0.7, 0.05, x, 0.35, z)),
    )
    const top = box(1.2, 0.05, 0.7, 0, 0.725, 0)
    const { bands, tolerance } = shapeOf(...legs, top)
    expect(bands).toHaveLength(2)
    expect(bands[0]!.y0).toBeCloseTo(0, 2)
    expect(bands[0]!.y1).toBeCloseTo(0.7, 1)
    expect(bands[0]!.polygons).toHaveLength(4)
    for (const polygon of bands[0]!.polygons) {
      const [x0, x1] = extent(polygon.outer, 0)
      const [z0, z1] = extent(polygon.outer, 1)
      expect(x1 - x0).toBeGreaterThanOrEqual(0.05 - 1e-6)
      expect(x1 - x0).toBeLessThanOrEqual(0.05 + tolerance)
      expect(z1 - z0).toBeGreaterThanOrEqual(0.05 - 1e-6)
    }
    expect(bands[1]!.y0).toBeCloseTo(0.7, 1)
    expect(bands[1]!.y1).toBeCloseTo(0.75, 1)
    expect(bands[1]!.polygons).toHaveLength(1)
    const [x0, x1] = extent(bands[1]!.polygons[0]!.outer, 0)
    expect(x1 - x0).toBeGreaterThanOrEqual(1.2 - 1e-6)
    expect(x1 - x0).toBeLessThanOrEqual(1.2 + 0.02)
  })

  test('an L-shaped sofa keeps its notch', () => {
    const { bands } = shapeOf(box(2, 0.4, 0.9, 0, 0.2, 0), box(0.9, 0.4, 1.2, -0.55, 0.2, 1.05))
    expect(bands).toHaveLength(1)
    const outline = bands[0]!.polygons[0]!.outer
    expect(outline.length).toBeGreaterThanOrEqual(6)
    // the notch: nothing at x = +0.5, z = +1.0 although the long side reaches x = +1
    const inside = (x: number, z: number) => {
      let result = false
      for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
        const a = outline[i]!
        const b = outline[j]!
        if (a[1] > z !== b[1] > z && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0])
          result = !result
      }
      return result
    }
    expect(inside(0.5, 1.0)).toBe(false)
    expect(inside(0.5, 0.2)).toBe(true)
    expect(inside(-0.6, 1.3)).toBe(true)
  })

  test('a ring keeps its hole', () => {
    const ring = new Mesh(new CylinderGeometry(0.5, 0.5, 0.3, 48, 1, true), material)
    ring.position.y = 0.15
    // the inner wall faces the hole, as a tube's does
    const inner = new Mesh(
      new CylinderGeometry(0.3, 0.3, 0.3, 48, 1, true).scale(-1, 1, 1),
      material,
    )
    inner.position.y = 0.15
    const { bands } = shapeOf(ring, inner)
    const polygon = bands[0]!.polygons.find((p) => p.holes?.length)
    expect(polygon).toBeDefined()
    const [x0, x1] = extent(polygon!.holes![0]!, 0)
    expect(x1 - x0).toBeGreaterThan(0.5)
    expect(x1 - x0).toBeLessThan(0.65)
  })

  test('a build turned half way round the corner has an outline never inside it', () => {
    const slab = box(1, 0.1, 0.2, 0, 0.05, 0)
    slab.rotation.y = Math.PI / 4
    const { bands, tolerance } = shapeOf(slab)
    const outline = bands[0]!.polygons[0]!.outer
    const [x0, x1] = extent(outline, 0)
    const reach = (1 + 0.2) / Math.SQRT2
    expect(x1 - x0).toBeGreaterThanOrEqual(reach - 1e-6)
    expect(x1 - x0).toBeLessThanOrEqual(reach + 2 * tolerance)
  })

  test('a shape that would outgrow its budget is coarsened, never dropped or left oversize', () => {
    const steps = Array.from({ length: 60 }, (_, i) =>
      box(1 - i * 0.01, 0.02, 0.5 + (i % 7) * 0.05, 0, 0.01 + i * 0.02, 0),
    )
    const shape = shapeOf(...steps)
    expect(new TextEncoder().encode(JSON.stringify(shape)).byteLength).toBeLessThanOrEqual(
      SHAPE_MAX_BYTES,
    )
    expect(shape.bands.length).toBeGreaterThan(0)
    expect(shape.bands.at(-1)!.y1).toBeGreaterThanOrEqual(1.18)
  })

  describe('solid whatever the winding', () => {
    const flipped = (geometry: BufferGeometry) => {
      const soup = geometry.toNonIndexed()
      const position = soup.getAttribute('position')
      for (let i = 0; i + 2 < position.count; i += 3) {
        const [x, y, z] = [position.getX(i + 1), position.getY(i + 1), position.getZ(i + 1)]
        position.setXYZ(i + 1, position.getX(i + 2), position.getY(i + 2), position.getZ(i + 2))
        position.setXYZ(i + 2, x, y, z)
      }
      return soup
    }
    const solidBox = (geometry: BufferGeometry) => {
      const { bands } = shapeOf(new Mesh(geometry, material))
      expect(bands).toHaveLength(1)
      expect(bands[0]!.polygons).toHaveLength(1)
      expect(bands[0]!.polygons[0]!.holes).toBeUndefined()
    }

    test('a box with its back faces baked in as a flipped copy', () => {
      const box = new BoxGeometry(1, 0.3, 0.6)
      solidBox(mergeGeometries([box.toNonIndexed(), flipped(box)])!)
    })

    test('an inside-out box', () => {
      solidBox(flipped(new BoxGeometry(1, 0.3, 0.6)))
    })

    test('an inside-out shell inside an outward one does not hollow it', () => {
      const outer = new Mesh(new BoxGeometry(1, 0.3, 0.6), material)
      const inner = new Mesh(flipped(new BoxGeometry(0.4, 0.3, 0.3)), material)
      const { bands } = shapeOf(outer, inner)
      expect(bands).toHaveLength(1)
      expect(bands[0]!.polygons[0]!.holes).toBeUndefined()
    })

    test('boxes that overlap inside one mesh', () => {
      const top = new BoxGeometry(1.2, 0.2, 0.7)
      const leg = new BoxGeometry(0.1, 0.5, 0.1).translate(0.3, 0.1, 0)
      const { bands } = shapeOf(
        new Mesh(mergeGeometries([top.toNonIndexed(), leg.toNonIndexed()])!, material),
      )
      for (const band of bands)
        for (const polygon of band.polygons) expect(polygon.holes).toBeUndefined()
    })
  })

  test('nothing built reads as no shape', () => {
    expect(readUsageShape([])).toBeNull()
  })
})

const TABLE_SCRIPT = `
export const mount = 'floor'
export default function build({ THREE }) {
  const group = new THREE.Group()
  const mat = new THREE.MeshStandardMaterial()
  for (const x of [-0.55, 0.55]) for (const z of [-0.3, 0.3]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.7, 0.05), mat)
    leg.position.set(x, 0.35, z)
    group.add(leg)
  }
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.05, 0.7), mat)
  top.position.set(0, 0.725, 0)
  group.add(top)
  return group
}
`

describe('the usage shape in the manifest', () => {
  test('a three.js build writes it only when asked', async () => {
    const without = await compileGeometryScript({ code: TABLE_SCRIPT })
    expect(without.manifest.shape).toBeUndefined()
    const asked = await compileGeometryScript({ code: TABLE_SCRIPT, usageShape: true })
    expect(asked.manifest.shape?.bands).toHaveLength(2)
    expect(asked.manifest.shape!.bands[0]!.polygons).toHaveLength(4)
    // the rest of the manifest is what it was
    expect({ ...asked.manifest, shape: undefined }).toEqual({
      ...without.manifest,
      shape: undefined,
    })
  })

  test('a Blender build writes it through the same path', async () => {
    const fixture = (name: string) => new URL(`./__fixtures__/blender/${name}`, import.meta.url)
    const code = readFileSync(fixture('cabinet.py'), 'utf8')
    const report = JSON.parse(readFileSync(fixture('cabinet.json'), 'utf8'))
    const glb = new Uint8Array(readFileSync(fixture('cabinet.glb')))
    const run = blenderRun(report, glb)
    const asked = await compileBlenderBuild({ code, params: { width: 1.5 }, run, usageShape: true })
    const shape = asked.manifest.shape!
    expect(shape.bands.length).toBeGreaterThan(0)
    const [x0, x1] = extent(shape.bands[0]!.polygons[0]!.outer, 0)
    expect(x1 - x0).toBeGreaterThanOrEqual(1.5 - 0.05)
    expect(
      (await compileBlenderBuild({ code, params: { width: 1.5 }, run })).manifest.shape,
    ).toBeUndefined()
  })
})
