import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { automaticFloorHeight } from '../lib/floor-foundation-datum'
import { getOpeningFloorDatum, wallSupportForNodes } from '../lib/opening-floor-datum'
import { type AnyNode, LevelNode, SlabNode, WallNode } from '../schema'
import { getWallPlaneTop } from '../services/storey'
import { resolveWallTop } from '../systems/wall/wall-top'
import { preserveLegacyWallDatums } from './legacy-wall-datums'
import * as migrations from './scene-migrations'

function load(source: Record<string, unknown>) {
  const vertical = migrations.migrateVerticalSceneNodes(
    migrations.healSceneNodes(migrations.normalizeLegacyStructure(source)).nodes,
  ).nodes
  const rooms = migrations.migrateRoomZones(vertical).nodes
  const plates = migrations.migrateFloorPlates(
    migrations.migrateCeilingRoomLinks(rooms).nodes,
  ).nodes
  const openings = migrations.ensureSceneOpenings(migrations.migrateSlabSlots(plates).nodes).nodes
  const walls = migrations.migrateWallFaceBands(
    migrations.migrateWallFaceKeys(openings).nodes,
  ).nodes
  return migrations.reconcileStructureOnLoad(walls, vertical).nodes
}
for (const id of ['scene-26', 'scene-07', 'scene-17', 'scene-24', 'scene-06']) {
  test(`${id}: migration is identical on its second load`, () => {
    const raw = JSON.parse(
      readFileSync(
        new URL(`../lib/__fixtures__/plate-corpus/review/${id}.json`, import.meta.url),
        'utf8',
      ),
    )
    const first = load(raw)
    expect(load(first)).toEqual(first)
    expect(
      Object.values(first).filter((node) => node.type === 'slab' && node.floorHeight !== undefined),
    ).toEqual([])
    for (const plate of Object.values(first))
      if (plate.type === 'slab' && plate.plateRole === 'base')
        expect(automaticFloorHeight(first, plate)).toBeCloseTo(plate.elevation, 6)
    if (id === 'scene-17') {
      const wall = first.wall_n1xa0800aqmazoar as WallNode
      expect(
        resolveWallTop(
          wall,
          getWallPlaneTop(wall, wall.parentId!, first),
          wallSupportForNodes(wall, first).elevation,
        ),
      ).toBeCloseTo(2.5)
    }
    if (id === 'scene-24') {
      const opening = first.window_drbs0ipvpb9ksir3
      if (opening?.type !== 'window') throw new Error('Missing window')
      const wall = first[opening.parentId!] as WallNode
      expect(
        getOpeningFloorDatum(wall, opening, first) + opening.position[1] - opening.height / 2,
      ).toBeCloseTo(0.2)
      // The footprint keeps its legacy floor, so the wall does not move and the
      // window needs no wall anchoring to keep its sill.
      expect(opening.verticalAnchor).toBeUndefined()
    }
    if (id === 'scene-07') {
      const wall = first.wall_1cs12gkft1qbcunm as WallNode
      expect(
        resolveWallTop(
          wall,
          getWallPlaneTop(wall, wall.parentId!, first),
          wallSupportForNodes(wall, first).elevation,
        ),
      ).toBeCloseTo(4.49)
    }
    const rejected = id === 'scene-06' ? ['door_sewdhekqvtodswrn'] : []
    for (const openingId of rejected) {
      const opening = first[openingId]
      if (opening?.type !== 'door') throw new Error('Missing door')
      expect(opening.verticalAnchor).toBe('wall')
      for (const height of [undefined, 3, 5]) {
        const wall = { ...(first[opening.parentId!] as WallNode), height }
        const edited = { ...first, [wall.id]: wall }
        expect(
          getOpeningFloorDatum(wall, opening, edited) + opening.position[1] - opening.height / 2,
        ).toBeCloseTo(0.05, 6)
      }
    }
  }, 20_000)
}

test('legacy bands and authored paint regions both retain their world heights', () => {
  const level = LevelNode.parse({ id: 'level_p', children: ['wall_p', 'slab_p'] })
  const wall = WallNode.parse({
    id: 'wall_p',
    parentId: level.id,
    start: [0, 0],
    end: [4, 0],
    height: 2.5,
    faceRegions: [{ id: 'paint', face: 'a', v0: 0.2, v1: 0.8, finish: 'library:paint' }],
  })
  const slab = SlabNode.parse({
    id: 'slab_p',
    parentId: level.id,
    polygon: [
      [-1, -1],
      [5, -1],
      [5, 1],
      [-1, 1],
    ],
    elevation: 0.55,
  })
  const before: Record<string, AnyNode> = { [level.id]: level, [wall.id]: wall, [slab.id]: slab }
  const converted = migrations.migrateWallFaceBands({
    ...before,
    [wall.id]: {
      ...wall,
      faceBands: { enabled: true, count: 2, lowerHeight: 0.84 },
      slots: { aLower: 'library:band' },
    },
  }).nodes as Record<string, AnyNode>
  const nodes = preserveLegacyWallDatums(before, {
    ...converted,
    [level.id]: { ...level, metadata: { floorOwnershipMigrated: true } },
    [slab.id]: {
      ...slab,
      elevation: 0.05,
      floorHeight: 0.05,
      plateRole: 'base',
      autoFromWalls: true,
    },
  })
  const current = nodes[wall.id] as WallNode
  const support = wallSupportForNodes(current, nodes).elevation
  expect(support).toBeCloseTo(0.55)
  const paint = current.faceRegions!.find((region) => region.id === 'paint')!
  const band = current.faceRegions!.find((region) => region.finish === 'library:band')!
  expect(paint.v0! + support).toBeCloseTo(0.75, 6)
  expect(paint.v1! + support).toBeCloseTo(1.35, 6)
  expect(band.v1! + support).toBeCloseTo(1.39, 6)
  expect(preserveLegacyWallDatums(nodes, nodes)).toEqual(nodes)
})
