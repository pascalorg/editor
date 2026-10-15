/**
 * Every roof the hosted Architect plugin's `hip_roof_planes` and `gable_roof_planes` built, each
 * beside the `roof_segment_add` call that covers it and the roof segment that call writes, so the
 * two plane tools can retire into it (catalogue slice R). No stored thread called either tool, so
 * the cases are what their contracts take (both ridge axes, a hip either way and square, the
 * default, wide, flush and wider-than-the-eaves gable overhangs, a thickness, an eave on the plate,
 * over it and on posts) and the plugin's own call (a hip at the walls' 2.6 m tops).
 *
 * The plane tools took the rectangle of the walls' outside faces, a rise per 12, the overhang past
 * those faces in metres (a gable's ends their own), a thickness square to the slope (0.29 m by
 * default) and an eave height that was the roof's SURFACE at the outside wall face. The segment
 * takes the same rectangle (`rectAt: 'outside'`), the pitch, the overhangs and the thickness in
 * any unit, and an eave that is the plate it bears on, its default the walls' tops; the walls'
 * thickness, which it reads from the walls along those faces (6.5 in where none stand, a porch on
 * posts), puts their centre lines inside the faces.
 *
 * A plane call whose roof stood on its walls, or over them, is the same roof as a segment: same
 * outline, surface, ridge and thickness (`lift` 0).
 *
 * Not reproduced, on purpose (no stored call made either, so each is a call a model could make):
 * - A plane call with its eave at the walls' tops, the plugin's own and the likeliest, sank its roof
 *   into them: its slab's underside stood `thickness / cos(pitch)` under the plate at the wall face.
 *   A segment is never sunk under the walls it sits on (`eave_under_walls`); the replacement leaves
 *   the eave out and the roof sits on them, the same outline, pitch and thickness, its surface
 *   `lift` higher. Those rows say so.
 * - Planes over a storey with another over it stood inside that storey; a segment refuses that
 *   (`into_storey_above`). The hosted table checks the refusal.
 * - The plane tools answered each plane's id, so one slope could be edited or painted on its own
 *   (`update_roof_plane`). A segment is one mass whose slopes change together; one slope on its own
 *   is `create_roof_plane`'s, which stays, and the retired tools' answer says so.
 *
 * The viewer runs the segments through the roof geometry against the planes' own geometry
 * (`roof-plane-cases.test.ts`); the hosted plugin runs each replacement call through
 * `roof_segment_add` and reads back the segment it wrote.
 */

type Rect = [number, number, number, number]

const IN = 0.0254
/** The walls' thickness, a 2x6 wall finished: what `roof_segment_add` reads from them. */
export const ROOF_PLANE_WALL_THICKNESS = 6.5 * IN
/** The covering a segment lays over its deck, in the thickness the plane tools took whole. */
export const ROOF_PLANE_COVERING = 0.02
/** The plane tools' defaults. */
const PLANE_OVERHANG = 0.457
const PLANE_GABLE_OVERHANG = 0.305
const PLANE_THICKNESS = 0.29

export type RoofPlaneCall = {
  tool: 'hip_roof_planes' | 'gable_roof_planes'
  rect: Rect
  ridgeAxis?: 'x' | 'z'
  /** Rise per 12. */
  pitch: number
  /** The roof's surface at the outside wall face, metres above the storey's floor. */
  eaveHeight: number
  overhang?: number
  gableOverhang?: number
  thickness?: number
  name?: string
}

export type RoofSegmentAddCall = {
  roofType: 'hip' | 'gable'
  name: string
  rect: Rect
  rectAt: 'outside'
  ridgeAxis: 'x' | 'z'
  pitchTwelfths: number
  overhangIn: string
  gableOverhangIn?: string
  thicknessIn: string
  eaveHeight?: number
}

/** The segment a replacement call writes, in its storey's plan and metres. */
export type ExpectedRoofSegment = {
  roofType: 'hip' | 'gable'
  name: string
  /** The centre of its wall centre-line rectangle. */
  centre: [number, number]
  /** Along its ridge axis and across it, at the wall centre lines. */
  width: number
  depth: number
  rotation: number
  /** Degrees. */
  pitch: number
  /** Along the slope, as the node stores it. */
  overhang: number
  /** In plan past the gable-end walls' outside faces; none on a hip. */
  gableOverhang?: number
  wallThickness: number
  deckThickness: number
  shingleThickness: number
  /** The plate it bears on, metres above the storey's floor. */
  eave: number
}

export type RoofPlaneCase = {
  name: string
  /** The walls under the roof: their outside faces and how tall they stand (none: posts). */
  walls: { rect: Rect; height: number } | null
  call: RoofPlaneCall
  replacement: RoofSegmentAddCall
  segment: ExpectedRoofSegment
  /** How far the segment's surface stands over the planes' (0: the same roof). */
  lift: number
}

const slopeOf = (pitch: number) => Math.atan(pitch / 12)

/** Where a plane call put the roof's surface at the wall face for a roof bearing on `plate`. */
function surfaceOnPlate(plate: number, pitch: number, thickness = PLANE_THICKNESS): number {
  const slope = slopeOf(pitch)
  return plate - (ROOF_PLANE_WALL_THICKNESS / 2) * Math.tan(slope) + thickness / Math.cos(slope)
}

/** The plate under a plane call's surface: what `eaveHeight` is to a segment. */
function plateUnder(call: RoofPlaneCall): number {
  const slope = slopeOf(call.pitch)
  return (
    call.eaveHeight +
    (ROOF_PLANE_WALL_THICKNESS / 2) * Math.tan(slope) -
    (call.thickness ?? PLANE_THICKNESS) / Math.cos(slope)
  )
}

function roofPlaneCase(
  name: string,
  walls: RoofPlaneCase['walls'],
  call: RoofPlaneCall,
  replacement: RoofSegmentAddCall,
): RoofPlaneCase {
  const [ax, az, bx, bz] = call.rect
  const t = ROOF_PLANE_WALL_THICKNESS
  const w = Math.abs(bx - ax) - t
  const d = Math.abs(bz - az) - t
  const axis = replacement.ridgeAxis
  const slope = slopeOf(call.pitch)
  const thickness = call.thickness ?? PLANE_THICKNESS
  const under = plateUnder(call)
  // a segment bears on its walls' tops at the lowest; over them, where the planes put it
  const eave = walls ? Math.max(under, walls.height) : under
  return {
    name,
    walls,
    call,
    replacement,
    segment: {
      roofType: replacement.roofType,
      name: replacement.name,
      centre: [(ax + bx) / 2, (az + bz) / 2],
      width: axis === 'x' ? w : d,
      depth: axis === 'x' ? d : w,
      rotation: axis === 'x' ? 0 : -Math.PI / 2,
      pitch: (slope * 180) / Math.PI,
      overhang: (call.overhang ?? PLANE_OVERHANG) / Math.cos(slope),
      ...(call.tool === 'gable_roof_planes'
        ? { gableOverhang: call.gableOverhang ?? PLANE_GABLE_OVERHANG }
        : {}),
      wallThickness: t,
      deckThickness: thickness - ROOF_PLANE_COVERING,
      shingleThickness: ROOF_PLANE_COVERING,
      eave,
    },
    lift: eave - under,
  }
}

/** The 12 × 8 m house, walls 2.6 m tall: its outside faces. */
const WIDE: Rect = [-0.08255, -0.08255, 12.08255, 8.08255]
/** The same house turned: 8 m wide, 12 m deep. */
const DEEP: Rect = [-0.08255, -0.08255, 8.08255, 12.08255]
/** A 10 m square house. */
const SQUARE: Rect = [-0.08255, -0.08255, 10.08255, 10.08255]
/** A porch roof on posts, clear of the house, their outside faces. */
const PORCH: Rect = [14, 2, 18, 6]
const PLATE = 2.6

const house = (rect: Rect) => ({ rect, height: PLATE })

export const ROOF_PLANE_CASES: readonly RoofPlaneCase[] = [
  roofPlaneCase(
    'hip_roof_planes defaults, its surface where a roof on the 2.6 m plate has it',
    house(WIDE),
    {
      tool: 'hip_roof_planes',
      rect: WIDE,
      pitch: 6,
      eaveHeight: surfaceOnPlate(PLATE, 6),
      name: 'Hip',
    },
    {
      roofType: 'hip',
      name: 'Hip',
      rect: WIDE,
      rectAt: 'outside',
      ridgeAxis: 'x',
      pitchTwelfths: 6,
      overhangIn: '0.457 m',
      thicknessIn: '0.29 m',
    },
  ),
  roofPlaneCase(
    "hip_roof_planes at the walls' tops (the plugin's own call): the planes sank into the walls",
    house(WIDE),
    { tool: 'hip_roof_planes', rect: WIDE, pitch: 6, eaveHeight: PLATE },
    {
      roofType: 'hip',
      name: 'Hip',
      rect: WIDE,
      rectAt: 'outside',
      ridgeAxis: 'x',
      pitchTwelfths: 6,
      overhangIn: '0.457 m',
      thicknessIn: '0.29 m',
    },
  ),
  roofPlaneCase(
    'hip_roof_planes deeper than wide (its ridge north-south), 5:12, 0.6 m eaves, 0.2 m thick',
    house(DEEP),
    {
      tool: 'hip_roof_planes',
      rect: DEEP,
      pitch: 5,
      eaveHeight: surfaceOnPlate(PLATE, 5, 0.2),
      overhang: 0.6,
      thickness: 0.2,
      name: 'Main',
    },
    {
      roofType: 'hip',
      name: 'Main',
      rect: DEEP,
      rectAt: 'outside',
      ridgeAxis: 'z',
      pitchTwelfths: 5,
      overhangIn: '0.6 m',
      thicknessIn: '0.2 m',
    },
  ),
  roofPlaneCase(
    'hip_roof_planes over a square: a pyramid, 8:12, 0.3 m eaves',
    house(SQUARE),
    {
      tool: 'hip_roof_planes',
      rect: SQUARE,
      pitch: 8,
      eaveHeight: surfaceOnPlate(PLATE, 8),
      overhang: 0.3,
    },
    {
      roofType: 'hip',
      name: 'Hip',
      rect: SQUARE,
      rectAt: 'outside',
      ridgeAxis: 'x',
      pitchTwelfths: 8,
      overhangIn: '0.3 m',
      thicknessIn: '0.29 m',
    },
  ),
  roofPlaneCase(
    'hip_roof_planes flush with the walls (no eaves), 4:12',
    house(WIDE),
    {
      tool: 'hip_roof_planes',
      rect: WIDE,
      pitch: 4,
      eaveHeight: surfaceOnPlate(PLATE, 4),
      overhang: 0,
    },
    {
      roofType: 'hip',
      name: 'Hip',
      rect: WIDE,
      rectAt: 'outside',
      ridgeAxis: 'x',
      pitchTwelfths: 4,
      overhangIn: '0 m',
      thicknessIn: '0.29 m',
    },
  ),
  roofPlaneCase(
    'hip_roof_planes on a plate 0.3 m over the walls: the eave given (floating over them, it stays on their storey)',
    house(WIDE),
    {
      tool: 'hip_roof_planes',
      rect: WIDE,
      pitch: 6,
      eaveHeight: surfaceOnPlate(PLATE + 0.3, 6),
    },
    {
      roofType: 'hip',
      name: 'Hip',
      rect: WIDE,
      rectAt: 'outside',
      ridgeAxis: 'x',
      pitchTwelfths: 6,
      overhangIn: '0.457 m',
      thicknessIn: '0.29 m',
      eaveHeight: PLATE + 0.3,
    },
  ),
  roofPlaneCase(
    'gable_roof_planes defaults, the ridge east-west: 18 in eaves, 12 in at the gable ends',
    house(WIDE),
    {
      tool: 'gable_roof_planes',
      rect: WIDE,
      ridgeAxis: 'x',
      pitch: 6,
      eaveHeight: surfaceOnPlate(PLATE, 6),
      name: 'Gable',
    },
    {
      roofType: 'gable',
      name: 'Gable',
      rect: WIDE,
      rectAt: 'outside',
      ridgeAxis: 'x',
      pitchTwelfths: 6,
      overhangIn: '0.457 m',
      gableOverhangIn: '0.305 m',
      thicknessIn: '0.29 m',
    },
  ),
  roofPlaneCase(
    "gable_roof_planes at the walls' tops: the planes sank into the walls",
    house(WIDE),
    { tool: 'gable_roof_planes', rect: WIDE, ridgeAxis: 'x', pitch: 6, eaveHeight: PLATE },
    {
      roofType: 'gable',
      name: 'Gable',
      rect: WIDE,
      rectAt: 'outside',
      ridgeAxis: 'x',
      pitchTwelfths: 6,
      overhangIn: '0.457 m',
      gableOverhangIn: '0.305 m',
      thicknessIn: '0.29 m',
    },
  ),
  roofPlaneCase(
    'gable_roof_planes, the ridge north-south over the deep house, 8:12',
    house(DEEP),
    {
      tool: 'gable_roof_planes',
      rect: DEEP,
      ridgeAxis: 'z',
      pitch: 8,
      eaveHeight: surfaceOnPlate(PLATE, 8),
    },
    {
      roofType: 'gable',
      name: 'Gable',
      rect: DEEP,
      rectAt: 'outside',
      ridgeAxis: 'z',
      pitchTwelfths: 8,
      overhangIn: '0.457 m',
      gableOverhangIn: '0.305 m',
      thicknessIn: '0.29 m',
    },
  ),
  roofPlaneCase(
    'gable_roof_planes, the ridge north-south across the wide house, 4:12',
    house(WIDE),
    {
      tool: 'gable_roof_planes',
      rect: WIDE,
      ridgeAxis: 'z',
      pitch: 4,
      eaveHeight: surfaceOnPlate(PLATE, 4),
    },
    {
      roofType: 'gable',
      name: 'Gable',
      rect: WIDE,
      rectAt: 'outside',
      ridgeAxis: 'z',
      pitchTwelfths: 4,
      overhangIn: '0.457 m',
      gableOverhangIn: '0.305 m',
      thicknessIn: '0.29 m',
    },
  ),
  roofPlaneCase(
    'gable_roof_planes with gable ends reaching past the eaves: 0.9 m rakes, 0.3 m eaves, 3:12',
    house(WIDE),
    {
      tool: 'gable_roof_planes',
      rect: WIDE,
      ridgeAxis: 'x',
      pitch: 3,
      eaveHeight: surfaceOnPlate(PLATE, 3, 0.25),
      overhang: 0.3,
      gableOverhang: 0.9,
      thickness: 0.25,
    },
    {
      roofType: 'gable',
      name: 'Gable',
      rect: WIDE,
      rectAt: 'outside',
      ridgeAxis: 'x',
      pitchTwelfths: 3,
      overhangIn: '0.3 m',
      gableOverhangIn: '0.9 m',
      thicknessIn: '0.25 m',
    },
  ),
  roofPlaneCase(
    'gable_roof_planes with flush gable ends',
    house(WIDE),
    {
      tool: 'gable_roof_planes',
      rect: WIDE,
      ridgeAxis: 'x',
      pitch: 6,
      eaveHeight: surfaceOnPlate(PLATE, 6),
      gableOverhang: 0,
    },
    {
      roofType: 'gable',
      name: 'Gable',
      rect: WIDE,
      rectAt: 'outside',
      ridgeAxis: 'x',
      pitchTwelfths: 6,
      overhangIn: '0.457 m',
      gableOverhangIn: '0 m',
      thicknessIn: '0.29 m',
    },
  ),
  roofPlaneCase(
    'gable_roof_planes over a porch on posts: its eave on the beam, given',
    null,
    {
      tool: 'gable_roof_planes',
      rect: PORCH,
      ridgeAxis: 'z',
      pitch: 6,
      eaveHeight: surfaceOnPlate(2.4, 6),
      name: 'Porch',
    },
    {
      roofType: 'gable',
      name: 'Porch',
      rect: PORCH,
      rectAt: 'outside',
      ridgeAxis: 'z',
      pitchTwelfths: 6,
      overhangIn: '0.457 m',
      gableOverhangIn: '0.305 m',
      thicknessIn: '0.29 m',
      eaveHeight: 2.4,
    },
  ),
]
