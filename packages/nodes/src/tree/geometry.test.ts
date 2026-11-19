import { afterEach, describe, expect, test } from 'bun:test'
import { TreeNode } from '@pascal-app/core'
import { disposeObject3DResources } from '@pascal-app/viewer'
import {
  type Group,
  type Intersection,
  Mesh,
  MeshStandardMaterial,
  Raycaster,
  Vector2,
  Vector3,
} from 'three'
import { buildTreeFarGeometry, buildTreeGeometry } from './geometry'

const trees: Group[] = []
afterEach(() => {
  for (const tree of trees) disposeObject3DResources(tree)
  trees.length = 0
})

function treeMesh(form: TreeNode['form'], build: typeof buildTreeGeometry) {
  const node = TreeNode.parse({ form, seed: 37 })
  const tree = build(node)
  trees.push(tree)
  tree.updateMatrixWorld(true)
  const mesh = tree.children[0]
  if (!(mesh instanceof Mesh) || !(mesh.material instanceof MeshStandardMaterial))
    throw new Error('Expected the built tree mesh and its atlas material')
  return mesh as Mesh<typeof mesh.geometry, MeshStandardMaterial>
}

function triangleHits(mesh: Mesh, ray: Raycaster): Intersection[] {
  const hits: Intersection[] = []
  Mesh.prototype.raycast.call(mesh, ray, hits)
  return hits
}

// Samples well inside opaque leaves or clear gaps, independent of the filter at their edges.
function atlasCoverage(mesh: ReturnType<typeof treeMesh>, uv: Vector2) {
  const atlas = mesh.material.map
  if (!atlas) throw new Error('Expected a tree atlas')
  const { width, height, data } = atlas.image
  const texels = data as Uint8Array
  const column = Math.floor(uv.x * width - 0.5)
  const row = Math.floor(uv.y * height - 0.5)
  const coverage: number[] = []
  for (const y of [row, row + 1])
    for (const x of [column, column + 1]) {
      const at = Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))
      coverage.push((texels[at * 4 + 3] ?? 0) / 255)
    }
  return { min: Math.min(...coverage), max: Math.max(...coverage) }
}

function isBark(uv: Vector2) {
  return uv.x > 0.5 && uv.x < 0.75 && uv.y > 0.75
}

function* sprigSamples(mesh: ReturnType<typeof treeMesh>) {
  const { geometry } = mesh
  const index = geometry.index
  if (!index) throw new Error('Expected indexed tree triangles')
  const position = geometry.getAttribute('position')
  const uv = geometry.getAttribute('uv')
  for (let face = 0; face < index.count; face += 3) {
    const corners = [index.getX(face), index.getX(face + 1), index.getX(face + 2)]
    const points = corners.map((corner) => new Vector3().fromBufferAttribute(position, corner))
    const coords = corners.map((corner) => new Vector2().fromBufferAttribute(uv, corner))
    const [first, second, third] = points
    const [firstUV, secondUV, thirdUV] = coords
    if (!first || !second || !third || !firstUV || !secondUV || !thirdUV || isBark(firstUV))
      continue
    const normal = second.clone().sub(first).cross(third.clone().sub(first)).normalize()
    // Fine enough to sample narrow conifer needles as well as broad leaves.
    const divisions = 24
    for (let u = 1; u < divisions - 1; u++)
      for (let v = 1; v < divisions - u; v++) {
        const weight = 1 - (u + v) / divisions
        const point = first
          .clone()
          .multiplyScalar(u / divisions)
          .addScaledVector(second, v / divisions)
          .addScaledVector(third, weight)
        const coord = firstUV
          .clone()
          .multiplyScalar(u / divisions)
          .addScaledVector(secondUV, v / divisions)
          .addScaledVector(thirdUV, weight)
        yield { point, coord, normal }
      }
  }
}

function sprigRays(mesh: ReturnType<typeof treeMesh>, opaque: boolean): Raycaster[] {
  const rays: Raycaster[] = []
  for (const { point, coord, normal } of sprigSamples(mesh)) {
    const coverage = atlasCoverage(mesh, coord)
    if (opaque ? coverage.min < 0.5 : coverage.max > 0.03) continue
    point.applyMatrix4(mesh.matrixWorld)
    const direction = normal.clone().transformDirection(mesh.matrixWorld)
    // Isolate the card, without a trunk or a deeper card hiding a transparent miss.
    const ray = new Raycaster(
      point.addScaledVector(direction, 0.0001),
      direction.negate(),
      0,
      0.0002,
    )
    const hits = triangleHits(mesh, ray)
    if (
      hits.length &&
      hits.every((hit) => {
        if (!hit.uv || isBark(hit.uv)) return false
        const sampled = atlasCoverage(mesh, hit.uv)
        return opaque ? sampled.min > 0.5 : sampled.max < 0.03
      })
    )
      rays.push(ray)
    if (rays.length === 6) break
  }
  expect(rays).toHaveLength(6)
  return rays
}

for (const form of ['round', 'upright', 'weeping', 'conifer'] as const)
  for (const [level, build] of [
    ['near', buildTreeGeometry],
    ['far', buildTreeFarGeometry],
  ] as const)
    describe(`${form} ${level} tree silhouette`, () => {
      test('the trunk and middle crown remain ray targets', () => {
        const mesh = treeMesh(form, build)
        for (const height of [0.8, 5.2]) {
          const ray = new Raycaster(new Vector3(0, height, 20), new Vector3(0, 0, -1))
          expect(ray.intersectObject(mesh).length).toBeGreaterThan(0)
        }
      })

      test('opaque sprig leaves remain ray targets', () => {
        const mesh = treeMesh(form, build)
        for (const ray of sprigRays(mesh, true))
          expect(ray.intersectObject(mesh).length).toBeGreaterThan(0)
      })

      test('transparent sprig regions are empty air, not card or crown proxies', () => {
        const mesh = treeMesh(form, build)
        for (const ray of sprigRays(mesh, false)) expect(ray.intersectObject(mesh)).toHaveLength(0)
        const beside = new Raycaster(new Vector3(30, 5.2, 20), new Vector3(0, 0, -1))
        expect(beside.intersectObject(mesh)).toHaveLength(0)
      })

      test('highlighting preserves leaf gaps and raycasts only append their own hits', () => {
        const mesh = treeMesh(form, build)
        const [ray] = sprigRays(mesh, false)
        if (!ray) throw new Error('Expected a ray through a leaf gap')
        const original = mesh.material
        const highlight = new MeshStandardMaterial()
        const sentinel = { distance: 100, point: new Vector3(), object: mesh }
        const hits: Intersection[] = [sentinel]
        const origin = ray.ray.origin.clone()
        const direction = ray.ray.direction.clone()
        try {
          mesh.material = highlight
          mesh.raycast(ray, hits)
          expect(hits).toHaveLength(1)
          expect(hits[0]).toBe(sentinel)
          expect(ray.ray.origin).toEqual(origin)
          expect(ray.ray.direction).toEqual(direction)
          expect(mesh.material).toBe(highlight)
        } finally {
          mesh.material = original
          highlight.dispose()
        }
      })
    })
