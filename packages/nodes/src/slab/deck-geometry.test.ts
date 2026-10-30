import { beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  clearPlateSurfaceCaches,
  type GeometryContext,
  LevelNode,
  SiteNode,
  SlabNode,
  WallNode,
  ZoneNode,
} from '@pascal-app/core'
import { Box3, type Group, Mesh, type MeshStandardMaterial } from 'three'
import { buildSlabGeometry } from './geometry'

const IN = 0.0254
const FT = 12 * IN
const TOP = 0.6
const WOOD = 'library:wood-woodplank48'

/** A 16 × 12 ft deck room off the house's rear wall (z = 0, 0.2 thick), its plate 1 in down. */
function deckScene(decking?: ZoneNode['decking'], buildingY = 0, painted?: string) {
  const wall = WallNode.parse({
    id: 'wall_rear',
    parentId: 'level_1',
    start: [-2, 0],
    end: [8, 0],
    thickness: 0.2,
    height: 2.7,
  })
  const outline: Array<[number, number]> = [
    [0, 0.1],
    [16 * FT, 0.1],
    [16 * FT, 0.1 + 12 * FT],
    [0, 0.1 + 12 * FT],
  ]
  const zone = ZoneNode.parse({
    id: 'zone_deck',
    parentId: 'level_1',
    name: 'Deck',
    polygon: outline,
    spaceRole: 'room',
    roomType: 'deck',
    floor: {
      finish: WOOD,
      drop: IN,
      ...(painted
        ? {
            regions: [
              {
                id: 'region_1',
                finish: painted,
                polygon: [
                  [1, 1],
                  [3, 1],
                  [3, 2.5],
                  [1, 2.5],
                ],
              },
            ],
          }
        : {}),
    },
    ...(decking ? { decking } : {}),
  })
  const plate = SlabNode.parse({
    id: 'slab_deck',
    parentId: 'level_1',
    boundary: 'auto',
    autoFromWalls: true,
    plateRole: 'sunken',
    zoneIds: [zone.id],
    elevation: TOP,
    thickness: 0.15,
    polygon: outline,
  })
  const site = SiteNode.parse({ id: 'site_1', children: ['building_1'] })
  const building = BuildingNode.parse({
    id: 'building_1',
    parentId: site.id,
    children: ['level_1'],
    position: [0, buildingY, 0],
  })
  const level = LevelNode.parse({
    id: 'level_1',
    parentId: building.id,
    level: 0,
    height: 2.7,
    children: [wall.id, zone.id, plate.id],
  })
  const nodes: Record<string, AnyNode> = {
    [site.id]: site,
    [building.id]: building,
    [level.id]: level,
    [wall.id]: wall,
    [zone.id]: zone,
    [plate.id]: plate,
  }
  const ctx: GeometryContext = {
    resolve: <N = AnyNode>(id: AnyNodeId) => nodes[id] as N | undefined,
    children: [],
    siblings: [],
    parent: level,
  }
  return { plate, ctx }
}

const meshes = (group: Group) =>
  group.children.filter((child): child is Mesh => child instanceof Mesh)
const boxOf = (mesh: Mesh) =>
  new Box3().setFromBufferAttribute(mesh.geometry.getAttribute('position') as never)
/** The plan area the upward faces at `y` cover. */
function topArea(mesh: Mesh, y: number): number {
  const position = mesh.geometry.getAttribute('position')
  const index = mesh.geometry.getIndex()!
  let total = 0
  for (let i = 0; i < index.count; i += 3) {
    const [a, b, c] = [index.getX(i), index.getX(i + 1), index.getX(i + 2)]
    if ([a, b, c].some((v) => Math.abs(position.getY(v) - y) > 1e-6)) continue
    const twice =
      (position.getX(b) - position.getX(a)) * (position.getZ(c) - position.getZ(a)) -
      (position.getX(c) - position.getX(a)) * (position.getZ(b) - position.getZ(a))
    if (twice < 0) total += -twice / 2
  }
  return total
}

describe('a deck room draws boards on a frame, not a slab', () => {
  beforeEach(() => clearPlateSurfaceCaches())

  test('its boards: the room finish and paint role, their top the floor top, gaps between them', () => {
    const { plate, ctx } = deckScene()
    const group = buildSlabGeometry(plate, ctx, 'rendered', true)
    const boards = meshes(group).filter((mesh) => typeof mesh.userData.paintRole === 'string')
    expect(boards).toHaveLength(1)
    const [deck] = boards as [Mesh]
    expect(deck.userData.paintRole).toBe('room:zone_deck')
    const box = boxOf(deck)
    expect(box.max.y).toBeCloseTo(TOP, 6)
    expect(box.min.y).toBeCloseTo(TOP - IN, 6)
    const full = 16 * FT * 12 * FT
    const covered = topArea(deck, TOP) / full
    expect(covered).toBeGreaterThan(0.94)
    expect(covered).toBeLessThan(0.97)
  })

  test('its frame: treated wood under the boards down to the ground on posts, a concrete pier under each, never the framing plugin’s green', () => {
    const { plate, ctx } = deckScene()
    const group = buildSlabGeometry(plate, ctx, 'rendered', true)
    const frame = meshes(group).filter((mesh) => mesh.userData.paintRole === undefined)
    expect(frame).toHaveLength(2)
    const [lumber, piers] = frame as [Mesh, Mesh]
    const wood = boxOf(lumber)
    expect(wood.max.y).toBeCloseTo(TOP - IN, 6)
    expect(wood.min.y).toBeCloseTo(0, 6)
    // the boards overhang the rims an inch on the free edges, none past the deck
    expect(wood.min.x).toBeCloseTo(IN, 6)
    expect(wood.max.x).toBeCloseTo(16 * FT - IN, 6)
    expect(wood.min.z).toBeCloseTo(0.1, 6)
    const concrete = boxOf(piers)
    expect(concrete.min.y).toBeLessThan(0)
    expect(concrete.max.y).toBeGreaterThan(0)
    for (const mesh of frame) {
      const color = (mesh.material as MeshStandardMaterial).color?.getHexString()
      expect(color).not.toBe('7d9d6a')
    }
  })

  test('its posts reach the ground wherever the house stands', () => {
    const { plate, ctx } = deckScene(undefined, 0.3)
    const group = buildSlabGeometry(plate, ctx, 'rendered', true)
    const lumber = meshes(group).find((mesh) => mesh.userData.paintRole === undefined)!
    expect(boxOf(lumber).min.y).toBeCloseTo(-0.3, 6)
  })

  test('the room’s boards: 2x6 stock 1 1/2 in thick, run out from the house', () => {
    const { plate, ctx } = deckScene({ boardSize: '2x6', direction: 'perpendicular' })
    const group = buildSlabGeometry(plate, ctx, 'rendered', true)
    const deck = meshes(group).find((mesh) => mesh.userData.paintRole === 'room:zone_deck')!
    expect(boxOf(deck).min.y).toBeCloseTo(TOP - 1.5 * IN, 6)
    const lumber = meshes(group).find((mesh) => mesh.userData.paintRole === undefined)!
    expect(boxOf(lumber).max.y).toBeCloseTo(TOP - 1.5 * IN, 6)
  })

  test('a painted part of the floor is its own boards, cut from the same rows', () => {
    const plain = buildSlabGeometry(deckScene().plate, deckScene().ctx, 'rendered', true)
    const { plate, ctx } = deckScene(undefined, 0, 'library:wood-woodfine2')
    const group = buildSlabGeometry(plate, ctx, 'rendered', true)
    const boards = meshes(group).filter((mesh) => typeof mesh.userData.paintRole === 'string')
    expect(boards.map((mesh) => mesh.userData.paintRole).sort()).toEqual([
      'room:zone_deck',
      'room:zone_deck/region_1',
    ])
    const total = boards.reduce((sum, mesh) => sum + topArea(mesh, TOP), 0)
    const before = meshes(plain)
      .filter((mesh) => typeof mesh.userData.paintRole === 'string')
      .reduce((sum, mesh) => sum + topArea(mesh, TOP), 0)
    expect(total).toBeCloseTo(before, 3)
  })
})
