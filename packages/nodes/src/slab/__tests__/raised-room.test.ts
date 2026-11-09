import { expect, test } from 'bun:test'
import type { AnyNode, GeometryContext, SlabNode } from '@pascal-app/core'
import { reconcileStructureOnLoad } from '@pascal-app/core/scene-migrations'
import { type Mesh, Raycaster, Vector3 } from 'three'
import { raisedRoomFixture } from '../../../../core/src/systems/slab/__fixtures__/raised-room'
import { buildSlabGeometry } from '../geometry'

for (const terrain of [false, true])
  test(`raised room uses a clear platform over the structural base: terrain=${terrain}`, () => {
    const fixture = raisedRoomFixture(false, terrain)
    const nodes = reconcileStructureOnLoad(fixture.nodes).nodes
    const slabs = Object.values(nodes).filter((n): n is SlabNode => n.type === 'slab')
    const base = slabs.find((s) => s.plateRole === 'base')!
    const platform = slabs.find((s) => s.plateRole === 'platform')!
    expect(platform.elevation).toBe(0.6)
    expect(platform.thickness).toBeCloseTo(platform.elevation - base.elevation)
    expect(platform.fillToTerrain).toBe(false)
    const ctx: GeometryContext = {
      parent: nodes[fixture.level.id]!,
      resolve: (id) => nodes[id],
      siblings: slabs,
      children: [],
    }
    const group = buildSlabGeometry(platform, ctx, 'solid', false)
    group.updateMatrixWorld(true)
    const top = new Raycaster(new Vector3(2, 1, 2), new Vector3(0, -1, 0)).intersectObject(
      group,
    )[0]!
    expect(top.point.y).toBeCloseTo(0.6)
    expect(
      new Raycaster(new Vector3(2, 0.5, -0.2), new Vector3(0, 0, 1), 0, 0.25).intersectObject(
        group,
      ),
    ).toHaveLength(0)
    for (const mesh of group.children as Mesh[]) mesh.geometry.dispose()
  })

for (const fillToTerrain of [false, true])
  test(`flush plates over depressed terrain retain opt-in fill: ${fillToTerrain}`, () => {
    const { nodes, slabs, level } = raisedRoomFixture()
    const slab = { ...slabs[0]!, elevation: 0.05, fillToTerrain }
    nodes[slab.id] = slab
    const ctx: GeometryContext = {
      resolve: <N = AnyNode>(id: string) => nodes[id] as N | undefined,
      parent: level,
      siblings: [slab],
      children: [],
      levelBaseAt: () => -0.4,
    }
    // The opt-in legacy fill reads persisted terrain from the ancestry.
    const site = Object.values(nodes).find((node) => node.type === 'site')!
    const { createTerrainField, encodeTerrainField } = require('@pascal-app/core')
    const field = createTerrainField({ origin: [-1, -1], cols: 12, rows: 8, spacing: 1 })
    field.heights.fill(-40)
    nodes[site.id] = { ...site, terrain: encodeTerrainField(field) }
    const group = buildSlabGeometry(slab, ctx, 'solid', false)
    expect(group.children.some((child) => child.userData.slotId === 'underside')).toBe(true)
    const bottoms = (group.children as Mesh[]).map((mesh) => {
      mesh.geometry.computeBoundingBox()
      return mesh.geometry.boundingBox!.min.y
    })
    expect(Math.min(...bottoms)).toBeCloseTo(fillToTerrain ? -0.4 : 0)
    for (const mesh of group.children as Mesh[]) mesh.geometry.dispose()
  })
