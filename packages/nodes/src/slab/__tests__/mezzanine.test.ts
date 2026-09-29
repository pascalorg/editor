import { expect, test } from 'bun:test'
import type { AnyNode, GeometryContext } from '@pascal-app/core'
import { type Mesh, Raycaster, Vector3 } from 'three'
import { mezzanineFixture } from '../../../../core/src/lib/__fixtures__/mezzanine'
import { buildSlabGeometry } from '../geometry'

test('mezzanine renders its authored underside, thin edge and railing without platform fill', () => {
  const { nodes, plate, level } = mezzanineFixture()
  const ctx: GeometryContext = {
    parent: nodes[level.id],
    siblings: Object.values(nodes),
    children: [],
    resolve: <N = AnyNode>(id: string) => nodes[id] as N | undefined,
    levelBaseAt: () => -0.5,
  }
  const group = buildSlabGeometry(plate, ctx, 'solid', false)
  group.updateMatrixWorld(true)
  const underside = group.children.find((n) => n.userData.slotId === 'underside') as Mesh
  expect(underside).toBeDefined()
  underside.geometry.computeBoundingBox()
  expect(underside.geometry.boundingBox!.min.y).toBeCloseTo(2.3)
  expect(underside.geometry.boundingBox!.max.y).toBeCloseTo(2.3)
  expect(group.children.some((n) => n.userData.slotId === 'riser')).toBe(false)
  const ray = new Raycaster(new Vector3(2, 1, 2), new Vector3(0, 1, 0))
  expect(ray.intersectObject(group)[0]!.point.y).toBeCloseTo(2.3)
  ray.set(new Vector3(5, 2.4, 2), new Vector3(-1, 0, 0))
  const edgeHit = ray.intersectObject(group)[0]!
  expect(edgeHit.point.x).toBeCloseTo(4)
  expect(edgeHit.object.userData.slotId).toBe('edge')
  ray.set(new Vector3(5, 1, 2), new Vector3(-1, 0, 0))
  expect(ray.intersectObject(group)).toHaveLength(0)
  ray.set(new Vector3(5, 3.58, 2), new Vector3(-1, 0, 0))
  expect(ray.intersectObject(group)[0]!.point.x).toBeCloseTo(4, 1)
  for (const mesh of group.children as Mesh[]) mesh.geometry.dispose()
})

test('mezzanine finish is confined to its own top; host floor stays visible underneath', () => {
  const { nodes, plate, level, zone } = mezzanineFixture()
  const finished = { ...nodes, [zone.id]: { ...zone, floor: { ...zone.floor, finish: 'wood' } } }
  const ctx: GeometryContext = {
    parent: nodes[level.id],
    siblings: Object.values(finished),
    children: [],
    resolve: <N = AnyNode>(id: string) => finished[id] as N | undefined,
  }
  for (const slab of Object.values(nodes).filter((n) => n.type === 'slab')) {
    const group = buildSlabGeometry(slab, ctx, 'solid', false)
    expect(group.children.some((n) => n.userData.slotId === `room:${zone.id}`)).toBe(
      slab.id === plate.id,
    )
    const ray = new Raycaster(new Vector3(2, slab.elevation + 0.01, 2), new Vector3(0, -1, 0))
    group.updateMatrixWorld(true)
    expect(ray.intersectObject(group)[0]!.point.y).toBeCloseTo(slab.elevation)
    for (const mesh of group.children as Mesh[]) mesh.geometry.dispose()
  }
})
