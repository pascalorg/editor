import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  BuildingNode,
  createTerrainField,
  encodeTerrainField,
  type GeometryContext,
  LevelNode,
  SiteNode,
  SlabNode,
} from '@pascal-app/core'
import { slabDefinition } from '@pascal-app/nodes'
import { Mesh, Object3D, Raycaster, Vector3 } from 'three'

// Foundation top 1.05 minus reference .05 is a 1 m construction lift.
// A terrain-draped path on datum ground keeps its .03 m clearance instead;
// the legacy flat path still receives that existing construction translation.
describe('draped geometry inside a raised foundation footprint', () => {
  for (const courtyard of [false, true]) {
    for (const terrainMode of ['draped', 'flat'] as const) {
      test(`${terrainMode} top with courtyard=${courtyard}`, async () => {
        const site = SiteNode.parse({
          id: 'site_foundation',
          children: ['building_foundation'],
          terrain: encodeTerrainField(createTerrainField({ cols: 9, rows: 9, spacing: 1 })),
        })
        const building = BuildingNode.parse({
          id: 'building_foundation',
          parentId: site.id,
          children: ['level_foundation'],
        })
        const level = LevelNode.parse({
          id: 'level_foundation',
          parentId: building.id,
          level: 0,
          height: 3,
          children: ['slab_base', 'slab_path'],
        })
        const base = SlabNode.parse({
          id: 'slab_base',
          parentId: level.id,
          polygon: [
            [0, 0],
            [4, 0],
            [4, 4],
            [0, 4],
          ],
          holes: courtyard
            ? [
                [
                  [0.5, 0.5],
                  [3.5, 0.5],
                  [3.5, 3.5],
                  [0.5, 3.5],
                ],
              ]
            : [],
          plateRole: 'base',
          floorHeight: 1.05,
          referenceFloorElevation: 0.05,
          elevation: 1.05,
        })
        const path = SlabNode.parse({
          id: 'slab_path',
          parentId: level.id,
          polygon: [
            [1, 1],
            [3, 1],
            [3, 3],
            [1, 3],
          ],
          terrainMode,
          elevation: 0.03,
          thickness: 0.05,
          autoFromWalls: false,
          metadata: { flatwork: 'walk' },
        })
        const nodes: Record<string, AnyNode> = Object.fromEntries(
          [site, building, level, base, path].map((node) => [node.id, node]),
        )
        const context = {
          resolve: <N = AnyNode>(id: string) => nodes[id] as N | undefined,
          parent: level,
          children: [],
          siblings: [base],
        } satisfies GeometryContext
        const build = slabDefinition.geometry
        if (!build) throw new Error('The slab definition has no geometry builder')
        const geometry = await build(path, context, 'solid', false)
        if (!(geometry instanceof Object3D)) throw new Error('The slab has no rendered geometry')
        try {
          geometry.updateMatrixWorld(true)
          const ray = new Raycaster(new Vector3(2, 10, 2), new Vector3(0, -1, 0))
          const top = ray.intersectObject(geometry, true)[0]
          if (!top) throw new Error('The path has no rendered top at its centre')
          expect(top.point.y).toBeCloseTo(terrainMode === 'draped' ? 0.03 : 1.03, 5)
          expect(path.elevation).toBe(0.03)
        } finally {
          geometry.traverse((object) => {
            if (!(object instanceof Mesh)) return
            object.geometry.dispose()
            for (const material of Array.isArray(object.material)
              ? object.material
              : [object.material]) {
              material.dispose()
            }
          })
        }
      })
    }
  }
})
