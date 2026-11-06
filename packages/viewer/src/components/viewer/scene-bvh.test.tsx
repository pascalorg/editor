import { expect, test } from 'bun:test'
import { act, create } from '@react-three/test-renderer'
import {
  BoxGeometry,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  Raycaster,
  TorusKnotGeometry,
  Vector3,
} from 'three'
import { acceleratedRaycast } from 'three-mesh-bvh'
import {
  Brush,
  csgEvaluator,
  csgGeometry,
  prepareBrushForCSG,
  subtractCsgBrush,
} from '../../lib/csg-utils'
import { SceneBvh } from './scene-bvh'

/**
 * Picking runs through `<SceneBvh>` and three-mesh-bvh. These tests pin the
 * BVH-accelerated hits to three's own brute-force raycast on the geometry the
 * viewer actually builds, so a BVH release that changes tree construction or
 * traversal cannot silently change what the pointer hits.
 */

/**
 * A non-indirect BVH reorders the index buffer in place, so `faceIndex` is not
 * comparable across the build; the hit point and face normal are.
 */
type Hit = { distance: number; point: number[]; normal: number[] }

const round = (values: number[]) => values.map((value) => Number(value.toFixed(5)) + 0)

function wallWithOpening(): BufferGeometry {
  const wall = new Brush(new BoxGeometry(4, 2.7, 0.2, 8, 6, 1))
  const opening = new Brush(new BoxGeometry(0.9, 2.1, 0.6))
  opening.position.set(0.6, -0.3, 0)
  prepareBrushForCSG(wall)
  prepareBrushForCSG(opening)
  return csgGeometry(subtractCsgBrush(wall, opening, csgEvaluator))
}

function geometries(): Array<[string, BufferGeometry]> {
  return [
    ['segmented wall slab', new BoxGeometry(4, 2.7, 0.2, 16, 12, 1)],
    ['CSG wall with an opening', wallWithOpening()],
    ['torus knot', new TorusKnotGeometry(1, 0.3, 96, 12)],
    ['non-indexed torus knot', new TorusKnotGeometry(1, 0.3, 48, 8).toNonIndexed()],
  ]
}

/** Deterministic rays aimed through the bounds, plus axis-parallel rays lying on bound faces. */
function rays(geometry: BufferGeometry): Raycaster[] {
  geometry.computeBoundingBox()
  const box = geometry.boundingBox!
  const size = box.getSize(new Vector3())
  const center = box.getCenter(new Vector3())
  let seed = 0x9e3779b9
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 2 ** 32
  }
  const result: Raycaster[] = []
  for (let index = 0; index < 160; index++) {
    const target = new Vector3(
      box.min.x + random() * size.x,
      box.min.y + random() * size.y,
      box.min.z + random() * size.z,
    )
    const direction = new Vector3(random() - 0.5, random() - 0.5, random() - 0.5).normalize()
    const origin = target.clone().addScaledVector(direction, -10)
    result.push(new Raycaster(origin, direction))
  }
  for (const axis of ['x', 'y', 'z'] as const) {
    for (const face of [box.min, box.max]) {
      const origin = center.clone()
      const direction = new Vector3()
      origin[axis] = face[axis]
      const along = axis === 'x' ? 'y' : 'x'
      origin[along] = box.min[along] - 5
      direction[along] = 1
      result.push(new Raycaster(origin, direction))
    }
    const direction = new Vector3()
    direction[axis] = 1
    const origin = center.clone()
    origin[axis] = box.min[axis] - 5
    result.push(new Raycaster(origin, direction))
  }
  return result
}

function hits(object: Object3D, raycaster: Raycaster, firstHitOnly = false): Hit[] {
  ;(raycaster as Raycaster & { firstHitOnly?: boolean }).firstHitOnly = firstHitOnly
  return raycaster
    .intersectObject(object, false)
    .map(({ distance, point, face }) => ({
      distance: Number(distance.toFixed(5)),
      point: round(point.toArray()),
      normal: round(face?.normal.toArray() ?? []),
    }))
    .sort((a, b) => a.distance - b.distance || JSON.stringify(a).localeCompare(JSON.stringify(b)))
}

/** Equal-distance hits are equally valid first hits, so only where the ray stops is compared. */
const stop = (list: Hit[]) => list.slice(0, 1).map(({ distance, point }) => ({ distance, point }))

test('<SceneBvh> accelerates meshes and its hits match stock three raycasts', async () => {
  const cases = geometries()
  const prebuilt = new Set(
    cases.filter(([, geometry]) => geometry.boundsTree).map(([name]) => name),
  )
  expect([...prebuilt]).toEqual(['CSG wall with an opening'])
  const material = new MeshBasicMaterial({ side: DoubleSide })
  const reference = cases.map(([, geometry]) => new Mesh(geometry, material))
  const expected = reference.map((mesh, index) =>
    rays(cases[index]![1]).map((raycaster) => hits(mesh, raycaster)),
  )

  const renderer = await create(
    <SceneBvh>
      {cases.map(([name, geometry]) => (
        <mesh geometry={geometry} key={name} material={material} name={name} />
      ))}
    </SceneBvh>,
  )
  try {
    for (const [index, [name, geometry]] of cases.entries()) {
      const mesh = renderer.scene.findByProps({ name }).instance as Mesh
      expect(mesh.raycast).toBe(acceleratedRaycast)
      expect(geometry.boundsTree).toBeDefined()

      const actual = rays(geometry).map((raycaster) => hits(mesh, raycaster))
      expect({ name, hits: actual }).toEqual({ name, hits: expected[index]! })
      expect(actual.filter((list) => list.length > 0).length).toBeGreaterThan(40)

      const first = rays(geometry).map((raycaster) => stop(hits(mesh, raycaster, true)))
      expect({ name, first }).toEqual({
        name,
        first: expected[index]!.map(stop),
      })
    }
  } finally {
    await act(async () => renderer.unmount())
  }

  // Only the trees <SceneBvh> built are disposed; CSG output keeps its own.
  for (const [name, geometry] of cases) {
    expect({ name, hasTree: geometry.boundsTree != null }).toEqual({
      name,
      hasTree: prebuilt.has(name),
    })
  }
})

test('<SceneBvh> skips excluded and degenerate meshes and restores raycast on unmount', async () => {
  const material = new MeshBasicMaterial()
  const excluded = new BoxGeometry(1, 1, 1)
  const empty = new BufferGeometry()
  empty.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0], 3))
  const renderer = await create(
    <SceneBvh>
      <mesh
        geometry={excluded}
        material={material}
        name="excluded"
        userData={{ excludeFromBvh: true }}
      />
      <mesh geometry={empty} material={material} name="empty" />
    </SceneBvh>,
  )
  const excludedMesh = renderer.scene.findByProps({ name: 'excluded' }).instance as Mesh
  const emptyMesh = renderer.scene.findByProps({ name: 'empty' }).instance as Mesh
  try {
    expect(excludedMesh.raycast).toBe(Mesh.prototype.raycast)
    expect(excluded.boundsTree).toBeUndefined()
    expect(emptyMesh.raycast).toBe(acceleratedRaycast)
    expect(empty.boundsTree).toBeUndefined()
  } finally {
    await act(async () => renderer.unmount())
  }
  expect(emptyMesh.raycast).toBe(Mesh.prototype.raycast)
})
