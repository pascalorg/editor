import { z } from 'zod'
import { measurement } from './measurement'
import { NodeId } from './node-id'

/**
 * Shaping the ground for what stands on it, and reading how the two meet: one set for whoever
 * lays out a garden and whoever seats a house. Heights are metres above the scene datum; points
 * are [x, z] metres in the site frame unless a field says otherwise.
 */

// Arrays avoid tuple-form JSON schemas that some clients cannot call.
const point = z.array(z.number()).length(2)
const range = z.object({ min: z.number(), max: z.number() })
const terrainScope = z
  .enum(['lot', 'context'])
  .optional()
  .describe('Default lot: stay inside the property. Context explicitly allows shaping beyond it.')
const samplingOutput = z.looseObject({
  approximate: z.literal(true),
  method: z.string(),
  spacingM: z.number(),
  heightStepM: z.number(),
  sampleCount: z.number().int(),
})

const findingOutput = z.object({
  code: z.string(),
  id: z.string(),
  value: z.number(),
  message: z.string(),
})

const GROUND_REFUSALS =
  'Refusals: no_site, ambiguous_site (more than one site), no_terrain (a persisted field that cannot be read or is not finite), invalid_input.'

export const readTerrainFactsTool = {
  name: 'read_terrain_facts',
  title: 'Read terrain facts',
  description:
    'Read how what is built meets the ground, as measured facts: heights are metres above the scene datum, points are [x, z] in the site frame, the ground is the persisted terrain or the flat datum where none is shaped. ' +
    'houses: per building, its ground level, the base of that level and its storey height, the top of its floor, whether the floor rests on the ground and follows it (floorFollowsGround) and what the storey then keeps (clearHeightM: a floor that follows the ground rises with the ground at its walls, the top of the storey does not), the ground under it (lowest, highest, mean), floorOverGroundM (floor top minus ground: negative where the ground stands over the floor), the share of the floor with ground over it and with air under it; per exterior wall, its side of the lot (the street side is front), the ground along its foot, the floor over that ground, fallAwayPercent (how the ground falls going away from the wall over 3 m; negative rises), fallAtWallPercent (the same over the first half metre from the foot of the wall), fallsTowardLengthM (the length where water runs to the wall: the ground climbs from its foot, without first falling, over 1 m or more and by 0.03 m or more; a face the ground steps up at is not a climb), lowLineUnderFootM (how far under the foot of the wall the lowest ground within 2.5 m lies), earthAgainstM (the ground at the outside face over the floor inside: earth the wall holds), earthLengthM (the length with more than 0.3 m of it), buriedShare (that earth against the storey height), faceBefore (a face the ground steps up at before the wall, across an areaway: its distance and height) and each window with its sill against the ground outside (underGroundM); per exterior door, its sill, what is outside it (the ground, or a slab laid there), stepM (sill minus outside: negative is ground over the sill) and the steps or ramp that serve it; roomsAgainstEarth, the rooms along a wall that holds earth: their length along outside walls and along those that hold earth, their openings with the ground under the sill and over it, and whether the room states artificial light and ventilation. Left and right are the sides of the lot as its setbacks name them, read along the street edge in the order its corners are listed; outward gives the direction itself. ' +
    'surfaces: each driveway, walk, patio and lawn slab, flat or draped, its height over the ground and its slope; a draped drive or walk is read the way it is travelled (down its middle, along the nearest side of its outline, over 3 m), with its cross fall apart and the steepest ground under it apart (steepestGroundPercent: its edges on a batter included). steps: each outside flight, its foot against the ground and its top against the sill of the door it reaches. ramps: each ramp, its steepest grade against its stated limit, each end against the ground beyond it, and its sides (the most the ground beside it stands over and under its surface, the height of its retaining sides, and the length of side where a higher face stands unheld). retaining: each terrain break with the height it holds, and each house within 10 m of it: on its high side (top) or its low side (foot), and how far its walls stand from the face. banks: ground steeper than 45 degrees that no face holds. earthwork: cut and fill against the ground before any tile was written (the frozen base field, or the datum; relief that was itself written as tiles counts as earthwork). ' +
    'open lists the facts past a limit, each with its number and a sentence; limits states those limits, which are design context, not a code check. ' +
    'section, when given, adds a section along a straight line: the ground at its breakpoints (stations where the ground departs from a straight line by more than 0.02 m) and each floor the line passes over, with its top and its clearance. ' +
    'Reads persisted terrain only; changes nothing. ' +
    GROUND_REFUSALS,
  input: {
    section: z
      .strictObject({
        from: point.describe('Section start [x,z] in site-frame metres.'),
        to: point.describe('Section end [x,z] in site-frame metres.'),
      })
      .optional()
      .describe('A straight line to cut a section along; omit for the facts alone.'),
  },
  annotations: { readOnlyHint: true },
}

const wallFactsOutput = z.object({
  wallId: z.string(),
  side: z.enum(['front', 'rear', 'left', 'right']).optional(),
  outward: point,
  lengthM: z.number(),
  groundM: range,
  floorOverGroundM: range,
  fallAwayPercent: range,
  fallAtWallPercent: range,
  fallsTowardLengthM: z.number(),
  lowLineUnderFootM: range,
  earthAgainstM: z.object({ max: z.number(), mean: z.number() }),
  earthLengthM: z.number(),
  buriedShare: z.number(),
  faceBefore: z.object({ distanceM: z.number(), heightM: z.number() }).optional(),
  windows: z.array(
    z.object({
      windowId: z.string(),
      sillM: z.number(),
      outsideM: z.number(),
      underGroundM: z.number(),
    }),
  ),
})
const doorFactsOutput = z.object({
  doorId: z.string(),
  wallId: z.string(),
  levelId: z.string(),
  at: point,
  sillM: z.number(),
  outside: z.enum(['ground', 'slab']),
  outsideId: z.string().optional(),
  outsideM: z.number(),
  stepM: z.number(),
  servedBy: z.string().optional(),
})

export const terrainFactsOutput = {
  hasTerrain: z.boolean(),
  houses: z.array(
    z.object({
      buildingId: z.string(),
      levelId: z.string(),
      standing: z.string(),
      levelBaseM: z.number(),
      storeyHeightM: z.number(),
      floorM: range,
      clearHeightM: z.number(),
      floorFollowsGround: z.boolean(),
      followingFloorOverBaseM: z.number(),
      groundM: z.object({ lowest: z.number(), highest: z.number(), mean: z.number() }),
      floorOverGroundM: range,
      groundOverFloorShare: z.number(),
      floorInAirShare: z.number(),
      walls: z.array(wallFactsOutput),
      doors: z.array(doorFactsOutput),
      roomsAgainstEarth: z.array(
        z.object({
          zoneId: z.string(),
          name: z.string(),
          frontageM: z.number(),
          earthFrontageM: z.number(),
          openingsClear: z.number().int(),
          openingsUnderGround: z.number().int(),
          declared: z.boolean(),
        }),
      ),
    }),
  ),
  surfaces: z.array(
    z.object({
      slabId: z.string(),
      kind: z.string(),
      mode: z.enum(['flat', 'draped']),
      areaM2: z.number(),
      overGroundM: range,
      slopePercent: z.object({ max: z.number(), mean: z.number() }),
      crossFallPercent: z.object({ max: z.number(), mean: z.number() }).optional(),
      steepestGroundPercent: z.number(),
    }),
  ),
  steps: z.array(
    z.object({
      stairId: z.string(),
      foot: point,
      footM: z.number(),
      groundAtFootM: z.number(),
      footOverGroundM: z.number(),
      topM: z.number(),
      doorId: z.string().optional(),
      topOverSillM: z.number().optional(),
    }),
  ),
  ramps: z.array(
    z.object({
      rampId: z.string(),
      lengthM: z.number(),
      maximumSlopePercent: z.number(),
      statedLimitPercent: z.number(),
      ends: z.array(
        z.object({
          at: point,
          heightM: z.number(),
          groundBeyondM: z.number(),
          overGroundM: z.number(),
        }),
      ),
      sides: z.object({
        cutMaxM: z.number(),
        fillMaxM: z.number(),
        retainingHeightM: z.number(),
        unheldLengthM: z.number(),
      }),
    }),
  ),
  retaining: z.array(
    z.object({
      breakId: z.string(),
      kind: z.string(),
      lengthM: z.number(),
      heightM: range,
      houses: z.array(
        z.object({
          buildingId: z.string(),
          standsAt: z.enum(['top', 'foot']),
          distanceM: z.number(),
        }),
      ),
    }),
  ),
  banks: z.object({ steepestDeg: z.number(), areaM2: z.number() }),
  earthwork: z
    .object({
      cutM3: z.number(),
      fillM3: z.number(),
      against: z.enum(['base_field', 'datum']),
    })
    .optional(),
  open: z.array(findingOutput),
  limits: z.record(z.string(), z.number()),
  section: z
    .object({
      from: point,
      to: point,
      lengthM: z.number(),
      ground: z.array(z.object({ sM: z.number(), groundM: z.number() })),
      floors: z.array(
        z.object({
          slabId: z.string(),
          fromM: z.number(),
          toM: z.number(),
          topM: z.number(),
          overGroundM: range,
        }),
      ),
    })
    .optional(),
  note: z.string().optional(),
}

export const SEAT_STRATEGIES = ['balance', 'fill', 'cut', 'keep', 'walk_out', 'hillside'] as const

export const seatHouseTool = {
  name: 'seat_house',
  title: 'Seat house',
  description:
    'Seat a house on the ground: choose the height the base of its ground level stands at against the ground under it, move the building to that height (its plan stays where it is), and grade the ground to meet it, in one undo step. The house is the largest slab of a level (levelId, default the ground level of the building), which must be the ground level of its building, not a level under or over it. ' +
    'The ground at the walls is brought to the base of the level, as it lies on a flat site. A floor that rests on the ground follows the ground at its walls while the top of its storey stays on the base of the level: with the ground at the base the floor stands where it was drawn and the storey keeps its height. A floor the ground had lifted before a level was put under it is put back on the base of its level, as thick as it was, and a floor stored thinner than a slab can be takes the thickness of a slab (floorsPutBack). ' +
    'strategy says where the base goes. balance (the default): at the height where the cut and the fill of the whole grading are equal; a move of the building under 0.03 m is not made, and on ground that is level under the house the edge of the pad stands on it, as fill does. fill: the edge of the pad at the highest ground under the house, so nothing is cut under it and the low side is filled. cut: the edge of the pad at the lowest ground under the house, so the house is dug in and the high side is cut. keep: the building stays where it is and only the ground moves, to the base it has. walk_out: for a house with a level under its ground level; that lower level stands with its base on the lowest ground along the open side (openToward, [x,z], default downhill), an apron apronM deep (default 3 m) is levelled before that side at the lower base, and around the rest of the house the hill is only cut back where it stands over the base of the ground level and keeps its own slope elsewhere. hillside: the house is backed into the slope; its base stands as for cut (or at groundM, which this strategy alone takes with it), the ground that stands over the base is not battered back but held against the house by a face on the hull of its outline, areawayM from the walls (default 0: the walls themselves hold it; above 0 a level areaway lies between the walls and the face), written as a retaining terrain break; the face holds retainM of ground at most (default the height of the storey) and ground over that is cut back at the batter; where the ground lies under the base the pad and its batter are filled as for cut. An outline that is not convex is excavated to its hull: the part of the hull outside the house stands at the base, as a court. groundM instead states the height of the ground at the walls in metres above datum; give it or strategy, not both (hillside excepted). ' +
    'Where the ground rises beyond the pad, or is held, a low line carries water round the house instead of to its walls: a level bottom 0.75 m wide, at the edge of the pad and 0.15 m under it at its summit (before held ground: 1 m from the face, 0.25 m under the ground, the ground falling 8 % from the face to it), falling 1 % along its length from its summit to each end, and from each end straight down the ground until the ground is lower than it. lowLine in the answer gives its length, its summit and lowest heights, the deepest it is cut and the ends that came out (outlets); an end that finds no lower ground within 8 m, or ground that stands over the base on every side, is said in unmet. A declared wall (wallM) gets no low line. A house seated before is left as it stands by the same strategy (no_change), its low line kept; a face an earlier seating left is taken away when this one makes none. ' +
    'The pad reaches marginM (default 1.0 m) beyond the outline and falls away from the walls by padFallPercent (default 5) over that margin, so water leaves the walls and, under a bank that rises, the edge of the pad is the low line that carries it round. Beyond the pad the ground is a batter, 1 m of height per run metres (default 2), to the ground that was there, looked for within reachM (default 15 m); terraceRiserM cuts it into steps; wallM declares a retaining wall at the pad edge on the side the ground leaves the pad, written as a terrain break (a real wall) when exactWall is true, else as a step on the 0.5 m lattice; inside an exact wall the pad is level, a terrain break holding one height on its side. ' +
    'Writes level-0 tiles at 0.5 m; a numeric terrain-break plane wins over what is written under it. Scope lot (default) writes nothing outside the property: where the batter would pass the property line it stops there, and unmet says so with the step it leaves. ' +
    'Returns strategy, levelId, buildingId, groundAtWallsM, padEdgeM, movedBuildingByM, groundUnderHouseM before (lowest, highest, mean), cutVolumeM3, fillVolumeM3, netM3, batterSlopeDeg, steepestSampledSlopeDeg, daylight, wall, terraces, walkOut (the lower level, its base, the open side, the apron, the fall across the house and the height between the two levels), hillside (retainM, areawayM, faceBreakId), lowLine, floorsPutBack, stepsResolved (outside flights of one straight run that climbed from the ground to a door of the house that opens on the ground are solved again from the new sill and ground, each with its new rise and step count, or removed where the door now meets the ground; a flight of several runs, a door with a slab before it and a ramp are left as they were), unmet (what the grading could not do, in sentences), floorM, and after: floorOverGroundM, clearHeightM, each exterior door with its stepM, and the open terrain facts about this house once seated (the terrain facts read gives every one). ' +
    'Refusals: no_site, ambiguous_site, no_terrain, invalid_input (a strategy other than hillside with groundM; a level that is not the ground level of its building; walk_out with no level under it, or with exactWall; hillside with wallM or exactWall; retainM or areawayM without hillside), level_not_found, not_a_level, no_building, building_rotation_unsupported, footprint_empty, disconnected_footprint, invalid_polygon, outside_property, crossing_breaks, conflicting_breaks, unsupported_geometry, no_change (the house already stands so and less than 0.25 m3 would move), sampling_limit (the edit over 400,000 terrain samples, or the corners of the outline times its samples over 2,000,000). An outline of more than 256 corners gets no low line, and unmet says so.',
  input: {
    scope: terrainScope,
    levelId: z
      .string()
      .optional()
      .describe(
        'Level whose largest slab is the house outline; default the ground level of the building.',
      ),
    strategy: z
      .enum(SEAT_STRATEGIES)
      .optional()
      .describe(
        'Where the base of the level goes against the ground; default balance. Not with groundM.',
      ),
    groundM: measurement('length', 'm', {
      min: -1000,
      max: 1000,
      description:
        'Height of the ground at the walls (the base of the level) in metres above datum, instead of a strategy.',
    }).optional(),
    openToward: point
      .optional()
      .describe(
        'walk_out: the open side looks this way, [x,z] in the site frame (need not be unit); default downhill.',
      ),
    apronM: measurement('length', 'm', {
      positive: true,
      max: 20,
      description: 'walk_out: depth of the level apron before the open side; default 3 m.',
    }).optional(),
    marginM: measurement('length', 'm', {
      min: 0,
      max: 10,
      description: 'How far the pad reaches beyond the outline; default 1.0 m.',
    }).optional(),
    padFallPercent: z
      .number()
      .min(0)
      .max(15)
      .optional()
      .describe('Fall of the pad away from the walls, percent over the margin; 0–15, default 5.'),
    run: z
      .number()
      .min(0.25)
      .max(20)
      .optional()
      .describe(
        'Batter run: horizontal metres per metre of height (2 is 1:2); 0.25–20, default 2.',
      ),
    reachM: measurement('length', 'm', {
      positive: true,
      max: 60,
      description: 'How far beyond the pad edge the batter is looked for; default 15 m.',
    }).optional(),
    terraceRiserM: measurement('length', 'm', {
      min: 0.2,
      max: 1.5,
      description: 'Terrace riser: the batter in steps of this height. Omit for a plain batter.',
    }).optional(),
    retainM: measurement('length', 'm', {
      positive: true,
      max: 12,
      description:
        'hillside: the most ground the face holds over the base; default the height of the storey. Ground over it is cut back at the batter.',
    }).optional(),
    areawayM: measurement('length', 'm', {
      min: 0,
      max: 10,
      description:
        'hillside: distance from the walls to the face that holds the ground; default 0, the walls themselves hold it.',
    }).optional(),
    wallM: measurement('length', 'm', {
      min: 0,
      max: 6,
      description:
        'Declared retaining wall at the pad edge, on the side the ground leaves the pad; omit for none.',
    }).optional(),
    exactWall: z
      .boolean()
      .optional()
      .describe('Write the wall as a terrain break instead of a lattice step. Needs wallM.'),
  },
}

export const seatHouseOutput = {
  strategy: z.enum([...SEAT_STRATEGIES, 'ground']),
  levelId: z.string(),
  buildingId: z.string(),
  groundAtWallsM: z.number(),
  padEdgeM: z.number(),
  movedBuildingByM: z.number(),
  floorM: z.number(),
  groundUnderHouseM: z.object({ lowest: z.number(), highest: z.number(), mean: z.number() }),
  cutVolumeM3: z.number(),
  fillVolumeM3: z.number(),
  netM3: z.number(),
  batterSlopeDeg: z.number().optional(),
  steepestSampledSlopeDeg: z.number().optional(),
  daylight: z
    .object({ reached: z.boolean(), farthestChangeM: z.number(), outsideLotM2: z.number() })
    .optional(),
  wall: z.looseObject({ heightM: z.number(), exact: z.boolean() }).optional(),
  terraces: z
    .object({ riserM: z.number(), treadM: z.number(), resolutionM: z.number() })
    .optional(),
  walkOut: z
    .object({
      lowerLevelId: z.string(),
      lowerBaseM: z.number(),
      openSide: point,
      fallAcrossHouseM: z.number(),
      storeyBelowM: z.number(),
      apron: z.array(point).optional(),
    })
    .optional(),
  lowLine: z
    .object({
      lengthM: z.number(),
      summitM: z.number(),
      lowestM: z.number(),
      deepestCutM: z.number(),
      outlets: z.number().int(),
    })
    .optional(),
  hillside: z
    .object({ retainM: z.number(), areawayM: z.number(), faceBreakId: z.string().optional() })
    .optional(),
  floorsPutBack: z.array(z.string()).optional(),
  stepsResolved: z
    .array(
      z.object({
        stairId: z.string(),
        doorId: z.string(),
        stepCount: z.number().int().optional(),
        riseM: z.number().optional(),
        removed: z.literal(true).optional(),
      }),
    )
    .optional(),
  unmet: z.array(z.string()),
  changedSamples: z.number().int(),
  after: z.object({
    floorOverGroundM: range,
    clearHeightM: z.number(),
    doors: z.array(
      z.object({
        doorId: z.string(),
        levelId: z.string(),
        stepM: z.number(),
        outside: z.string(),
      }),
    ),
    open: z.array(findingOutput),
  }),
  sampling: samplingOutput.optional(),
}

const polygonArea = z
  .array(point)
  .max(512)
  .describe('Polygon corners in order, [x,z] metres in the site frame. At most 512 corners.')
const circleArea = z.strictObject({
  center: point.describe('Centre [x,z] in site-frame metres.'),
  radiusM: measurement('length', 'm', {
    positive: true,
    max: 1000,
    description: 'Circle radius in metres.',
  }),
})

export const setTerrainPlaneTool = {
  name: 'set_terrain_plane',
  title: 'Set terrain plane',
  description:
    'Set the ground over an area (a polygon of [x,z] corners or a circle {center, radiusM}) to one sloping plane: a lot that falls to the street, a lawn with a cross fall, a level bench. through gives the plane by points with heights, metres above datum: three points not in a line fix it; two points give a plane that rises from one to the other and is level across that direction; one point gives a level plane at its height. Outside the area the ground blends back to what was there over blendM (default 0, a hard edge), in proportion to the distance from the area. ' +
    'Writes level-0 tiles at 0.5 m, never the frozen legacy site.terrain; heights are quantised to 0.01 m; a numeric terrain-break plane wins over what is written under it. Scope lot (default) keeps the area and the write inside the property. ' +
    'Returns slopePercent and fallDirection (unit [x,z] pointing downhill; [0,0] for a level plane), minM and maxM over the area after, cutVolumeM3, fillVolumeM3, netM3, changedSamples and sampling; volumes are estimates over the quantised field. One undo step. ' +
    'Refusals: no_site, ambiguous_site, no_terrain, invalid_input (points that coincide or lie in a line, a point that is not finite or lies more than 500 m from the property), footprint_empty, invalid_polygon, outside_property, no_change, sampling_limit (the area with its blend holds more than 400,000 terrain samples: about 300 m square).',
  input: {
    scope: terrainScope,
    area: z
      .union([polygonArea, circleArea])
      .describe('A polygon of [x,z] corners, or a circle {center, radiusM}.'),
    through: z
      .array(
        z.strictObject({
          at: point.describe('A point [x,z] in site-frame metres.'),
          heightM: measurement('length', 'm', {
            min: -1000,
            max: 1000,
            description: 'Height of the plane at that point, metres above datum.',
          }),
        }),
      )
      .min(1)
      .max(3)
      .describe('One, two or three points the plane passes through, each with its height.'),
    blendM: measurement('length', 'm', {
      min: 0,
      max: 30,
      description: 'Distance outside the area over which the ground blends back; default 0.',
    }).optional(),
  },
}

export const terrainPlaneOutput = {
  slopePercent: z.number(),
  fallDirection: point,
  minM: z.number(),
  maxM: z.number(),
  cutVolumeM3: z.number(),
  fillVolumeM3: z.number(),
  netM3: z.number(),
  changedSamples: z.number().int(),
  sampling: samplingOutput,
}

export const gradeAlongLineTool = {
  name: 'grade_along_line',
  title: 'Grade along line',
  description:
    'Grade a strip of ground along a line: the bed of a drive or a path that follows the ground within a slope limit, a swale (the strip lowered), a berm (the strip raised). line is the centreline, [x,z] points in order in the site frame; the strip is widthM wide (default 1.2 m) and level across. Along the line the strip stands offsetM over the ground that is there (default 0; negative for a swale, positive for a berm); with maxSlopePercent the profile is eased so no stretch is steeper, cutting the rises and filling the dips it must, and it keeps the ground height (plus offsetM) at both ends unless startHeightM or endHeightM state them. Beside the strip the ground is a batter, 1 m of height per run metres (default 2), to the ground that was there. ' +
    'Writes level-0 tiles at 0.5 m; heights are quantised to 0.01 m; a numeric terrain-break plane wins over what is written under it. Scope lot (default) writes nothing outside the property. It lays no surface: outline is the strip as a polygon, for a surface laid on it. ' +
    'Returns lengthM, startM and endM (strip heights at the ends), steepestPercent (of the strip) and groundSteepestPercent (of the ground along the line before), profile (the strip height and the ground before at its breakpoints, sM metres along), outline, cutVolumeM3, fillVolumeM3, netM3, deepestCutM, highestFillM, changedSamples and sampling, and for a strip lowered into the ground (offsetM under 0) drains: where its bottom is lowest (start, end or between), that height, and standingWaterM, the depth of the closed hollow the strip leaves (0 where it comes out on lower ground: a swale that leads somewhere). One undo step. ' +
    'Limits, checked before anything is sampled: the line is at most 2,000 m long and 64 points, every point within 500 m of the property, the strip and its batters at most 40 m to a side, the edit at most 400,000 terrain samples. ' +
    'Refusals: no_site, ambiguous_site, no_terrain, invalid_input (a point that is not finite or lies more than 500 m from the property, an end height with no slope limit, a strip so far off the ground that its batters would pass 40 m), outside_property, slope_limit_unreachable (the ends differ by more than the limit allows over this length; the message states the length that would hold it), no_change, sampling_limit (a line over 2,000 m, or an edit over 400,000 samples).',
  input: {
    scope: terrainScope,
    line: z
      .array(point)
      .min(2)
      .max(64)
      .describe('Centreline points in order, [x,z] metres in the site frame.'),
    widthM: measurement('length', 'm', {
      positive: true,
      max: 20,
      description: 'Width of the level strip; default 1.2 m.',
    }).optional(),
    offsetM: measurement('length', 'm', {
      min: -3,
      max: 3,
      description:
        'Height of the strip over the ground that is there; default 0. Negative lowers it (a swale), positive raises it (a berm).',
    }).optional(),
    maxSlopePercent: z
      .number()
      .positive()
      .max(100)
      .optional()
      .describe('Steepest grade along the strip, percent; omit to follow the ground as it is.'),
    startHeightM: measurement('length', 'm', {
      min: -1000,
      max: 1000,
      description: 'Height of the strip at the first point; default the ground there plus offsetM.',
    }).optional(),
    endHeightM: measurement('length', 'm', {
      min: -1000,
      max: 1000,
      description: 'Height of the strip at the last point; default the ground there plus offsetM.',
    }).optional(),
    run: z
      .number()
      .min(0.25)
      .max(20)
      .optional()
      .describe('Side batter run: horizontal metres per metre of height; 0.25–20, default 2.'),
  },
}

export const gradeAlongLineOutput = {
  lengthM: z.number(),
  startM: z.number(),
  endM: z.number(),
  steepestPercent: z.number(),
  groundSteepestPercent: z.number(),
  profile: z.array(z.object({ sM: z.number(), heightM: z.number(), groundM: z.number() })),
  outline: z.array(point),
  cutVolumeM3: z.number(),
  fillVolumeM3: z.number(),
  netM3: z.number(),
  drains: z
    .object({
      lowestAt: z.enum(['start', 'end', 'between']),
      lowestM: z.number(),
      standingWaterM: z.number(),
    })
    .optional(),
  deepestCutM: z.number(),
  highestFillM: z.number(),
  changedSamples: z.number().int(),
  sampling: samplingOutput,
}

export const addStepsToGroundTool = {
  name: 'add_steps_to_ground',
  title: 'Add steps to ground',
  description:
    'Add the outside flight an exterior door needs to reach the ground: its top at the sill, against the wall, its foot on the ground in front of the door, the rise and the run solved from the two (no riser over 0.19 m, two risers and a going of 0.63 m). The door is one with a floor on one side only; the ground is the persisted terrain or the flat datum. width defaults to the door width plus 0.4 m. ' +
    'Returns stairId, doorId, stepCount, riseM, runM, sillM, the foot [x,z] in the site frame and groundAtFootM. One undo step. ' +
    'Refusals: node_not_found, not_a_door, not_exterior (a floor on both sides of the door, or on neither), steps_not_needed (the sill is within 0.05 m of the ground outside), door_below_ground (the ground stands over the sill: grade it first), steps_too_tall (2 m or more, or a storey: that is a flight between storeys, not steps to the ground), building_rotation_unsupported, no_site, ambiguous_site, no_terrain.',
  input: {
    doorId: NodeId.describe('The exterior door the steps climb to.'),
    width: measurement('length', 'm', {
      positive: true,
      max: 6,
      description: 'Width of the flight; default the door width plus 0.4 m.',
    }).optional(),
  },
}

export const stepsToGroundOutput = {
  stairId: z.string(),
  doorId: z.string(),
  stepCount: z.number().int(),
  riseM: z.number(),
  runM: z.number(),
  sillM: z.number(),
  foot: point,
  groundAtFootM: z.number(),
}

export const addTerracesTool = {
  name: 'add_terraces',
  title: 'Add terraces',
  description:
    'Cut a slope into level terraces that touch, one below the other, each held by a wall or a bank, with the steps between them. line is the way down: two [x,z] points in the site frame, from the upper edge of the first terrace to the lower edge of the last; the terraces are count equal rectangles along it (2 to 12, each 1.5 m deep or more), widthM wide across it, centred on it. ' +
    'Their heights, metres above datum: with neither topM nor bottomM each terrace stands at the mean of the ground under it, so its cut and its fill are alike; topM alone or bottomM alone states that terrace and the others keep their steps from it; both give equal risers between them. ' +
    'Every second terrace, from the first, is written as a closed retaining terrain break at its exact height (a wall on its four sides wherever the ground beside it stands higher or lower), and the terraces between as level ground on the 0.5 m lattice: two neighbours meet at one vertical face with no ground between them. Beyond the sides of a terrace that is not a break, and beyond the lower edge of the last one when count is even, the ground is a bank, 1 m of height per run metres (default 2), to the ground that was there. A numeric terrain-break plane wins over what is written under it. Scope lot (default) writes nothing outside the property. ' +
    'stepsAt, 0 to 1 across the width (0.5 is the middle), puts a flight from each terrace up to the one above it there: its foot on the lower terrace, its top at the face, rise and run solved from the two heights (no riser over 0.19 m). A flight belongs to a level of a building: with none in the scene no flight is made and the answer says so. ' +
    'Returns terraces (index, levelM, outline, heldAs break or lattice, breakId, the ground under it before as lowest and highest), edges (top, each pair of neighbours and bottom: the height between and what holds it, wall or bank), steps (stairId, from and to terrace, riseM, stepCount) or stepsNote, cutVolumeM3, fillVolumeM3, netM3, changedSamples and sampling. One undo step. ' +
    'Limits, checked before anything is sampled: both points finite and within 500 m of the property, the line 3 to 200 m long, widthM at most 100 m, the edit at most 400,000 terrain samples. ' +
    'Refusals: no_site, ambiguous_site, no_terrain, invalid_input (a line under 3 m or over 200 m, terraces under 1.5 m deep, a point that is not finite or lies more than 500 m from the property), outside_property, crossing_breaks, conflicting_breaks, unsupported_geometry, no_change, sampling_limit.',
  input: {
    scope: terrainScope,
    line: z
      .array(point)
      .length(2)
      .describe(
        'The way down: [x,z] of the upper edge of the first terrace, then of the lower edge of the last, site frame.',
      ),
    widthM: measurement('length', 'm', {
      positive: true,
      max: 100,
      description: 'Width of the terraces across the line, centred on it.',
    }),
    count: z.number().int().min(2).max(12).describe('How many terraces, 2 to 12.'),
    topM: measurement('length', 'm', {
      min: -1000,
      max: 1000,
      description:
        'Height of the first (upper) terrace, metres above datum; default the mean ground under it.',
    }).optional(),
    bottomM: measurement('length', 'm', {
      min: -1000,
      max: 1000,
      description:
        'Height of the last (lower) terrace, metres above datum; default the mean ground under it.',
    }).optional(),
    run: z
      .number()
      .min(0.25)
      .max(20)
      .optional()
      .describe('Bank run: horizontal metres per metre of height; 0.25–20, default 2.'),
    stepsAt: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe(
        'Where across the width the flights between terraces stand, 0 to 1; omit for no flights.',
      ),
  },
}

export const addTerracesOutput = {
  terraces: z.array(
    z.object({
      index: z.number().int(),
      levelM: z.number(),
      outline: z.array(point),
      heldAs: z.enum(['break', 'lattice']),
      breakId: z.string().optional(),
      groundBeforeM: z.object({ lowest: z.number(), highest: z.number() }),
    }),
  ),
  edges: z.array(
    z.object({
      at: z.string(),
      heightM: z.number(),
      heldBy: z.enum(['wall', 'bank', 'none']),
    }),
  ),
  steps: z
    .array(
      z.object({
        stairId: z.string(),
        fromTerrace: z.number().int(),
        toTerrace: z.number().int(),
        riseM: z.number(),
        stepCount: z.number().int(),
      }),
    )
    .optional(),
  stepsNote: z.string().optional(),
  cutVolumeM3: z.number(),
  fillVolumeM3: z.number(),
  netM3: z.number(),
  changedSamples: z.number().int(),
  sampling: samplingOutput,
}
