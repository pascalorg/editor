import { describe, expect, test } from 'bun:test'
import { RoofSegmentNode } from '@pascal-app/core'
import * as THREE from 'three'
import { ROOF_PLANE_CASES, type RoofPlaneCall } from './__fixtures__/roof-plane-cases'
import { generateRoofSegmentGeometry } from './roof-system'

/**
 * Slice R's case table, drawn: every roof the retired hip and gable plane tools built, against the
 * roof segment that covers it, through the viewer's own roof geometry. The planes' geometry is the
 * plane tools' arithmetic: an outline the walls' outside faces grown by the overhangs, a surface
 * rising from each outline edge at the pitch from `eaveHeight − overhang × pitch` there, and a slab
 * the thickness deep, square to the slope. One difference is the segment's own drawing: under its
 * eaves the deck is boxed level 5 cm under its edge (the fascia covers that edge), where a plane's
 * slab kept its slope to the edge, so the depth is compared over the house, 1 m in from its walls.
 */

const COVERING = 3
const DEFAULTS = { overhang: 0.457, gableOverhang: 0.305, thickness: 0.29 }

type Box = { x0: number; z0: number; x1: number; z1: number }

/** The planes' outline in plan. */
function planesOutline(call: RoofPlaneCall): Box {
  const [ax, az, bx, bz] = call.rect
  const eave = call.overhang ?? DEFAULTS.overhang
  const gable = call.gableOverhang ?? DEFAULTS.gableOverhang
  const hip = call.tool === 'hip_roof_planes'
  const alongX = hip ? eave : call.ridgeAxis === 'x' ? gable : eave
  const alongZ = hip ? eave : call.ridgeAxis === 'z' ? gable : eave
  return {
    x0: Math.min(ax, bx) - alongX,
    x1: Math.max(ax, bx) + alongX,
    z0: Math.min(az, bz) - alongZ,
    z1: Math.max(az, bz) + alongZ,
  }
}

/** The planes' surface over a plan point: the lowest rise from the outline edges the planes slope from. */
function planesSurface(call: RoofPlaneCall, x: number, z: number): number {
  const o = planesOutline(call)
  const rise = call.pitch / 12
  const base = call.eaveHeight - (call.overhang ?? DEFAULTS.overhang) * rise
  const fromX = Math.min(x - o.x0, o.x1 - x)
  const fromZ = Math.min(z - o.z0, o.z1 - z)
  const run =
    call.tool === 'hip_roof_planes'
      ? Math.min(fromX, fromZ)
      : call.ridgeAxis === 'x'
        ? fromZ
        : fromX
  return base + run * rise
}

const materials = Array.from(
  { length: 8 },
  () => new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
)

/** The segment's geometry where it stands in its storey's plan. */
function segmentMesh(c: (typeof ROOF_PLANE_CASES)[number]): THREE.Mesh {
  const s = c.segment
  const node = RoofSegmentNode.parse({
    roofType: s.roofType,
    width: s.width,
    depth: s.depth,
    position: [s.centre[0], s.eave, s.centre[1]],
    rotation: s.rotation,
    pitch: s.pitch,
    overhang: s.overhang,
    gableOverhang: s.gableOverhang,
    wallThickness: s.wallThickness,
    deckThickness: s.deckThickness,
    shingleThickness: s.shingleThickness,
    wallHeight: 0,
    fascia: true,
  })
  const geometry = generateRoofSegmentGeometry(node)
  geometry.applyMatrix4(
    new THREE.Matrix4().makeRotationY(s.rotation).setPosition(s.centre[0], s.eave, s.centre[1]),
  )
  return new THREE.Mesh(geometry, materials)
}

/** The plan extent of the covering's upward faces. */
function coveringOutline(mesh: THREE.Mesh): Box {
  const geometry = mesh.geometry
  const position = geometry.getAttribute('position')
  const index = geometry.getIndex()
  const at = (i: number) =>
    new THREE.Vector3().fromBufferAttribute(position, index ? index.getX(i) : i)
  const box = new THREE.Box3()
  for (const group of geometry.groups) {
    if (group.materialIndex !== COVERING) continue
    for (let i = group.start; i < group.start + group.count; i += 3) {
      const [a, b, c] = [at(i), at(i + 1), at(i + 2)]
      const normal = new THREE.Vector3()
        .subVectors(b, a)
        .cross(new THREE.Vector3().subVectors(c, a))
      if (normal.normalize().y > 0.3) box.expandByPoint(a).expandByPoint(b).expandByPoint(c)
    }
  }
  return { x0: box.min.x, z0: box.min.z, x1: box.max.x, z1: box.max.z }
}

const down = new THREE.Vector3(0, -1, 0)

/** The covering's top over a plan point, and the slab's underside under it. */
function slabAt(mesh: THREE.Mesh, x: number, z: number) {
  const ray = new THREE.Raycaster(new THREE.Vector3(x, 100, z), down)
  const hits = ray.intersectObject(mesh)
  const top = hits.find((hit) => hit.face?.materialIndex === COVERING)
  if (!top) return null
  // the deck's underside: the lowest downward face within a slab's depth (the covering's own is above it)
  const undersides = hits.filter(
    (hit) =>
      hit.distance > top.distance &&
      hit.distance < top.distance + 0.6 &&
      (hit.face?.normal.y ?? 0) < -0.3,
  )
  return { top: top.point.y, underside: undersides.at(-1)?.point.y ?? null }
}

/** Plan points over the roof, 10 cm in from its outline: a 9 × 7 grid. */
function samples(o: Box): [number, number][] {
  const points: [number, number][] = []
  for (let i = 0; i <= 8; i++)
    for (let j = 0; j <= 6; j++)
      points.push([
        o.x0 + 0.1 + ((o.x1 - o.x0 - 0.2) * i) / 8,
        o.z0 + 0.1 + ((o.z1 - o.z0 - 0.2) * j) / 6,
      ])
  return points
}

describe('the hip and gable planes, as roof segments', () => {
  for (const c of ROOF_PLANE_CASES) {
    test(c.name, () => {
      const mesh = segmentMesh(c)
      const planes = planesOutline(c.call)

      // the same outline: the covering reaches the planes' edges (its shingles lap 1 cm past the deck)
      const covering = coveringOutline(mesh)
      for (const side of ['x0', 'z0', 'x1', 'z1'] as const)
        expect(Math.abs(covering[side] - planes[side])).toBeLessThan(0.015)

      // the same surface, lifted onto the walls where the planes sank into them
      const slope = Math.atan(c.call.pitch / 12)
      const thickness = c.call.thickness ?? DEFAULTS.thickness
      const [ax, az, bx, bz] = c.call.rect
      const overHouse = (x: number, z: number) =>
        x > Math.min(ax, bx) + 1 &&
        x < Math.max(ax, bx) - 1 &&
        z > Math.min(az, bz) + 1 &&
        z < Math.max(az, bz) - 1
      let deep = 0
      for (const [x, z] of samples(planes)) {
        const slab = slabAt(mesh, x, z)
        expect(slab).not.toBeNull()
        if (!slab) continue
        expect(slab.top).toBeCloseTo(planesSurface(c.call, x, z) + c.lift, 2)
        // as deep, square to the slope
        if (!overHouse(x, z)) continue
        deep++
        expect(slab.underside).not.toBeNull()
        expect(slab.top - (slab.underside ?? 0)).toBeCloseTo(thickness / Math.cos(slope), 2)
      }
      expect(deep).toBeGreaterThan(4)
      mesh.geometry.dispose()
    })
  }

  test('the cases cover both tools, both ridge axes and the eave on, over and sunk into the walls', () => {
    const calls = ROOF_PLANE_CASES.map((c) => c.call)
    expect(calls.filter((c) => c.tool === 'hip_roof_planes').length).toBeGreaterThan(3)
    expect(
      new Set(calls.filter((c) => c.tool === 'gable_roof_planes').map((c) => c.ridgeAxis)),
    ).toEqual(new Set(['x', 'z']))
    expect(ROOF_PLANE_CASES.some((c) => c.lift > 0.1)).toBe(true)
    expect(ROOF_PLANE_CASES.some((c) => c.walls === null)).toBe(true)
  })
})
