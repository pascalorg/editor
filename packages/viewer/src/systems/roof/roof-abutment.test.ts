// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, test } from 'bun:test'
import { type AnyNode, RoofNode, RoofSegmentNode } from '@pascal-app/core'
import * as THREE from 'three'
import { generateRoofSegmentGeometry } from './roof-system'

type Point = [number, number]
const DEG = Math.PI / 180

/** A gable over a plan rectangle [x0, x1] × [z0, z1] drawn as an outline, its own roof on `level`. */
function roofOver(id: string, x0: number, x1: number, z0: number, z1: number, extra = {}) {
  const cx = (x0 + x1) / 2
  const cz = (z0 + z1) / 2
  const footprint: Point[] = [
    [x0 - cx, z0 - cz],
    [x1 - cx, z0 - cz],
    [x1 - cx, z1 - cz],
    [x0 - cx, z1 - cz],
  ]
  const roof = RoofNode.parse({
    id: `roof_${id}`,
    type: 'roof',
    parentId: 'level_roofs',
    position: [cx, 0, cz],
    children: [`rseg_${id}`],
  })
  const segment = RoofSegmentNode.parse({
    id: `rseg_${id}`,
    type: 'roof-segment',
    parentId: roof.id,
    roofType: 'gable',
    width: x1 - x0,
    depth: z1 - z0,
    pitch: 30,
    wallHeight: 0.3,
    overhang: 0.5,
    wallThickness: 0.1,
    deckThickness: 0.1,
    shingleThickness: 0.05,
    footprint,
    ...extra,
  })
  return { roof, segment }
}

function extentOf(segment: RoofSegmentNode, nodes: Record<string, AnyNode>) {
  const geometry = generateRoofSegmentGeometry(segment, nodes)
  geometry.computeBoundingBox()
  const box = geometry.boundingBox!.clone()
  geometry.dispose()
  return box
}

describe('roofs that meet', () => {
  const west = roofOver('west', 0, 6, 0, 8)
  const east = roofOver('east', 6, 14, 0, 8, { wallHeight: 1.2 })
  const nodes = Object.fromEntries(
    [west.roof, west.segment, east.roof, east.segment].map((n) => [n.id, n]),
  ) as Record<string, AnyNode>

  test('the overhang is drawn on every side, the shared edge too', () => {
    // it runs into the neighbour's attic and hides there; the Overhang field alone sets it
    const reach = 0.5 * Math.cos(30 * DEG)
    const w = extentOf(west.segment, nodes)
    // the west roof's segment frame: x ∈ [-3, 3]
    expect(w.max.x).toBeGreaterThan(3 + reach - 0.01)
    expect(w.min.x).toBeLessThan(-3 - reach + 0.01)
    const e = extentOf(east.segment, nodes)
    // the east roof's segment frame: x ∈ [-4, 4]
    expect(e.min.x).toBeLessThan(-4 - reach + 0.01)
    expect(e.max.x).toBeGreaterThan(4 + reach - 0.01)
  })
})

describe('square eaves with little overhang', () => {
  test('with none the eave ends plumb on the wall line and the soffit rests on the wall', () => {
    const { roof, segment } = roofOver('solo', 0, 6, 0, 8, { overhang: 0, squareEaves: true })
    const nodes = { [roof.id]: roof, [segment.id]: segment } as Record<string, AnyNode>
    const geometry = generateRoofSegmentGeometry(segment, nodes)
    geometry.computeBoundingBox()
    // nothing past the walls: z ∈ [-4, 4] in the segment's frame
    expect(geometry.boundingBox!.max.z).toBeLessThan(4 + 0.005)
    // just above the soffit's line on the wall, looking in from outside: the
    // roof's end stands on the wall line — no notch between wall and soffit
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
    const end = new THREE.Raycaster(
      new THREE.Vector3(0, 0.3 + 0.01, 20),
      new THREE.Vector3(0, 0, -1),
    )
      .intersectObject(mesh)
      .at(0)!.point.z
    expect(end).toBeGreaterThan(4 - 0.01)
    geometry.dispose()
  })
})
