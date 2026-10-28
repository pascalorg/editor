import { beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  clearPlateSurfaceCaches,
  DEFAULT_FLOOR_BUILD_UP,
  FLOOR_BUILD_UP_PRESETS,
  type FloorBuildUp,
  floorBuildUpPatch,
  floorLayerDepths,
  type GeometryContext,
  LevelNode,
  SiteNode,
  SlabNode,
  ZoneNode,
} from '@pascal-app/core'
import { type Group, Mesh } from 'three'
import { buildSlabGeometry, slabFramingCavity } from '../geometry'

const SQUARE: Array<[number, number]> = [
  [0, 0],
  [4, 0],
  [4, 4],
  [0, 4],
]

/**
 * A building of two storeys with a 4 m square room on `levelId` and its floor plate framed with
 * `buildUp` (the thickness its layers sum to, unless `thickness` says otherwise). `manual` draws
 * the floor as a hand-drawn slab instead of the room's plate.
 */
function scene(
  buildUp: FloorBuildUp,
  options: { levelId?: 'level_0' | 'level_1'; thickness?: number; manual?: boolean } = {},
) {
  const levelId = options.levelId ?? 'level_1'
  const site = SiteNode.parse({ id: 'site_1', children: ['building_1'] })
  const building = BuildingNode.parse({
    id: 'building_1',
    parentId: site.id,
    children: ['level_0', 'level_1'],
  })
  const zone = ZoneNode.parse({
    id: 'zone_room',
    parentId: levelId,
    name: 'Room',
    polygon: SQUARE,
    spaceRole: 'room',
  })
  const patch = floorBuildUpPatch(buildUp)
  const plate = SlabNode.parse({
    id: 'slab_floor',
    parentId: levelId,
    ...(options.manual
      ? { autoFromWalls: false }
      : { boundary: 'auto', autoFromWalls: true, zoneIds: [zone.id] }),
    elevation: 0.05,
    ...patch,
    thickness: options.thickness ?? patch.thickness,
    polygon: SQUARE,
  })
  const levels = (['level_0', 'level_1'] as const).map((id, level) =>
    LevelNode.parse({
      id,
      parentId: building.id,
      level,
      height: 2.7,
      children: id === levelId ? [zone.id, plate.id] : [],
    }),
  )
  const nodes: Record<string, AnyNode> = { [site.id]: site, [building.id]: building }
  for (const node of [...levels, zone, plate]) nodes[node.id] = node
  const ctx: GeometryContext = {
    resolve: <N = AnyNode>(id: AnyNodeId) => nodes[id] as N | undefined,
    children: [],
    siblings: [],
    parent: nodes[levelId] as AnyNode,
  }
  return { plate, ctx }
}

type Face = {
  slotId: string
  minY: number
  maxY: number
  normal: [number, number, number]
  /** The triangle's centre in plan. */
  centre: [number, number]
}

function faces(group: Group): Face[] {
  const out: Face[] = []
  for (const mesh of group.children) {
    if (!(mesh instanceof Mesh)) continue
    const position = mesh.geometry.getAttribute('position')
    const index = mesh.geometry.getIndex()
    const count = (index ? index.count : position.count) / 3
    for (let triangle = 0; triangle < count; triangle += 1) {
      const [a, b, c] = [0, 1, 2].map((corner) => {
        const i = index ? index.getX(triangle * 3 + corner) : triangle * 3 + corner
        return [position.getX(i), position.getY(i), position.getZ(i)] as const
      }) as [readonly number[], readonly number[], readonly number[]]
      const ab = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!]
      const ac = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!]
      const n: [number, number, number] = [
        ab[1]! * ac[2]! - ab[2]! * ac[1]!,
        ab[2]! * ac[0]! - ab[0]! * ac[2]!,
        ab[0]! * ac[1]! - ab[1]! * ac[0]!,
      ]
      const length = Math.hypot(...n)
      if (length < 1e-12) continue
      out.push({
        slotId: mesh.userData.slotId as string,
        minY: Math.min(a[1]!, b[1]!, c[1]!),
        maxY: Math.max(a[1]!, b[1]!, c[1]!),
        normal: n.map((value) => value / length) as [number, number, number],
        centre: [(a[0]! + b[0]! + c[0]!) / 3, (a[2]! + b[2]! + c[2]!) / 3],
      })
    }
  }
  return out
}

/** The horizontal faces' planes, `up@y` or `down@y`, sorted from the top. */
function caps(list: readonly Face[]): string[] {
  const planes = new Map<string, number>()
  for (const face of list) {
    if (Math.abs(face.normal[1]) < 0.5) continue
    const key = `${face.normal[1] > 0 ? 'up' : 'down'}@${face.maxY.toFixed(4)}`
    planes.set(key, face.maxY)
  }
  return [...planes].sort((a, b) => b[1] - a[1]).map(([key]) => key)
}

const at = (direction: 'up' | 'down', y: number) => `${direction}@${y.toFixed(4)}`

/** The lowest and highest point of `list`. */
function span(list: readonly Face[]) {
  return {
    bottom: Math.min(...list.map((face) => face.minY)),
    top: Math.max(...list.map((face) => face.maxY)),
  }
}

describe('a floor framed inside its plate, the frame shown', () => {
  beforeEach(() => clearPlateSurfaceCaches())

  test('opens its joist band between the subfloor and the ceiling, closed all round', () => {
    const { plate, ctx } = scene(DEFAULT_FLOOR_BUILD_UP)
    const { flooring, sheathing, ceiling } = floorLayerDepths(DEFAULT_FLOOR_BUILD_UP)
    const top = plate.elevation
    const soffit = plate.elevation - plate.thickness
    const band = { top: top - flooring - sheathing, bottom: soffit + ceiling }
    const cavity = slabFramingCavity(plate, ctx)
    expect(cavity?.top).toBeCloseTo(band.top, 9)
    expect(cavity?.bottom).toBeCloseTo(band.bottom, 9)
    expect(cavity?.ceiling).toBe(true)

    const closed = faces(buildSlabGeometry(plate, ctx, 'rendered', true, 'clay', undefined, false))
    expect(caps(closed)).toEqual([at('up', top), at('down', soffit)])

    const open = faces(buildSlabGeometry(plate, ctx, 'rendered', true, 'clay', undefined, true))
    // the floor, the subfloor's underside, the ceiling's top, the ceiling
    expect(caps(open)).toEqual([
      at('up', top),
      at('down', band.top),
      at('up', band.bottom),
      at('down', soffit),
    ])
    // the band's faces draw in the plate's underside slot
    expect(
      new Set(
        open
          .filter((face) => Math.abs(face.normal[1]) > 0.5 && face.maxY < band.top + 1e-6)
          .filter((face) => face.maxY > band.bottom - 1e-6)
          .map((face) => face.slotId),
      ),
    ).toEqual(new Set(['underside']))
    // outside, the rim closes the whole thickness; inside, the band's faces turn in, toward the
    // middle of the square
    const vertical = open.filter((face) => Math.abs(face.normal[1]) < 1e-3)
    const outward = vertical.filter((face) => face.slotId !== 'underside')
    const inward = vertical.filter((face) => face.slotId === 'underside')
    expect(outward.length).toBeGreaterThan(0)
    expect(inward.length).toBeGreaterThan(0)
    expect(span(outward).bottom).toBeCloseTo(soffit, 6)
    expect(span(outward).top).toBeCloseTo(top, 6)
    expect(span(inward).bottom).toBeCloseTo(band.bottom, 6)
    expect(span(inward).top).toBeCloseTo(band.top, 6)
    const towardMiddle = (face: Face) =>
      face.normal[0] * (2 - face.centre[0]) + face.normal[2] * (2 - face.centre[1]) > 0
    expect(inward.every(towardMiddle)).toBe(true)
    expect(outward.some(towardMiddle)).toBe(false)
    // all four sides of the square
    expect(
      new Set(inward.map((face) => `${Math.round(face.normal[0])},${Math.round(face.normal[2])}`)),
    ).toEqual(new Set(['1,0', '-1,0', '0,1', '0,-1']))
  })

  test('with no ceiling under the joists the band opens to the room below', () => {
    const exposed = FLOOR_BUILD_UP_PRESETS.find((preset) => preset.id === 'exposed-2x10-16')!
    const { plate, ctx } = scene(exposed.buildUp)
    const { flooring, sheathing } = floorLayerDepths(exposed.buildUp)
    const top = plate.elevation
    const soffit = plate.elevation - plate.thickness
    expect(slabFramingCavity(plate, ctx)?.ceiling).toBe(false)
    const open = faces(buildSlabGeometry(plate, ctx, 'rendered', true, 'clay', undefined, true))
    // no underside: the joists show from below, the subfloor over them
    expect(caps(open)).toEqual([at('up', top), at('down', top - flooring - sheathing)])
    // the rim still closes the band from outside, down to the joists' bottom
    const outward = open.filter(
      (face) => Math.abs(face.normal[1]) < 1e-3 && face.slotId !== 'underside',
    )
    expect(span(outward).bottom).toBeCloseTo(soffit, 6)
  })

  test('a hand-drawn slab framed the same opens too, its band in the side slot', () => {
    const { plate, ctx } = scene(DEFAULT_FLOOR_BUILD_UP, { manual: true })
    const open = faces(buildSlabGeometry(plate, ctx, 'rendered', true, 'clay', undefined, true))
    const { flooring, sheathing } = floorLayerDepths(DEFAULT_FLOOR_BUILD_UP)
    expect(caps(open)).toContain(at('down', plate.elevation - flooring - sheathing))
    expect(new Set(open.map((face) => face.slotId))).toEqual(new Set(['surface', 'side']))
  })

  test('a lowest storey, a plate not its layers and a sunken plate stay solid', () => {
    const cases = [
      scene(DEFAULT_FLOOR_BUILD_UP, { levelId: 'level_0' }),
      scene(DEFAULT_FLOOR_BUILD_UP, { thickness: 0.2 }),
    ]
    const { plate: sunkenPlate, ctx: sunkenCtx } = scene(DEFAULT_FLOOR_BUILD_UP)
    cases.push({ plate: { ...sunkenPlate, plateRole: 'sunken' } as SlabNode, ctx: sunkenCtx })
    for (const { plate, ctx } of cases) {
      expect(slabFramingCavity(plate, ctx)).toBeNull()
      const open = faces(buildSlabGeometry(plate, ctx, 'rendered', true, 'clay', undefined, true))
      const closed = faces(
        buildSlabGeometry(plate, ctx, 'rendered', true, 'clay', undefined, false),
      )
      expect(caps(open)).toEqual(caps(closed))
      expect(open.length).toBe(closed.length)
    }
  })
})
