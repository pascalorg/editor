import { expect, test } from 'bun:test'
import { type AnyNode, CeilingNode, ZoneNode } from '@pascal-app/core'
import { type BufferGeometry, type Material, Mesh, MeshBasicMaterial } from 'three'
import {
  CEILING_REGION_MESH,
  type CeilingRegionMaterial,
  updateCeilingGeometry,
} from './ceiling-system'

const square = (x: number, z: number, size: number): [number, number][] => [
  [x, z],
  [x + size, z],
  [x + size, z + size],
  [x, z + size],
]

/** Plan area of a flat geometry (sum of its triangles in XZ). */
function planArea(geometry: BufferGeometry): number {
  const position = geometry.getAttribute('position')
  const index = geometry.getIndex()
  const count = index ? index.count : position.count
  const at = (i: number) => (index ? index.getX(i) : i)
  let total = 0
  for (let i = 0; i < count; i += 3) {
    const [a, b, c] = [at(i), at(i + 1), at(i + 2)]
    const ax = position.getX(a)
    const az = position.getZ(a)
    total += Math.abs(
      ((position.getX(b) - ax) * (position.getZ(c) - az) -
        (position.getX(c) - ax) * (position.getZ(b) - az)) /
        2,
    )
  }
  return total
}

function setup(regions: ZoneNode['ceiling']) {
  const zone = ZoneNode.parse({
    id: 'zone_room',
    name: 'Room',
    polygon: square(0, 0, 4),
    ceiling: regions,
  })
  const ceiling = CeilingNode.parse({
    id: 'ceiling_room',
    polygon: square(0, 0, 4),
    boundary: 'auto',
    zoneId: zone.id,
    height: 2.5,
  })
  const base = new MeshBasicMaterial()
  const mesh = new Mesh(undefined, base)
  const byFinish = new Map<string, Material>()
  const resolve: CeilingRegionMaterial = (finish) => {
    const key = String(finish)
    if (!byFinish.has(key)) byFinish.set(key, new MeshBasicMaterial())
    return byFinish.get(key)!
  }
  mesh.userData.ceilingRegionMaterial = resolve
  const nodes = { [zone.id]: zone, [ceiling.id]: ceiling } as Record<string, AnyNode>
  return { zone, ceiling, mesh, base, nodes, byFinish }
}

const regionMeshes = (mesh: Mesh) =>
  mesh.children.filter((child) => child.name === CEILING_REGION_MESH) as Mesh[]

test('a room ceiling draws its painted parts as single-material meshes cut out of its own', () => {
  const { ceiling, mesh, base, nodes, byFinish } = setup({
    regions: [
      { id: 'left', polygon: square(0, 0, 2), finish: 'library:blue' },
      { id: 'right', polygon: square(2, 2, 2), finish: 'library:blue' },
      { id: 'over', polygon: square(1, 1, 2), finish: 'library:red' },
    ],
  })
  updateCeilingGeometry(ceiling, mesh, [], nodes)

  const regions = regionMeshes(mesh)
  expect(regions.map((region) => region.userData.paintRole).sort()).toEqual([
    'region:left',
    'region:over',
    'region:right',
  ])
  for (const region of regions) {
    // One material each — never an array — so batching buckets it by material.
    expect(Array.isArray(region.material)).toBe(false)
    expect(region.userData.__fromGeometry).toBe(true)
  }
  // Equal finishes share one material instance.
  expect(byFinish.size).toBe(2)
  const byRole = new Map(regions.map((region) => [region.userData.paintRole, region]))
  expect(byRole.get('region:left')!.material).toBe(byRole.get('region:right')!.material)
  // `over` (later) wins its whole square; the others keep what it leaves.
  expect(planArea(byRole.get('region:over')!.geometry)).toBeCloseTo(4)
  expect(planArea(byRole.get('region:left')!.geometry)).toBeCloseTo(3)
  expect(planArea(byRole.get('region:right')!.geometry)).toBeCloseTo(3)
  // The ceiling's own mesh keeps its own material and only the unpainted rest.
  expect(mesh.material).toBe(base)
  expect(mesh.userData.paintRole).toBe('surface')
  expect(planArea(mesh.geometry)).toBeCloseTo(16 - 10)
})

test('removing the regions gives the whole underside back to the ceiling', () => {
  const { zone, ceiling, mesh, nodes } = setup({
    regions: [{ id: 'left', polygon: square(0, 0, 2), finish: 'library:blue' }],
  })
  updateCeilingGeometry(ceiling, mesh, [], nodes)
  expect(regionMeshes(mesh)).toHaveLength(1)
  updateCeilingGeometry(ceiling, mesh, [], { ...nodes, [zone.id]: { ...zone, ceiling: undefined } })
  expect(regionMeshes(mesh)).toHaveLength(0)
  expect(planArea(mesh.geometry)).toBeCloseTo(16)
})

test('a manual ceiling draws its own regions, clipped by its holes', () => {
  const manual = CeilingNode.parse({
    id: 'ceiling_manual',
    polygon: square(0, 0, 4),
    holes: [square(0, 0, 1)],
    height: 2.5,
    regions: [{ id: 'own', polygon: square(0, 0, 2), finish: 'library:green' }],
  })
  const mesh = new Mesh(undefined, new MeshBasicMaterial())
  updateCeilingGeometry(manual, mesh, [], { [manual.id]: manual } as Record<string, AnyNode>)
  const [region] = regionMeshes(mesh)
  expect(region?.userData.paintRole).toBe('region:own')
  expect(planArea(region!.geometry)).toBeCloseTo(3)
  expect(planArea(mesh.geometry)).toBeCloseTo(12)
})
