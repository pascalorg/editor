import { describe, expect, test } from 'bun:test'
import type { AnyNode, AnyNodeId, FloorplanGeometry } from '@pascal-app/core'
import { buildElevationDrawing } from './elevation'
import { buildBuildingModel } from './scene-model'
import { buildSectionDrawing } from './section'
import type { DrawingScene } from './types'

// ---------------------------------------------------------------------------
// Synthetic scene — one level, four mitred 2x6 (140 mm) walls forming a 6 x 4 m
// box measured on the wall CENTRELINES, a window in the north wall and a door
// in the south wall, and a flat roof over the box.
//
// Plan convention: x east, z south. The box spans x 0..6, z 0..4.
//   south wall  z = 4   (the face a south elevation looks at)
//   north wall  z = 0
// ---------------------------------------------------------------------------

const WALL_THICKNESS = 0.14
const WALL_HEIGHT = 2.7
const LEVEL_HEIGHT = 3.0

const WINDOW_WIDTH = 1.2
const WINDOW_HEIGHT = 1.5
const WINDOW_SILL = 0.9
const WINDOW_ALONG = 3.0

const DOOR_WIDTH = 0.9
const DOOR_HEIGHT = 2.1
const DOOR_ALONG = 3.0

function wall(
  id: string,
  start: [number, number],
  end: [number, number],
  children: string[] = [],
): AnyNode {
  return {
    object: 'node',
    id,
    type: 'wall',
    parentId: 'level_1',
    visible: true,
    metadata: {},
    children,
    start,
    end,
    thickness: WALL_THICKNESS,
    height: WALL_HEIGHT,
    frontSide: 'unknown',
    backSide: 'unknown',
  } as unknown as AnyNode
}

function scene(): DrawingScene {
  const nodes: Record<string, AnyNode> = {
    building_1: {
      object: 'node',
      id: 'building_1',
      type: 'building',
      parentId: null,
      visible: true,
      metadata: {},
      children: ['level_1'],
    } as unknown as AnyNode,
    level_1: {
      object: 'node',
      id: 'level_1',
      type: 'level',
      name: 'Ground Floor',
      parentId: 'building_1',
      visible: true,
      metadata: {},
      children: ['wall_n', 'wall_e', 'wall_s', 'wall_w', 'roof_1'],
      level: 0,
      baseElevation: 0,
      height: LEVEL_HEIGHT,
    } as unknown as AnyNode,
    // Wound clockwise in plan so the miters close: N (west→east), E, S, W.
    wall_n: wall('wall_n', [0, 0], [6, 0], ['window_1']),
    wall_e: wall('wall_e', [6, 0], [6, 4]),
    wall_s: wall('wall_s', [6, 4], [0, 4], ['door_1']),
    wall_w: wall('wall_w', [0, 4], [0, 0]),
    window_1: {
      object: 'node',
      id: 'window_1',
      type: 'window',
      parentId: 'wall_n',
      visible: true,
      metadata: {},
      wallId: 'wall_n',
      position: [WINDOW_ALONG, WINDOW_SILL + WINDOW_HEIGHT / 2, 0],
      rotation: [0, 0, 0],
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT,
      windowType: 'fixed',
      openingKind: 'window',
      columnRatios: [0.5, 0.5],
      rowRatios: [1],
      sill: true,
    } as unknown as AnyNode,
    door_1: {
      object: 'node',
      id: 'door_1',
      type: 'door',
      parentId: 'wall_s',
      visible: true,
      metadata: {},
      wallId: 'wall_s',
      position: [DOOR_ALONG, DOOR_HEIGHT / 2, 0],
      rotation: [0, 0, 0],
      width: DOOR_WIDTH,
      height: DOOR_HEIGHT,
      openingKind: 'door',
    } as unknown as AnyNode,
    roof_1: {
      object: 'node',
      id: 'roof_1',
      type: 'roof',
      parentId: 'level_1',
      visible: true,
      metadata: {},
      children: ['rseg_1'],
      position: [3, 0, 2],
      rotation: 0,
    } as unknown as AnyNode,
    rseg_1: {
      object: 'node',
      id: 'rseg_1',
      type: 'roof-segment',
      parentId: 'roof_1',
      visible: true,
      metadata: {},
      children: [],
      position: [0, 0, 0],
      rotation: 0,
      roofType: 'flat',
      width: 6,
      depth: 4,
      trim: {
        left: 0,
        right: 0,
        front: 0,
        back: 0,
        frontLeft: 0,
        frontRight: 0,
        backLeft: 0,
        backRight: 0,
        frontLeftX: 0,
        frontLeftZ: 0,
        frontRightX: 0,
        frontRightZ: 0,
        backLeftX: 0,
        backLeftZ: 0,
        backRightX: 0,
        backRightZ: 0,
      },
      wallHeight: WALL_HEIGHT,
      pitch: 0,
      wallThickness: WALL_THICKNESS,
      deckThickness: 0.2,
      overhang: 0.3,
      shingleThickness: 0.05,
      gambrelLowerWidthRatio: 0.5,
      gambrelLowerHeightRatio: 0.6,
      mansardSteepWidthRatio: 0.15,
      mansardSteepHeightRatio: 0.7,
      dutchHipWidthRatio: 0.25,
      dutchHipHeightRatio: 0.5,
      dutchWaistLengthRatio: 0.98,
      dutchGabletRake: 0.48,
      dutchTopRakeThickness: 0.21,
    } as unknown as AnyNode,
  }
  return { nodes: nodes as Record<AnyNodeId, AnyNode> }
}

type Poly = Extract<FloorplanGeometry, { kind: 'polygon' }>
type Line = Extract<FloorplanGeometry, { kind: 'line' }>

function polygons(primitives: readonly FloorplanGeometry[]): Poly[] {
  return primitives.filter((g): g is Poly => g.kind === 'polygon')
}

function lines(primitives: readonly FloorplanGeometry[]): Line[] {
  return primitives.filter((g): g is Line => g.kind === 'line')
}

function extent(poly: Poly) {
  const xs = poly.points.map((p) => p[0])
  const ys = poly.points.map((p) => p[1])
  return {
    x0: Math.min(...xs),
    x1: Math.max(...xs),
    // Drawing y is NEGATED elevation, so flip it back for readable assertions.
    bottom: -Math.max(...ys),
    top: -Math.min(...ys),
  }
}

describe('scene model', () => {
  test('mitres the four walls and stacks them on the level', () => {
    const model = buildBuildingModel(scene().nodes)
    expect(model.walls).toHaveLength(4)
    for (const w of model.walls) {
      expect(w.baseY).toBeCloseTo(0, 9)
      expect(w.topY).toBeCloseTo(WALL_HEIGHT, 9)
      expect(w.thickness).toBeCloseTo(WALL_THICKNESS, 9)
      // A mitred wall footprint closes on its junction points, so it carries
      // more than the four naked-rectangle corners.
      expect(w.polygon.length).toBeGreaterThanOrEqual(4)
    }
    const north = model.walls.find((w) => w.id === 'wall_n')!
    expect(north.openings).toHaveLength(1)
    expect(north.openings[0]!.sillY).toBeCloseTo(WINDOW_SILL, 9)
    expect(north.openings[0]!.headY).toBeCloseTo(WINDOW_SILL + WINDOW_HEIGHT, 9)
    expect(model.roofs).toHaveLength(1)
    expect(model.roofs[0]!.plateY).toBeCloseTo(WALL_HEIGHT, 9)
  })
})

describe('buildSectionDrawing', () => {
  // A north–south cut at x = 3, running from z = -2 (outside, north) to
  // z = 6 (outside, south). It passes straight through the window in the
  // north wall and the door in the south wall. Looking 'right' of travel
  // (travel is +z / south, so right-of-travel is -x / west).
  const spec = {
    start: [3, -2] as const,
    end: [3, 6] as const,
    lookDirection: 'right' as const,
    depth: 8,
  }

  test('cuts both walls at their true thickness', () => {
    const drawing = buildSectionDrawing(scene(), { ...spec })
    const cuts = polygons(drawing.primitives).filter(
      (p) => p.fill !== '#ffffff' && p.fill !== 'none',
    )
    const wallBands = cuts
      .map(extent)
      .filter((e) => Math.abs(e.bottom) < 1e-6 && Math.abs(e.top - WALL_HEIGHT) > 1e-6)
    // Every wall cut band below the opening is exactly one wall thick.
    expect(wallBands.length).toBeGreaterThan(0)
    for (const band of wallBands) {
      expect(band.x1 - band.x0).toBeCloseTo(WALL_THICKNESS, 6)
    }
  })

  test('shows the window head and sill at the right elevations', () => {
    const drawing = buildSectionDrawing(scene(), { ...spec })
    const elevations = lines(drawing.primitives)
      .filter((l) => Math.abs(l.y1 - l.y2) < 1e-9)
      .map((l) => -l.y1)
    expect(elevations.some((y) => Math.abs(y - WINDOW_SILL) < 1e-6)).toBe(true)
    expect(elevations.some((y) => Math.abs(y - (WINDOW_SILL + WINDOW_HEIGHT)) < 1e-6)).toBe(true)
    // The cut wall is split at the opening: a band under the sill and one
    // over the head, and NO band spanning across the opening.
    const bands = polygons(drawing.primitives)
      .filter((p) => p.fill !== '#ffffff' && p.fill !== 'none')
      .map(extent)
      .filter((e) => Math.abs(e.x1 - e.x0 - WALL_THICKNESS) < 1e-6)
    expect(bands.some((b) => Math.abs(b.top - WINDOW_SILL) < 1e-6)).toBe(true)
    expect(bands.some((b) => Math.abs(b.bottom - (WINDOW_SILL + WINDOW_HEIGHT)) < 1e-6)).toBe(true)
    expect(bands.some((b) => b.bottom < WINDOW_SILL - 1e-6 && b.top > WINDOW_SILL + 1e-6)).toBe(
      false,
    )
  })

  test('shows the door head at 2.10 m', () => {
    const drawing = buildSectionDrawing(scene(), { ...spec })
    const elevations = lines(drawing.primitives)
      .filter((l) => Math.abs(l.y1 - l.y2) < 1e-9)
      .map((l) => -l.y1)
    expect(elevations.some((y) => Math.abs(y - DOOR_HEIGHT) < 1e-6)).toBe(true)
  })

  test('projects the far walls as background silhouettes', () => {
    const drawing = buildSectionDrawing(scene(), { ...spec })
    const white = polygons(drawing.primitives).filter((p) => p.fill === '#ffffff')
    // Looking 'right' of a +z travel means looking toward -x, so the WEST
    // wall (x = 0) is the far wall inside the 8 m depth window. It runs
    // z = 0..4 across the view, so it projects 4 m + one mitred thickness
    // wide, full wall height. The east wall (x = 6) sits behind the viewer
    // and must NOT appear.
    const longRuns = white
      .map(extent)
      .filter((e) => Math.abs(e.top - WALL_HEIGHT) < 1e-6 && Math.abs(e.bottom) < 1e-6)
    expect(longRuns.some((e) => Math.abs(e.x1 - e.x0 - (4 + WALL_THICKNESS)) < 1e-6)).toBe(true)
  })

  test('the cut spans the building and reports the true elevation range', () => {
    const drawing = buildSectionDrawing(scene(), { ...spec })
    // Roof deck top sits on the plate at 2.70 m.
    expect(drawing.elevationRange.max).toBeGreaterThanOrEqual(WALL_HEIGHT - 1e-6)
    expect(drawing.elevationRange.min).toBeLessThanOrEqual(0 + 1e-6)
  })

  test('a cut that misses the building reports it instead of drawing nothing silently', () => {
    const drawing = buildSectionDrawing(scene(), {
      start: [-20, -20],
      end: [-20, 20],
      lookDirection: 'left',
      depth: 2,
    })
    expect(drawing.primitives.filter((g) => g.kind === 'polygon')).toHaveLength(0)
  })

  test('resolves a section-marker node by id', () => {
    const s = scene()
    ;(s.nodes as Record<string, AnyNode>).secmk_1 = {
      object: 'node',
      id: 'secmk_1',
      type: 'section-marker',
      parentId: 'level_1',
      visible: true,
      metadata: {},
      label: 'A',
      levelId: 'level_1',
      start: [3, -2],
      end: [3, 6],
      lookDirection: 'right',
      depth: 8,
      sheetRef: null,
    } as unknown as AnyNode
    const drawing = buildSectionDrawing(s, { markerId: 'secmk_1' })
    expect(drawing.primitives.length).toBeGreaterThan(0)
    expect(drawing.elevationRange.max).toBeGreaterThan(WALL_HEIGHT - 1e-6)
  })
})

describe('wall assembly layers (WS5)', () => {
  // A real 2x6 envelope: 19 mm lap siding + 11.1 mm OSB + 139.7 mm framing +
  // 12.7 mm drywall = 182.5 mm total, which `wall.thickness` must mirror.
  const SIDING = 0.75 * 0.0254
  const OSB = 0.4375 * 0.0254
  const STUD = 5.5 * 0.0254
  const DRYWALL = 0.5 * 0.0254
  const TOTAL = SIDING + OSB + STUD + DRYWALL

  function assemblyScene(): DrawingScene {
    const s = scene()
    for (const id of ['wall_n', 'wall_e', 'wall_s', 'wall_w']) {
      const w = s.nodes[id as AnyNodeId] as unknown as Record<string, unknown>
      w.thickness = TOTAL
      w.frontSide = 'exterior'
      w.backSide = 'interior'
      w.assembly = {
        preset: 'test-2x6',
        exterior: { finish: 'siding', thickness: SIDING },
        sheathing: { material: 'osb', thickness: OSB },
        framing: { kind: 'wood', depth: STUD },
        interior: { finish: 'drywall', thickness: DRYWALL },
      }
    }
    return s
  }

  test('reads the layer stack straight off resolveWallAssembly', () => {
    const model = buildBuildingModel(assemblyScene().nodes)
    const north = model.walls.find((w) => w.id === 'wall_n')!
    expect(north.layers.map((l) => l.role)).toEqual([
      'exterior-finish',
      'sheathing',
      'framing',
      'interior-finish',
    ])
    expect(north.layers.reduce((a, l) => a + l.thickness, 0)).toBeCloseTo(TOTAL, 9)
    // frontSide = exterior means the +normal face is outdoors.
    expect(north.exteriorSign).toBe(1)
  })

  test('the section cut draws one poche band per layer, exterior face outward', () => {
    const drawing = buildSectionDrawing(assemblyScene(), {
      start: [3, -2],
      end: [3, 6],
      lookDirection: 'right',
      depth: 8,
    })
    // Bands sitting on the slab at 0 in the below-sill part of the cut wall.
    const bands = polygons(drawing.primitives)
      .filter((p) => p.fill !== '#ffffff' && p.fill !== 'none')
      .map(extent)
      .filter((e) => Math.abs(e.bottom) < 1e-6 && Math.abs(e.top - WINDOW_SILL) < 1e-6)
    expect(bands.length).toBe(4)
    const widths = bands.map((b) => b.x1 - b.x0).sort((a, b) => a - b)
    expect(widths).toEqual(
      [SIDING, OSB, STUD, DRYWALL].sort((a, b) => a - b).map((w) => expect.closeTo(w, 6)),
    )
    // The four bands tile the full wall thickness with no gaps or overlaps.
    const sorted = bands.slice().sort((a, b) => a.x0 - b.x0)
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]!.x0).toBeCloseTo(sorted[i - 1]!.x1, 9)
    }
    expect(sorted.at(-1)!.x1 - sorted[0]!.x0).toBeCloseTo(TOTAL, 6)
    // Orientation: wall_n runs +x, so its +normal (exterior) face is the +z
    // side. The cut looks toward -x, giving a drawing right axis of -z, so
    // the exterior siding lands at the LOW end of the band and the drywall at
    // the high end.
    expect(sorted[0]!.x1 - sorted[0]!.x0).toBeCloseTo(SIDING, 6)
    expect(sorted.at(-1)!.x1 - sorted.at(-1)!.x0).toBeCloseTo(DRYWALL, 6)
  })
})

describe('gable roof', () => {
  // Same box with a 30 degree gable. The ridge runs along the WIDTH axis (x),
  // so `getSegmentSlopeFrame` puts run = depth/2 = 2 m and
  // rise = 2 * tan(30 deg) = 1.1547 m above the 2.70 m plate.
  const PITCH = 30
  const RIDGE = WALL_HEIGHT + 2 * Math.tan((PITCH * Math.PI) / 180)

  function gableScene(): DrawingScene {
    const s = scene()
    const segment = s.nodes['rseg_1' as AnyNodeId] as unknown as Record<string, unknown>
    segment.roofType = 'gable'
    segment.pitch = PITCH
    return s
  }

  test('the model derives the ridge from the pitch, not a stored height', () => {
    const model = buildBuildingModel(gableScene().nodes)
    expect(model.roofs[0]!.ridgeY).toBeCloseTo(RIDGE, 9)
    // Eave = plate - overhang * sin(pitch), matching the horizontal extent
    // `getRoofSegmentVisibleTopBounds` gives the deck (overhang * cos):
    // 2.70 - 0.3 * sin(30) = 2.55. See the DEFECT note in scene-model.ts on
    // core's own `computeGutterEaveY` disagreeing with that helper.
    expect(model.roofs[0]!.eaveY).toBeCloseTo(
      WALL_HEIGHT - 0.3 * Math.sin((PITCH * Math.PI) / 180),
      9,
    )
  })

  test('a section across the ridge cuts the roof up to the ridge', () => {
    const drawing = buildSectionDrawing(gableScene(), {
      start: [3, -2],
      end: [3, 6],
      lookDirection: 'right',
      depth: 8,
    })
    // Sampled at 240 steps over 8 m, so the peak lands within one step.
    expect(drawing.elevationRange.max).toBeGreaterThan(RIDGE - 0.05)
    expect(drawing.elevationRange.max).toBeLessThan(RIDGE + 0.26)
  })

  test('the east elevation reaches the ridge; the south elevation reaches it too', () => {
    for (const direction of ['east', 'south'] as const) {
      const drawing = buildElevationDrawing(gableScene(), direction)
      expect(drawing.elevationRange.max).toBeGreaterThan(RIDGE - 0.05)
    }
  })

  test('a mansard roof is reported as approximated rather than drawn silently', () => {
    const s = scene()
    const segment = s.nodes['rseg_1' as AnyNodeId] as unknown as Record<string, unknown>
    segment.roofType = 'mansard'
    segment.pitch = 45
    const drawing = buildElevationDrawing(s, 'south')
    expect(drawing.warnings.some((w) => w.includes('mansard'))).toBe(true)
  })
})

describe('buildElevationDrawing', () => {
  test('the finish key names the roofing the building records, else says what it assumes', () => {
    const texts = (d: ReturnType<typeof buildElevationDrawing>) =>
      d.primitives.filter((p) => p.kind === 'text').map((p) => (p as { text: string }).text)
    expect(texts(buildElevationDrawing(scene(), 'south'))).toContain(
      'ROOF: ASPHALT SHINGLES (assumed — roof material not modelled)',
    )
    const s = scene()
    ;(s.nodes.building_1 as unknown as { metadata: Record<string, unknown> }).metadata = {
      finishes: { roof: { label: 'architectural shingles — charcoal', hex: '#3a3d40' } },
    }
    const labelled = texts(buildElevationDrawing(s, 'south'))
    expect(labelled).toContain('ROOF: ARCHITECTURAL SHINGLES — CHARCOAL (#3a3d40)')
    expect(labelled.some((t) => t.includes('assumed'))).toBe(false)
  })

  test('the south elevation is 6 m wide across the outer wall faces', () => {
    const drawing = buildElevationDrawing(scene(), 'south')
    const white = polygons(drawing.primitives).filter((p) => p.fill === '#ffffff')
    const widths = white.map(extent).map((e) => e.x1 - e.x0)
    // Outer face to outer face of the 6 m centreline box = 6 + one thickness.
    const expected = 6 + WALL_THICKNESS
    expect(widths.some((w) => Math.abs(w - expected) < 1e-6)).toBe(true)
  })

  test('a building turned 3° on its lot is drawn square to its own faces; a quarter turn renames the faces', () => {
    const s = scene()
    const building = s.nodes['building_1' as AnyNodeId] as unknown as Record<string, unknown>
    building.rotation = [0, 0.05, 0]
    const drawing = buildElevationDrawing(s, 'south')
    const white = polygons(drawing.primitives).filter((p) => p.fill === '#ffffff')
    const widths = white.map(extent).map((e) => e.x1 - e.x0)
    // the model is drawn in the building's own frame, so the south face
    // still reads outer face to outer face — no 3° oblique
    const expected = 6 + WALL_THICKNESS
    expect(widths.some((w) => Math.abs(w - expected) < 1e-6)).toBe(true)
    // turned a quarter (and 3°): the face that now looks south is the 4 m one
    building.rotation = [0, Math.PI / 2 + 0.05, 0]
    const turned = buildElevationDrawing(s, 'south')
    const turnedWidths = polygons(turned.primitives)
      .filter((p) => p.fill === '#ffffff')
      .map(extent)
      .map((e) => e.x1 - e.x0)
    expect(turnedWidths.some((w) => Math.abs(w - (4 + WALL_THICKNESS)) < 1e-6)).toBe(true)
    expect(turnedWidths.some((w) => Math.abs(w - expected) < 1e-6)).toBe(false)
    // turned a half: the south elevation shows the face that now looks south
    // — the local north wall, with its window at its sill, and no door
    building.rotation = [0, Math.PI - 0.04, 0]
    const half = buildElevationDrawing(s, 'south')
    const openings = polygons(half.primitives)
      .filter((p) => p.fill === '#ffffff' || p.fill === '#f1f5f9')
      .map(extent)
    const window = openings.find(
      (e) => Math.abs(e.x1 - e.x0 - WINDOW_WIDTH) < 1e-6 && Math.abs(e.top - (WINDOW_SILL + WINDOW_HEIGHT)) < 1e-6,
    )
    expect(window).toBeDefined()
    expect(window!.bottom).toBeCloseTo(WINDOW_SILL, 9)
  })

  test('the grade is read under the building where it stands, in the building\'s own frame', () => {
    // the platform stands 0.6 m above the flat ground: the finish floor is
    // 0.6 m over the grade line, on the elevation and in the cut
    const s = scene()
    const building = s.nodes['building_1' as AnyNodeId] as unknown as Record<string, unknown>
    building.position = [12, 0.6, -30]
    const drawing = buildElevationDrawing(s, 'south')
    const grade = drawing.primitives.find((p) => p.kind === 'polyline') as { points: readonly (readonly number[])[] }
    expect(grade).toBeDefined()
    expect(grade.points.every((p) => Math.abs((p[1] ?? 0) - 0.6) < 1e-9)).toBe(true)
    const texts = drawing.primitives.filter((p) => p.kind === 'text').map((p) => (p as { text: string }).text)
    // -0.6 m rounds to the inch: -1'-11.6" reads -2'-0"
    expect(texts.some((t) => t.startsWith('GRADE') && t.includes('-2'))).toBe(true)
  })

  test('the south elevation shows the door at its true size', () => {
    const drawing = buildElevationDrawing(scene(), 'south')
    const door = polygons(drawing.primitives)
      .filter((p) => p.fill === '#ffffff' || p.fill === '#f1f5f9')
      .map(extent)
      .find(
        (e) => Math.abs(e.x1 - e.x0 - DOOR_WIDTH) < 1e-6 && Math.abs(e.top - DOOR_HEIGHT) < 1e-6,
      )
    expect(door).toBeDefined()
    expect(door!.bottom).toBeCloseTo(0, 9)
  })

  test('the north elevation shows the window at its true size and sill', () => {
    const drawing = buildElevationDrawing(scene(), 'north')
    const window = polygons(drawing.primitives)
      .filter((p) => p.fill === '#ffffff' || p.fill === '#f1f5f9')
      .map(extent)
      .find(
        (e) =>
          Math.abs(e.x1 - e.x0 - WINDOW_WIDTH) < 1e-6 && Math.abs(e.bottom - WINDOW_SILL) < 1e-6,
      )
    expect(window).toBeDefined()
    expect(window!.top).toBeCloseTo(WINDOW_SILL + WINDOW_HEIGHT, 9)
  })

  test('east and west elevations are 4 m wide plus one wall thickness', () => {
    for (const direction of ['east', 'west'] as const) {
      const drawing = buildElevationDrawing(scene(), direction)
      const widths = polygons(drawing.primitives)
        .filter((p) => p.fill === '#ffffff')
        .map(extent)
        .map((e) => e.x1 - e.x0)
      expect(widths.some((w) => Math.abs(w - (4 + WALL_THICKNESS)) < 1e-6)).toBe(true)
    }
  })

  test('draws the level datum and the roof plate datum', () => {
    const drawing = buildElevationDrawing(scene(), 'south')
    const texts = drawing.primitives.filter(
      (g): g is Extract<FloorplanGeometry, { kind: 'text' }> => g.kind === 'text',
    )
    expect(texts.some((t) => t.text.startsWith('FINISH FLOOR'))).toBe(true)
    expect(texts.some((t) => t.text.startsWith('T.O. PLATE'))).toBe(true)
  })

  test('an underpinned wall shows its finish down over the rim and the stemwall below in concrete, on the elevation and in the cut', () => {
    const s = scene()
    ;(s.nodes.wall_s as unknown as { underpinning: { rim: number; stem: number } }).underpinning = {
      rim: 0.25,
      stem: 0.2,
    }
    const south = buildElevationDrawing(s, 'south')
    const rects = polygons(south.primitives).map((p) => ({ ...extent(p), fill: p.fill }))
    // the face rectangle reaches 0.25 m below the base
    expect(rects.some((r) => Math.abs(r.bottom + 0.25) < 1e-6 && Math.abs(r.top - WALL_HEIGHT) < 1e-6)).toBe(true)
    // the stemwall band: concrete grey from -0.25 down to -0.45
    const stem = rects.find((r) => r.fill === '#b7b7be' && Math.abs(r.top + 0.25) < 1e-6)
    expect(stem).toBeDefined()
    expect(stem!.bottom).toBeCloseTo(-0.45, 9)
    // the cut through the south wall shows the same stem band across the wall
    const cut = buildSectionDrawing(s, { start: [3.5, -1], end: [3.5, 5] })
    const cutStem = polygons(cut.primitives)
      .map((p) => ({ ...extent(p), fill: p.fill }))
      .find((r) => r.fill === '#b7b7be' && Math.abs(r.top + 0.25) < 1e-6 && Math.abs(r.bottom + 0.45) < 1e-6)
    expect(cutStem).toBeDefined()
    expect(cutStem!.x1 - cutStem!.x0).toBeCloseTo(WALL_THICKNESS, 6)
  })

  test('a porch post, a guard, a flight and a tree stand in the elevation; the roof takes the recorded roofing colour', () => {
    const s = scene()
    const add = (n: Record<string, unknown>) => {
      ;(s.nodes as Record<string, unknown>)[n.id as string] = n
    }
    add({ object: 'node', id: 'column_1', type: 'column', parentId: 'level_1', visible: true, metadata: {}, children: [], position: [1, 0, 5], rotation: 0, height: 2.4, width: 0.14, depth: 0.14 })
    add({ object: 'node', id: 'fence_1', type: 'fence', parentId: 'level_1', visible: true, metadata: {}, children: [], start: [1.5, 5], end: [4, 5], height: 0.9, thickness: 0.04 })
    add({ object: 'node', id: 'stair_1', type: 'stair', parentId: 'level_1', visible: true, metadata: {}, children: ['sseg_1'], position: [3, 0, 6], rotation: Math.PI, width: 1, totalRise: 0.5, stepCount: 3, stairType: 'straight' })
    add({ object: 'node', id: 'sseg_1', type: 'stair-segment', parentId: 'stair_1', visible: true, metadata: {}, children: [], segmentType: 'stair', length: 0.84, width: 1, height: 0.5, stepCount: 3 })
    add({ object: 'node', id: 'tree_1', type: 'trees:tree', parentId: null, visible: true, metadata: {}, children: [], position: [-3, 0, 6], rotation: [0, 0, 0], preset: 'oak', height: 6 })
    ;(s.nodes.building_1 as unknown as { metadata: Record<string, unknown> }).metadata = {
      finishes: { roof: { label: 'comp shingle — weathered', hex: '#6e6256' }, trim: { hex: '#f4f1ea' } },
    }
    const south = buildElevationDrawing(s, 'south')
    const rects = polygons(south.primitives).map((p) => ({ ...extent(p), fill: p.fill }))
    // the post: a 0.14 m box 2.4 m tall
    expect(rects.some((r) => Math.abs(r.x1 - r.x0 - 0.14) < 1e-6 && Math.abs(r.top - 2.4) < 1e-6)).toBe(true)
    // the guard: 2.5 m wide, 0.9 m tall
    expect(rects.some((r) => Math.abs(r.x1 - r.x0 - 2.5) < 1e-6 && Math.abs(r.top - 0.9) < 1e-6)).toBe(true)
    // the flight: 1 m wide, 0.5 m of rise
    expect(rects.some((r) => Math.abs(r.x1 - r.x0 - 1) < 1e-6 && Math.abs(r.top - 0.5) < 1e-6)).toBe(true)
    // the tree: a canopy of the trees plugin's stand-in spread (60 % of 6 m)
    expect(polygons(south.primitives).some((p) => p.fill === '#e5efe0' && p.points.length === 36)).toBe(true)
    expect(south.warnings.some((w) => w.includes('stand-in spread'))).toBe(true)
    // the roof surface fills in the recorded roofing colour, the fascia in the trim colour
    expect(polygons(south.primitives).some((p) => p.fill === '#6e6256')).toBe(true)
    expect(polygons(south.primitives).some((p) => p.fill === '#f4f1ea')).toBe(true)
  })

  test('the grade line sits at 0.00 with no terrain', () => {
    const drawing = buildElevationDrawing(scene(), 'south')
    const grade = drawing.primitives.find(
      (g): g is Extract<FloorplanGeometry, { kind: 'polyline' }> => g.kind === 'polyline',
    )
    expect(grade).toBeDefined()
    for (const point of grade!.points) expect(point[1]).toBeCloseTo(0, 9)
  })
})
