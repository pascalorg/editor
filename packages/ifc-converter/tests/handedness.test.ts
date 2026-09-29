import { beforeAll, describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AnyNode, DoorNode, ImportedMeshNode, SlabNode, WallNode } from '@pascal-app/core'
import { convertIfcToPascal, type PascalSceneGraph } from '../src'

// Pascal is Y-up and right-handed; IFC is Z-up and right-handed. Seen from
// above, IFC north (+Y) is Pascal -Z, so an IFC plan point (X, Y) is the
// Pascal plan point (x, z) = (X, -Y). Mapping +Y to +Z mirrors the model.
const plan = (ifcX: number, ifcY: number): [number, number] => [ifcX, -ifcY]

const fixture = fileURLToPath(new URL('./fixtures/handedness.ifc', import.meta.url))
const wasmPath = `${dirname(fileURLToPath(import.meta.resolve('web-ifc')))}/`

let scene: PascalSceneGraph

function named<T extends AnyNode>(type: T['type'], name: string): T {
  const node = Object.values(scene.nodes).find(
    (candidate) => candidate.type === type && candidate.name === name,
  )
  expect(node).toBeDefined()
  return node as T
}

function expectPoint(actual: readonly number[], expected: readonly number[]) {
  expect(actual).toHaveLength(expected.length)
  for (let axis = 0; axis < expected.length; axis++) {
    expect(actual[axis]!).toBeCloseTo(expected[axis]!, 5)
  }
}

describe('IFC plan handedness', () => {
  beforeAll(async () => {
    scene = await convertIfcToPascal(await readFile(fixture), undefined, {
      simplify: false,
      wasmPath,
    })
  })

  test('walls keep the IFC plan orientation', () => {
    const east = named<WallNode>('wall', 'Wall A east')
    const north = named<WallNode>('wall', 'Wall B north')
    expectPoint(east.start, plan(0, 0))
    expectPoint(east.end, plan(4, 0))
    expectPoint(north.start, plan(0, 0))
    expectPoint(north.end, plan(0, 2))

    // Frame-free statement of the same thing: in IFC, turning from wall A to
    // wall B is counterclockwise seen from above (A x B points up, +Z). In
    // Pascal, A x B must point up too (+Y), not down.
    const a = [east.end[0] - east.start[0], 0, east.end[1] - east.start[1]]
    const b = [north.end[0] - north.start[0], 0, north.end[1] - north.start[1]]
    const upComponent = a[2]! * b[0]! - a[0]! * b[2]!
    expect(upComponent).toBeGreaterThan(0)
  })

  test('openings keep their distance from the wall start', () => {
    const door = named<DoorNode>('door', 'Door')
    const east = named<WallNode>('wall', 'Wall A east')
    expect(door.parentId).toBe(east.id)
    expect(door.position[0]).toBeCloseTo(1, 5)
  })

  test('slab polygons keep the IFC plan orientation', () => {
    const slab = named<SlabNode>('slab', 'Floor')
    const expected = [plan(0, 0), plan(4, 0), plan(4, 1), plan(1, 1), plan(1, 2), plan(0, 2)]
    expect(slab.polygon).toHaveLength(expected.length)
    for (let index = 0; index < expected.length; index++) {
      expectPoint(slab.polygon[index]!, expected[index]!)
    }
  })

  test('copied meshes land in the same frame as native walls, with outward winding', () => {
    const box = named<ImportedMeshNode>('imported-mesh', 'North-east box')
    const positions = box.primitives.flatMap((primitive) => primitive.positions)
    const xs = positions.filter((_, index) => index % 3 === 0)
    const ys = positions.filter((_, index) => index % 3 === 1)
    const zs = positions.filter((_, index) => index % 3 === 2)
    const [centerX, centerZ] = plan(3, 1.5)
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(centerX, 4)
    expect((Math.min(...zs) + Math.max(...zs)) / 2).toBeCloseTo(centerZ, 4)
    expect(Math.min(...ys)).toBeCloseTo(0, 4)
    expect(Math.max(...ys)).toBeCloseTo(1, 4)

    let signedVolume = 0
    for (const primitive of box.primitives) {
      const vertex = (index: number) => primitive.positions.slice(index * 3, index * 3 + 3)
      const normal = (index: number) => primitive.normals.slice(index * 3, index * 3 + 3)
      for (let index = 0; index + 2 < primitive.indices.length; index += 3) {
        const [ia, ib, ic] = primitive.indices.slice(index, index + 3) as [number, number, number]
        const [a, b, c] = [vertex(ia), vertex(ib), vertex(ic)] as number[][]
        const ab = [b![0]! - a![0]!, b![1]! - a![1]!, b![2]! - a![2]!]
        const ac = [c![0]! - a![0]!, c![1]! - a![1]!, c![2]! - a![2]!]
        const face = [
          ab[1]! * ac[2]! - ab[2]! * ac[1]!,
          ab[2]! * ac[0]! - ab[0]! * ac[2]!,
          ab[0]! * ac[1]! - ab[1]! * ac[0]!,
        ]
        // Counterclockwise winding (Three.js front face) agrees with the
        // stored vertex normal.
        const stored = normal(ia)
        expect(
          face[0]! * stored[0]! + face[1]! * stored[1]! + face[2]! * stored[2]!,
        ).toBeGreaterThan(0)
        signedVolume +=
          (a![0]! * (b![1]! * c![2]! - b![2]! * c![1]!) +
            a![1]! * (b![2]! * c![0]! - b![0]! * c![2]!) +
            a![2]! * (b![0]! * c![1]! - b![1]! * c![0]!)) /
          6
      }
    }
    expect(signedVolume).toBeCloseTo(0.25, 4)
  })
})
