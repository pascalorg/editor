import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  BuildingNode,
  buildingFoundationOf,
  createZone,
  DEFAULT_FLOOR_BUILD_UP,
  DEFAULT_RAISED_FLOOR_BUILD_UP,
  floorBuildUpThickness,
  generateId,
  initSpaceDetectionSync,
  LevelNode,
  resolveBuildingFoundation,
  type SlabNode,
  useScene,
} from '@pascal-app/core'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { applyBuildingFoundation } from '../../../lib/building-foundation'
import {
  applyFloorBuildUp,
  beginFootprintHeightPreview,
  editedFloorBuildUp,
  floorStructureAs,
  footprintHeightValue,
  levelFootprints,
  renameFloorLayer,
  switchFloorLayer,
} from '../../../lib/floor-footprints'
import { formatLayerThickness } from '../../../lib/layer-thickness'
import { applyRoomPlan } from '../../../lib/room-structure-commands'
import { installImmediateAnimationFrames } from '../../../test-utils/immediate-animation-frames'
import {
  FoundationSectionDrawing,
  floorSectionLayers,
  RaisedFloorFraming,
  slabEdgeTaperOf,
  stackLabels,
} from './building-foundation-section'
import { FloorPlateBuildUp, FloorSection } from './floor-foundation-panel'

const IN = 0.0254
const GROUND = 'level_build_up_ground'
const UPPER = 'level_build_up_upper'
const BUILDING = 'building_build_up'
let stop = () => {}
let restoreFrames = () => {}
const nodes = () => useScene.getState().nodes as Record<string, AnyNode>
const past = () => useScene.temporal.getState().pastStates.length
// Rendered text with its quotes back (the inch marks are escaped in markup).
const render = (element: Parameters<typeof renderToStaticMarkup>[0]) =>
  renderToStaticMarkup(element).replaceAll('&quot;', '"')

const rect = (x0: number, z0: number, x1: number, z1: number): [number, number][] => [
  [x0, z0],
  [x1, z0],
  [x1, z1],
  [x0, z1],
]
const room = (levelId: string, polygon: [number, number][], name: string) =>
  applyRoomPlan(createZone(nodes(), { levelId, polygon, enclose: true, mintId: generateId, name }))

beforeEach(() => {
  restoreFrames = installImmediateAnimationFrames()
  const building = BuildingNode.parse({ id: BUILDING, children: [GROUND, UPPER] })
  const ground = LevelNode.parse({ id: GROUND, parentId: building.id, level: 0, name: 'Ground floor' })
  const upper = LevelNode.parse({ id: UPPER, parentId: building.id, level: 1, name: 'Floor 1' })
  useScene.setState({
    nodes: { [building.id]: building, [ground.id]: ground, [upper.id]: upper },
    rootNodeIds: [building.id],
    dirtyNodes: new Set(),
    materials: {},
    collections: {},
    readOnly: false,
  })
  useScene.temporal.getState().resume()
  useScene.temporal.getState().clear()
  stop = initSpaceDetectionSync(useScene, { getState: () => ({ spaces: {}, setSpaces: () => {} }) })
  room(GROUND, rect(0, 0, 8, 5), 'Living')
  room(UPPER, rect(0, 0, 8, 5), 'Bedroom')
})
afterEach(() => {
  stop()
  restoreFrames()
})

const plateOf = (levelId: string, name: string) =>
  levelFootprints(nodes(), levelId).find((plate) =>
    plate.zoneIds?.some((id) => nodes()[id]?.name === name),
  ) as SlabNode
const bedroom = () => plateOf(UPPER, 'Bedroom')
const top = (plate: SlabNode) => plate.floorHeight ?? plate.elevation
const underside = (plate: SlabNode) => top(plate) - plate.thickness
/** The bedroom floor on the default build-up, history cleared. */
const framedBedroom = () => {
  expect(applyFloorBuildUp(bedroom().id, DEFAULT_FLOOR_BUILD_UP)).toBeNull()
  useScene.temporal.getState().clear()
  return bedroom()
}

describe('Floor build-up rows (the floor plate panel)', () => {
  test('a framed floor lists its layers top down, with the thickness they make', () => {
    const markup = render(
      createElement(FloorPlateBuildUp, {
        buildUp: DEFAULT_FLOOR_BUILD_UP,
        matches: true,
        onCommit: () => {},
        thickness: floorBuildUpThickness(DEFAULT_FLOOR_BUILD_UP),
        unit: 'imperial',
      }),
    )
    const order = ['flooring', 'sheathing', 'joists', 'ceiling'].map((layer) =>
      markup.indexOf(`data-floor-layer="${layer}"`),
    )
    expect(order.every((at) => at >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(markup).toContain('Hardwood on 2x12 @ 16"')
    expect(markup).toContain('Floor thickness 13-1/8"')
    // Every layer switches but the joists, which are always there.
    for (const layer of ['flooring', 'sheathing', 'ceiling'])
      expect(markup).toContain(`data-floor-layer-switch="${layer}"`)
    expect(markup).not.toContain('data-floor-layer-switch="joists"')
    // Unnamed, a layer's material reads as its kind.
    expect(markup).toMatch(/data-floor-layer-name="flooring"[^>]*placeholder="Hardwood"/)
    expect(markup).not.toContain('data-floor-build-up-follows')
  })

  test('an older plate shows the default layers and says its thickness follows them', () => {
    const markup = render(
      createElement(FloorPlateBuildUp, {
        buildUp: DEFAULT_FLOOR_BUILD_UP,
        matches: false,
        onCommit: () => {},
        thickness: 14 * IN,
        unit: 'imperial',
      }),
    )
    expect(markup).toContain('Floor thickness 14"')
    expect(markup).toContain('Its layers make 13-1/8"')
  })

  test('a layer switched off goes and lowers the floor, its underside held, in one undo step', () => {
    const plate = framedBedroom()
    expect(plate.thickness).toBeCloseTo(floorBuildUpThickness(DEFAULT_FLOOR_BUILD_UP), 6)
    const off = switchFloorLayer(plate.buildUp!, 'ceiling', false)
    expect(off.ceiling).toBeUndefined()
    expect(off.presetId).toBeUndefined()
    expect(applyFloorBuildUp(plate.id, off)).toBeNull()
    const after = bedroom()
    expect(after.buildUp?.ceiling).toBeUndefined()
    expect(after.thickness).toBeCloseTo(plate.thickness - 0.5 * IN, 6)
    expect(underside(after)).toBeCloseTo(underside(plate), 6)
    expect(top(after)).toBeCloseTo(top(plate) - 0.5 * IN, 6)
    expect(past()).toBe(1)
    // The row reads off.
    const markup = render(
      createElement(FloorPlateBuildUp, {
        buildUp: after.buildUp!,
        matches: true,
        onCommit: () => {},
        thickness: after.thickness,
        unit: 'imperial',
      }),
    )
    expect(markup).toMatch(/data-floor-layer="ceiling" data-on="false"/)
    expect(markup).toContain('Floor thickness 12-5/8"')
    // One undo takes back the layers and the thickness together.
    useScene.temporal.getState().undo()
    expect(bedroom().buildUp?.ceiling).toEqual(DEFAULT_FLOOR_BUILD_UP.ceiling)
    expect(bedroom().thickness).toBeCloseTo(plate.thickness, 6)
  })

  test('a layer switched back on is the default floor’s again', () => {
    const plate = framedBedroom()
    const off = switchFloorLayer(plate.buildUp!, 'sheathing', false)
    expect(applyFloorBuildUp(plate.id, off)).toBeNull()
    const on = switchFloorLayer(bedroom().buildUp!, 'sheathing', true)
    expect(on.sheathing).toEqual(DEFAULT_FLOOR_BUILD_UP.sheathing)
    expect(applyFloorBuildUp(plate.id, on)).toBeNull()
    expect(bedroom().thickness).toBeCloseTo(plate.thickness, 6)
  })

  test('a joist pick sets the depth: the top moves, the underside stays', () => {
    const plate = framedBedroom()
    const iJoists = editedFloorBuildUp(plate.buildUp!, {
      structure: floorStructureAs(plate.buildUp!.structure, 'i-joists'),
    })
    // The nearest I-joist to a 2x12.
    expect(iJoists.structure).toMatchObject({ system: 'i-joists', size: '11-7/8' })
    const fourteen = editedFloorBuildUp(iJoists, { structure: { ...iJoists.structure, size: '14' } })
    expect(applyFloorBuildUp(plate.id, fourteen)).toBeNull()
    const after = bedroom()
    expect(after.thickness).toBeCloseTo((13.125 - 11.25 + 14) * IN, 6)
    expect(underside(after)).toBeCloseTo(underside(plate), 6)
    expect(footprintHeightValue(nodes(), after)).toBeCloseTo(top(plate) + 2.75 * IN, 6)
    // Back to lumber, the nearest size to 14 in is a 2x12.
    expect(floorStructureAs(fourteen.structure, 'joists')).toMatchObject({ size: '2x12' })
  })

  test('a material name stays with its layer and keeps the preset; cleared, it reads as its kind', () => {
    const plate = framedBedroom()
    const named = renameFloorLayer(plate.buildUp!, 'flooring', '  Brazilian cherry ')
    expect(named.flooring?.name).toBe('Brazilian cherry')
    expect(named.presetId).toBe(DEFAULT_FLOOR_BUILD_UP.presetId)
    expect(applyFloorBuildUp(plate.id, named)).toBeNull()
    expect(bedroom().buildUp?.flooring?.name).toBe('Brazilian cherry')
    expect(bedroom().thickness).toBeCloseTo(plate.thickness, 6)
    const markup = render(
      createElement(FloorPlateBuildUp, {
        buildUp: bedroom().buildUp!,
        matches: true,
        onCommit: () => {},
        thickness: plate.thickness,
        unit: 'imperial',
      }),
    )
    expect(markup).toMatch(/data-floor-layer-name="flooring"[^>]*value="Brazilian cherry"/)
    const drawn = floorSectionLayers(bedroom().buildUp!, 'imperial')
    expect(drawn[0]).toMatchObject({ key: 'flooring', name: 'Brazilian cherry', size: '3/4"' })
    const cleared = renameFloorLayer(named, 'flooring', '')
    expect(cleared.flooring).toEqual(DEFAULT_FLOOR_BUILD_UP.flooring)
    expect(floorSectionLayers(cleared, 'imperial')[0]!.name).toBe('Hardwood')
  })

  test('a thickness scrub previews live and lands with the layers as one undo step', () => {
    const plate = framedBedroom()
    const thicker = editedFloorBuildUp(plate.buildUp!, {
      flooring: { ...plate.buildUp!.flooring!, thickness: 1.5 * IN },
    })
    const session = beginFootprintHeightPreview(plate.id)
    expect(session.preview(underside(plate) + floorBuildUpThickness(thicker))).toBeNull()
    // Live: the plate moves, the layers wait for the release, history untouched.
    expect(bedroom().thickness).toBeCloseTo(plate.thickness + 0.75 * IN, 6)
    expect(bedroom().buildUp).toEqual(plate.buildUp)
    expect(past()).toBe(0)
    expect(applyFloorBuildUp(plate.id, thicker, { session })).toBeNull()
    expect(bedroom().thickness).toBeCloseTo(plate.thickness + 0.75 * IN, 6)
    expect(bedroom().buildUp?.flooring?.thickness).toBeCloseTo(1.5 * IN, 9)
    expect(past()).toBe(1)
    useScene.temporal.getState().undo()
    expect(bedroom().thickness).toBeCloseTo(plate.thickness, 6)
    expect(bedroom().buildUp).toEqual(plate.buildUp)
  })

  test('a floor on the ground is no framed floor: refused, nothing written', () => {
    const living = plateOf(GROUND, 'Living')
    expect(applyFloorBuildUp(living.id, DEFAULT_FLOOR_BUILD_UP)).toBeString()
    expect((nodes()[living.id] as SlabNode).buildUp).toBeUndefined()
    expect((nodes()[living.id] as SlabNode).thickness).toBe(living.thickness)
  })
})

describe('Raised floor framing (the foundation section)', () => {
  test('flooring, subfloor and joists, no ceiling, then the framing they and the sill make', () => {
    const foundation = resolveBuildingFoundation({ type: 'raised' }, 1)
    const markup = render(
      createElement(RaisedFloorFraming, { foundation, onCommit: () => {}, unit: 'imperial' }),
    )
    for (const layer of ['flooring', 'sheathing', 'joists'])
      expect(markup).toContain(`data-floor-layer="${layer}"`)
    expect(markup).not.toContain('data-floor-layer="ceiling"')
    expect(markup).toContain('data-floor-layer-switch="flooring"')
    expect(markup).toContain('data-floor-layer-switch="sheathing"')
    expect(markup).not.toContain('data-floor-layer-switch="joists"')
    expect(markup).toContain('Floor framing 14-1/8", sill 1-1/2" included')
    expect(markup).toContain('Over a crawl space, 2x12 @ 16"')
    expect(markup).not.toContain('data-floor-framing-follows')
  })

  test('a layer switched off lowers the framing; an older record keeps its depth until a layer is set', () => {
    const off = switchFloorLayer(
      DEFAULT_RAISED_FLOOR_BUILD_UP,
      'flooring',
      false,
      DEFAULT_RAISED_FLOOR_BUILD_UP,
    )
    expect(resolveBuildingFoundation({ type: 'raised', floorBuildUp: off }, 1).floorFramingDepthIn).toBeCloseTo(
      13.375,
      4,
    )
    const older = resolveBuildingFoundation({ type: 'raised', floorFramingDepthIn: 16 }, 1)
    expect(older.floorFramingDepthIn).toBe(16)
    const markup = render(
      createElement(RaisedFloorFraming, { foundation: older, onCommit: () => {}, unit: 'imperial' }),
    )
    expect(markup).toContain('Floor framing 16", sill 1-1/2" included')
    expect(markup).toContain('data-floor-framing-follows')
  })

  test('the layers written through the panel’s apply set the framing, names kept', () => {
    const tile = editedFloorBuildUp(DEFAULT_RAISED_FLOOR_BUILD_UP, {
      flooring: { kind: 'ceramic-tile', thickness: 0.5 * IN, name: 'Saltillo' },
      structure: { ...DEFAULT_RAISED_FLOOR_BUILD_UP.structure, size: '2x10' },
    })
    expect(applyBuildingFoundation(BUILDING, { type: 'raised', floorBuildUp: tile })).toBe(true)
    const foundation = buildingFoundationOf(nodes(), BUILDING)!
    expect(foundation.floorFramingDepthIn).toBeCloseTo(0.5 + 0.625 + 9.25 + 1.5, 4)
    expect(foundation.floorBuildUp.flooring?.name).toBe('Saltillo')
  })
})

describe('Section drawings', () => {
  const length = (meters: number) => `${Math.round((meters / IN) * 100) / 100} in`

  test('a raised floor: its layers to the sill, the crawl dug out under the joists, the footing under that', () => {
    const foundation = resolveBuildingFoundation({ type: 'raised' }, 1)
    const markup = render(
      createElement(FoundationSectionDrawing, {
        foundation,
        framing: floorSectionLayers(foundation.floorBuildUp, 'imperial', true),
        length,
      }),
    )
    for (const part of ['flooring', 'sheathing', 'joists', 'sill', 'stem', 'footing', 'wall'])
      expect(markup).toContain(`data-section-part="${part}"`)
    expect(markup).toContain('Hardwood 3/4"')
    expect(markup).toContain('Sill 1-1/2"')
    // The joists' underside is the stem's top (8 in over grade) and the sill: 9.5 in; the dirt
    // 18 in under that is 8.5 in under the grade, and the footing's bottom 12 in under the dirt.
    expect(markup).toContain('data-section-crawl="-0.2159"')
    expect(markup).toContain('>18 in crawl<')
    expect(markup).toContain('>12 in down<')
    const dirt = Number(/data-section-crawl="[^"]*"><line [^>]*?y1="([\d.]+)"/.exec(markup)![1])
    const footing = /data-section-part="footing" points="([^"]+)"/.exec(markup)![1]!
    const footingBottom = Math.max(...footing.split(' ').map((point) => Number(point.split(',')[1])))
    expect(footingBottom).toBeGreaterThan(dirt + 10)
    // The depth is measured from the dirt down to the footing's bottom.
    const depth = markup.slice(markup.indexOf('data-section-dim="depth"'))
    const spans = [...depth.matchAll(/y1="([\d.]+)" y2="([\d.]+)"/g)].map((match) => [
      Number(match[1]),
      Number(match[2]),
    ])
    const [from, to] = spans[1]!
    expect(from).toBeCloseTo(footingBottom, 0)
    expect(to).toBeCloseTo(dirt, 0)
  })

  test("a slab's edge is plumb inside from its square bottom, then tapers in at 45°: half its depth under the slab, 6 to 12 in", () => {
    /** The slab's outline as drawn, in the drawing's points, and the markup round it. */
    const drawn = (record: Parameters<typeof resolveBuildingFoundation>[0]) => {
      const markup = render(
        createElement(FoundationSectionDrawing, {
          foundation: resolveBuildingFoundation(record, 1),
          length,
        }),
      )
      const points = /data-section-part="slab" points="([^"]+)"/
        .exec(markup)![1]!
        .split(' ')
        .map((point) => point.split(',').map(Number) as [number, number])
      return { markup, points }
    }
    const { markup, points } = drawn(null)
    // 16 in under the slab's underside: 8 in plumb over the bottom, then 8 in at 45°.
    expect(markup).toContain('>Taper 8 in at 45°<')
    expect(markup).toContain('>Edge 12 in wide<')
    const [bottomLeft, bottomRight, plumbTop, taperTop] = points
    expect(bottomRight![1]).toBeCloseTo(bottomLeft![1], 0)
    expect(plumbTop![0]).toBeCloseTo(bottomRight![0], 0)
    expect(taperTop![0] - plumbTop![0]).toBeCloseTo(plumbTop![1] - taperTop![1], 0)
    expect(bottomRight![1] - plumbTop![1]).toBeCloseTo(taperTop![0] - plumbTop![0], 0)
    // Deeper, the edge grows plumb: 30 in under the slab tapers 12 in. A taper set stands.
    expect(drawn({ edgeDepthIn: 26 }).markup).toContain('>Taper 12 in at 45°<')
    expect(drawn({ edgeTaperIn: 10 }).markup).toContain('>Taper 10 in at 45°<')
    expect(slabEdgeTaperOf(resolveBuildingFoundation({ edgeDepthIn: 4 }, 1)) / IN).toBeCloseTo(6, 9)
  })

  test('a layer switched off is not drawn; a slab has no crawl; an older raised record is one band', () => {
    const off = switchFloorLayer(
      DEFAULT_RAISED_FLOOR_BUILD_UP,
      'flooring',
      false,
      DEFAULT_RAISED_FLOOR_BUILD_UP,
    )
    const raised = resolveBuildingFoundation({ type: 'raised', floorBuildUp: off }, 1)
    const withoutFlooring = render(
      createElement(FoundationSectionDrawing, {
        foundation: raised,
        framing: floorSectionLayers(raised.floorBuildUp, 'imperial', true),
        length,
      }),
    )
    expect(withoutFlooring).not.toContain('data-section-part="flooring"')
    expect(withoutFlooring).toContain('data-section-part="sheathing"')
    const slab = render(
      createElement(FoundationSectionDrawing, {
        foundation: resolveBuildingFoundation(null, 1),
        length,
      }),
    )
    expect(slab).not.toContain('data-section-crawl')
    expect(slab).not.toContain('crawl<')
    expect(slab).toContain('data-section-part="slab"')
    const older = render(
      createElement(FoundationSectionDrawing, {
        foundation: resolveBuildingFoundation({ type: 'raised', floorFramingDepthIn: 16 }, 1),
        length,
      }),
    )
    expect(older).toContain('data-section-part="framing"')
    expect(older).toContain('data-section-crawl')
  })

  test('the floor plate draws as its layers top down; a layer that is off is not drawn', () => {
    const section = (layers = floorSectionLayers(DEFAULT_FLOOR_BUILD_UP, 'imperial')) =>
      render(
        createElement(FloorSection, {
          layers,
          raised: false,
          supported: true,
          thickness: floorBuildUpThickness(DEFAULT_FLOOR_BUILD_UP),
          thicknessLabel: '13-1/8"',
        }),
      )
    const markup = section()
    const order = [
      'Floor top',
      'Hardwood · 3/4"',
      'Plywood subfloor · 5/8"',
      '2x12 joists · 11-1/4"',
      'Drywall ceiling · 1/2"',
      'Walls below',
    ].map((label) => markup.indexOf(`>${label}<`))
    expect(order.every((at) => at >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    for (const layer of ['flooring', 'sheathing', 'joists', 'ceiling'])
      expect(markup).toContain(`data-section-layer="${layer}"`)
    expect(markup).toContain('Not to scale')
    const exposed = section(
      floorSectionLayers(switchFloorLayer(DEFAULT_FLOOR_BUILD_UP, 'ceiling', false), 'imperial'),
    )
    expect(exposed).not.toContain('data-section-layer="ceiling"')
    expect(exposed).not.toContain('Drywall ceiling')
  })

  test('callouts keep their order, a crowded run fanned round its middle, within bounds', () => {
    expect(stackLabels([10, 11, 12, 50], 9, 0, 100)).toEqual([2, 11, 20, 50])
    expect(stackLabels([0, 1], 9, 5, 100)).toEqual([5, 14])
    expect(stackLabels([30, 10], 9, 0, 100)).toEqual([30, 10])
    expect(formatLayerThickness(0.75 * IN, 'imperial')).toBe('3/4"')
    expect(formatLayerThickness(11.25 * IN, 'imperial')).toBe('11-1/4"')
    expect(formatLayerThickness(0.5 * IN, 'metric')).toBe('12.7 mm')
  })
})
