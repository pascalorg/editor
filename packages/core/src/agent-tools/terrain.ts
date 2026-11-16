import { z } from 'zod'
import { measurement } from './measurement'

// Arrays avoid tuple-form JSON schemas that some MCP clients cannot call.
const point = z.array(z.number()).length(2)
const resolution = z.number().positive().optional()
const samplingOutput = z.looseObject({
  approximate: z.literal(true),
  method: z.string(),
  spacingM: z.number(),
  heightStepM: z.number(),
  sampleCount: z.number().int(),
})

const breakRange = z.object({ minM: z.number(), maxM: z.number() })
export const terrainBreakOutput = {
  breakId: z.string(),
  line: z.array(point),
  kind: z.enum(['cliff', 'retaining', 'soil']),
  lengthM: z.number(),
  left: breakRange,
  right: breakRange,
  dropMinM: z.number(),
  dropMaxM: z.number(),
  faceAreaM2: z.number(),
  sampling: z
    .looseObject({
      approximate: z.literal(true),
      method: z.string(),
      spacingM: z.number(),
      sampleCount: z.number().int(),
    })
    .optional(),
}
const breaksOutput = z.array(z.object(terrainBreakOutput)).optional()

const terrainRefusals =
  'Returns breaks with directed side height ranges, nonnegative absolute side-to-side drop range and vertical face area; ground-side facts are labelled numerical samples. Slopes and normals do not average across breaks. Contour cells straddling breaks are omitted rather than interpolated into a false slope; break lines are reported separately. Refusals: no_site, ambiguous_site (more than one site), no_terrain (a persisted field that cannot be read or is not finite; a site with no shaped ground is not refused, it is the flat datum plane and answers with hasTerrain false and level facts), invalid_input, sampling_limit (sampling budget exceeded), unsupported_geometry (unsupported persisted break or insufficient same-side ground samples), crossing_breaks, conflicting_breaks (closed numeric exterior combined with other features). Reads persisted terrain only, never an unfinished sculpt stroke; changes nothing.'

const writeRefusals =
  'Numeric terrain-break planes override later base sculpt and tile writes: edit the feature heights to change those effective surfaces. Reported sample changes and sample height ranges describe the tile edit, not an effective height change beneath a numeric break. ' +
  'Refusals: no_site, ambiguous_site (more than one site), no_terrain (a persisted field that cannot be read or is not finite), invalid_input, footprint_empty, invalid_polygon, outside_property (the area reaches past the site polygon without scope context), no_change (no sample would move), sampling_limit (the edit exceeds the bounded sample budget). Writes level-0 terrain tiles at 0.5 metre spacing, never rewrites the frozen legacy site.terrain. The write is one undo step, ends any unfinished sculpt stroke first, and works from persisted ground, never that stroke. New tiles sample the existing ground or its slope continuation before editing, including legacy grids with any spacing or origin. Untouched points inside seeded tiles may differ through height quantization and triangle resampling; planar ground differs by at most half the tile height step, while old creases can differ more. Heights are quantised to the tile step, so reported heights are the achieved sample heights.'

const terrainScope = z
  .enum(['lot', 'context'])
  .optional()
  .describe('Default lot: stay inside the property. Context explicitly allows shaping beyond it.')

const polygonArea = z
  .array(point)
  .max(512)
  .describe('Polygon corners in order, [x,z] metres in the site frame. At most 512 corners.')
const circleArea = z.strictObject({
  x: z.number().describe('Centre x in site-frame metres.'),
  z: z.number().describe('Centre z in site-frame metres.'),
  radiusM: measurement('length', 'm', {
    positive: true,
    description: 'Circle radius in metres.',
  }),
})

export const addTerrainBreakTool = {
  name: 'add_terrain_break',
  title: 'Add terrain break',
  description:
    'Numeric feature heights keep precedence over later brushes and base-tile writes; edit the feature heights to move those planes. ' +
    'Create one vertical cliff, retaining or soil boundary under the site (cliff is bare rock, retaining a built wall, soil an earth face), without changing terrain samples or frozen legacy data. line is directed site-frame [x,z] metres; positive XZ cross product is left and points exactly on the line choose left. Numeric sides are exact elevations; ground preserves the effective surrounding terrain, using only same-region base samples where no other feature sets a height. Give at least one numeric side. Open lines must be straight, ordered and collinear, covering the whole lot intersection; their supporting line separates half-planes through context too. Closed lines repeat the first point and must be simple convex CCW (left inside). No batter. Breaks cannot cross or touch. At most one open feature; closed rings apply outer-to-inner, so a pad overrides a surrounding cliff independently of ids. A closed numeric exterior cannot be combined with another feature. Keep-ground preserves wholly same-region source triangles and extends the nearest such triangle where the original straddles a break, bounded to 32 source-grid cells; too-narrow sampled regions are refused, not blended across the break. scope defaults lot; context permits authored line outside the property. Returns breakId, line, kind, lengthM, left/right height ranges, nonnegative absolute dropMinM/dropMaxM and vertical faceAreaM2; ground traces carry a numerical sampling label. Refusals: no_site, ambiguous_site, invalid_input, unsupported_geometry, crossing_breaks, conflicting_breaks, outside_property, no_terrain, sampling_limit. One undo step.',
  input: {
    line: z.array(point).min(2).max(513),
    kind: z.enum(['cliff', 'retaining', 'soil']),
    left: z.union([z.number(), z.literal('ground')]),
    right: z.union([z.number(), z.literal('ground')]),
    scope: terrainScope,
    name: z.string().optional(),
  },
}

export const readSiteTerrainTool = {
  name: 'read_site_terrain',
  title: 'Read site terrain',
  description:
    'Read ground facts over footprint, default the site polygon: hasTerrain (false where no relief is shaped: the ground is then the flat datum plane at y = 0, answered with level facts and a note), flat, reliefM (maxM minus minM), minM, maxM, datumM:0, slopeMeanDeg (area-weighted interior samples), slopeMaxDeg, slopeAtCorners with unit normals, edgeDrops with signed dropM = height(from) minus height(to) and sampled maxSlopeDeg, areaAboveGradeM2 and areaBelowGradeM2. Areas are plan-area estimates above/below scene datum y=0, not earthwork volumes. Relief, flatness, aggregate slopes and areas are sampled estimates, labelled with sampling method, cellM, field spacing/height quantization and sampleCount; peaks between samples can be missed. Interior cell midpoints are weighted by their rectangular cell area, boundary cells are included only when their midpoint is inside the footprint; corners and edge samples contribute extrema, not the mean or area. cellM defaults to field spacing. Coordinates are site-frame [x,z] metres, slopes in degrees from horizontal. Slopes and normals use core central differences at field spacing, sampling the same continuation beyond authored borders. Additional refusals: footprint_empty, invalid_polygon, sampling_insufficient (no interior midpoint; use a finer cellM). ' +
    terrainRefusals,
  input: {
    footprint: z
      .array(point)
      .max(512)
      .optional()
      .describe(
        'Footprint corners in order, [x,z] metres; default the site polygon. At most 512 corners to bound validation work.',
      ),
    cellM: resolution.describe(
      'Maximum interior cell size and edge sample spacing in metres; default field spacing. At most 20,000 samples including corners and edges.',
    ),
  },
  annotations: { readOnlyHint: true },
}

export const sampleTerrainLineTool = {
  name: 'sample_terrain_line',
  title: 'Sample terrain line',
  description:
    'Read one straight segment from `from` to `to` in site-frame [x,z] metres. Returns points [{x,z,yM,slopeDeg}] including both endpoints (one point for a zero-length segment), with heights above scene datum y=0 and slope degrees from horizontal. Slopes use core central differences at field spacing, sampling the same continuation beyond authored borders. stepM is the maximum gap, default field spacing; samples divide the segment evenly. A polyline is the concatenation of segment calls. sampling labels the profile as discrete samples, with stepM, actualStepM, field spacing/height quantization and sampleCount; terrain between samples is not measured by this profile. ' +
    terrainRefusals,
  input: {
    from: point.describe('Segment start [x,z] in site-frame metres.'),
    to: point.describe('Segment end [x,z] in site-frame metres.'),
    stepM: resolution.describe(
      'Maximum gap between samples in metres; default field spacing. At most 20,000 points.',
    ),
  },
  annotations: { readOnlyHint: true },
}

export const readTerrainContoursTool = {
  name: 'read_terrain_contours',
  title: 'Read terrain contours',
  description:
    'Read contours of the persisted heightfield at intervalM (default 1 metre), levels at multiples of the interval from scene datum y=0. Returns {datum:0, lines:[{levelM,points:[[x,z],...]}], sampling}. This is a marching-squares approximation at field spacing, with centimetre endpoint chaining and a site-polygon midpoint mask: whole segments are retained by midpoint, so endpoints can extend up to a cell outside the lot. It is not an exact triangle-plane contour or a surveyed/geographic elevation. Flat fields legitimately return no lines. sampling labels method, intervalM, field spacing/height quantization and sampleCount (returned contour vertices). Additional refusals: footprint_empty, invalid_polygon, contour_limit (more than 400 level intervals, more than 2,000,000 cell-level visits or more than 20,000 returned vertices). ' +
    terrainRefusals,
  input: {
    intervalM: resolution.describe(
      'Vertical interval in metres; default 1. Too many levels are refused, never silently reported as no contours.',
    ),
  },
  annotations: { readOnlyHint: true },
}

export const shapeSiteTerrainTool = {
  name: 'shape_site_terrain',
  title: 'Shape site terrain',
  description:
    'Shape the persisted ground over an area (a polygon of [x,z] corners or a circle {x,z,radiusM}), inside the site polygon by default, or beyond it with scope context. Verbs: flatten sets samples to heightM (required for flatten); raise/lower move samples by heightM metres (default 1, the sculpt stroke metre); smooth lerps samples toward an 8-pass diffusion of the field, as the sculpt smooth brush does. strength (0..1, default 1) scales the effect; softness fades it linearly over that many metres inside the area edge (default 0, a hard edge). Returns {changedSamples, beforeMinMaxM, afterMinMaxM, touchedM2, sampling}: the min/max heights over the touched samples before and after, and their plan area at field spacing (an estimate, labelled in sampling). ' +
    writeRefusals,
  input: {
    scope: terrainScope,
    verb: z.enum(['flatten', 'raise', 'lower', 'smooth']).describe('How to move the ground.'),
    area: z
      .union([polygonArea, circleArea])
      .describe(
        'A polygon of [x,z] corners, or a circle {x, z, radiusM}; inside the property unless scope is context.',
      ),
    heightM: measurement('length', 'm', {
      description:
        'Flatten target height in metres above datum (required for flatten), or the metres raise/lower move the ground.',
    }).optional(),
    strength: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe('Fraction of the full effect to apply, 0..1; default 1.'),
    softness: measurement('length', 'm', {
      min: 0,
      description: 'Edge falloff distance in metres inside the area; default 0.',
    }).optional(),
  },
}

export const carveTerrainPadTool = {
  name: 'carve_terrain_pad',
  title: 'Carve terrain pad',
  description:
    'Level a pad of ground at one height and blend it back to the existing ground. The pad polygon (site-frame [x,z] metres, inside the property unless scope context) is set exactly to padHeightM, or to padFromHighestM metres below the highest sample under the pad; give exactly one. Outside the pad, samples within blendM (default 0) move toward the pad height in proportion to their distance from the pad edge, never past it and never upward: the blend ring only cuts. With default scope lot it also stays inside the property. Returns {cutVolumeM3, fillVolumeM3, netM3 (cut minus fill), padAreaM2, padHeightM, maxSlopeIntoPadDeg, retainingHeightM, changedSamples, sampling}. Cut is earth removed above the pad surface, fill earth added below it; volumes are integrals over the quantised field at its spacing — estimates with their resolution in sampling, not survey numbers. retainingHeightM gives, per pad edge, the highest original ground above the pad along that edge (0 where the ground falls away). Additional refusal: pad_too_small (no field sample falls inside the pad). ' +
    'edges defaults slope. With edges slope and blendM 0 (the default), a convex pad is written as an exact closed terrain break of kind soil at the pad height, ground outside, without tile writes: a slope with no run is a vertical earth face. Then changedSamples is 0; breaks[0] carries the face (kind soil, faceAreaM2, dropMinM and dropMaxM); cutVolumeM3, fillVolumeM3 and netM3 are plan-area integrals over the pad, not sample sums; retainingHeightM is, per pad edge, the greatest height of the face along it, whether the ground stands above or below the pad; maxSlopeIntoPadDeg is 90 where a face has height and 0 otherwise. A pad that already stands on the ground writes nothing (no_change). A pad that cannot be a break, because it is not convex or its break would cross or touch another terrain break, keeps the lattice write, and edge says so: {kind lattice_step, exact false, reason, resolutionM, note}; its step then passes through lattice triangles up to one cell wide rather than along the pad line. With blendM above 0 the blend ring is written as above and the pad stays on the lattice. ' +
    'With edges cliff or retaining, creates a convex CCW closed terrain break (cliff bare rock, retaining a built wall) at the exact pad height, ground outside, without tile writes; blendM must be zero. ' +
    writeRefusals,
  input: {
    scope: terrainScope,
    edges: z.enum(['cliff', 'retaining', 'slope']).optional(),
    pad: polygonArea.describe(
      'Pad polygon corners in order, [x,z] metres; inside the property unless scope is context.',
    ),
    padHeightM: measurement('length', 'm', {
      description: 'Absolute pad height in metres above datum. Give this or padFromHighestM.',
    }).optional(),
    padFromHighestM: measurement('length', 'm', {
      min: 0,
      description:
        'Cut this many metres below the highest ground under the pad. Give this or padHeightM.',
    }).optional(),
    blendM: measurement('length', 'm', {
      min: 0,
      description: 'Distance outside the pad over which ground blends back to existing; default 0.',
    }).optional(),
  },
}

const gradePadInput = z.strictObject({
  levelId: z
    .string()
    .optional()
    .describe("Level whose largest slab is this pad's house outline. Not with footprint."),
  footprint: polygonArea
    .optional()
    .describe(
      "This pad's outline, [x,z] metres in the site frame; needs padHeightM. Not with levelId.",
    ),
  padHeightM: measurement('length', 'm', {
    description:
      'Absolute height of this pad in metres above datum; default its slab top minus padBelowSlabM.',
  }).optional(),
  padBelowSlabM: measurement('length', 'm', {
    min: 0,
    max: 2,
    description: 'How far under its slab top this pad stands when padHeightM is not given.',
  }).optional(),
  marginM: measurement('length', 'm', {
    min: 0,
    max: 10,
    description: 'How far this pad reaches beyond its outline; default the top-level marginM.',
  }).optional(),
})

export const gradeAroundHouseTool = {
  name: 'grade_around_house',
  title: 'Grade around house',
  description:
    'Grade the ground around a house as a function of the distance to its outline. The outline is the largest slab of a level (levelId, default the lowest level with a slab) or a footprint given ([x,z] corners; then padHeightM is required). Out to marginM from the outline (default 1.0 m) the ground is a pad at padHeightM, by default padBelowSlabM (0.15 m) under the slab top. Beyond it the ground is a batter, 1 m of height per run metres (run 2 is 1:2; default 2), falling where the ground was lower and rising where it was higher until it meets the ground that was there (the daylight line); ground beyond reachM (default 15 m) from the pad edge is not touched. Distance is Euclidean to the outline, so the contours are the outline offset, rounded at convex corners: a curved house gets a curved slope. terraceRiserM (0.2–1.5 m) cuts the batter into steps, each tread run times the riser, on the 0.5 m lattice (a tread under 1 m is not drawn). ' +
    'wallM (0–6 m) declares a retaining wall at the pad edge on whichever side the ground leaves the pad: the ground beyond starts wallM above the pad where it rises and wallM below it where it falls. By default it is a vertical step on the 0.5 m lattice (exact false). exactWall true writes a retaining terrain-break instead (exact true, with its breakId): it needs wallM above 0 and one pad, rings the convex hull of the outline (a notch is filled into the pad) or, with edge, the pad strip, replaces the wall an earlier call made for the same house, and refuses crossing_breaks, unsupported_geometry (a strip that is not convex across the lot) and outside_property. ' +
    'upperLevelM is a flat lawn after the bank: the ground beyond the bank is raised or cut to that height, out to the property edge (scope context: to reachM). ' +
    "edge grades across the lot along one straight edge instead of around the outline: the outline is extended along the edge, so pad, wall, bank and lawn run the lot's whole width. Give exactly one of facing (front, rear, left or right of the lot, the street edge being the front), direction [x,z] (the side of the outline facing that way) or line [[x,z],[x,z]] (on or beyond the outline). The pad is the strip from the front of the outline to the edge plus marginM; its front batters as a ring does; upperLevelM applies beyond the edge only. With exactWall the wall is a closed break around the pad strip (padStripM, along the edge's normal), clipped to the property: the ground is level inside it and meets the ground outside it in a face, so the lot in front of the strip keeps its own fall. " +
    'pads gives one pad per level of a split-level house, each its own levelId (or footprint with padHeightM), padHeightM, padBelowSlabM and marginM (the top-level values are the defaults); a sample follows the nearest outline, so abutting pads at different heights meet in a step. pads excludes the top-level levelId, footprint and padHeightM; edge and exactWall take one pad. ' +
    'Writes level-0 tiles at 0.5 m, never the frozen legacy site.terrain; heights are quantised to 0.01 m. A numeric terrain-break plane wins over what is written under it; otherwise the later of this tool, carve_terrain_pad and shape_site_terrain wins, and an earlier pad is ground the batter meets (without upperLevelM it never raises ground above its pad on a cut side nor lowers it below on a fill side). Scope lot (default) writes nothing outside the property. ' +
    "Returns padHeightM and marginM (or pads), batterSlopeDeg (the stated batter), cutVolumeM3, fillVolumeM3, steepestSampledSlopeDeg (an exact wall's face is not in the tiles), daylight {reached, farthestChangeM, outsideLotM2}, lawn, edge, wall, terraces; volumes are estimates over the quantised field. One undo step. " +
    'Refusals: no_site, ambiguous_site, no_terrain, invalid_input, invalid_polygon, footprint_empty, level_not_found, not_a_level, no_building, building_rotation_unsupported, disconnected_footprint, outside_property, crossing_breaks, conflicting_breaks, unsupported_geometry, no_change (no sample would move), sampling_limit.',
  input: {
    scope: terrainScope,
    levelId: z
      .string()
      .optional()
      .describe(
        'Level whose largest slab is the house outline; default the lowest level with a slab. Not with footprint or pads.',
      ),
    footprint: polygonArea
      .optional()
      .describe(
        'A house outline to grade around, [x,z] metres in the site frame; needs padHeightM. Not with levelId or pads.',
      ),
    padHeightM: measurement('length', 'm', {
      description:
        'Absolute pad height in metres above datum; default the slab top minus padBelowSlabM.',
    }).optional(),
    padBelowSlabM: measurement('length', 'm', {
      min: 0,
      max: 2,
      description:
        'How far under the slab top the pad stands when padHeightM is not given; default 0.15 m.',
    }).optional(),
    marginM: measurement('length', 'm', {
      min: 0,
      max: 10,
      description: 'How far the pad reaches beyond the outline; default 1.0 m.',
    }).optional(),
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
      description:
        'How far beyond the pad edge the batter is looked for; default 15 m, at most 60 m. A lawn (upperLevelM) holds past it to the property edge.',
    }).optional(),
    terraceRiserM: measurement('length', 'm', {
      min: 0.2,
      max: 1.5,
      description:
        'Terrace riser in metres: the batter in steps of this height. Omit for a plain batter.',
    }).optional(),
    wallM: measurement('length', 'm', {
      min: 0,
      max: 6,
      description:
        'Declared retaining wall at the pad edge, in metres, on the side the ground leaves the pad; omit for none.',
    }).optional(),
    exactWall: z
      .boolean()
      .optional()
      .describe(
        'Write the wall as a terrain-break (a real wall, exact true) instead of a lattice step. Needs wallM and one pad.',
      ),
    upperLevelM: measurement('length', 'm', {
      description:
        'Absolute height in metres above datum of a flat lawn after the bank: raised or cut to it. Omit for ground that meets the natural slope.',
    }).optional(),
    edge: z
      .strictObject({
        facing: z
          .enum(['front', 'rear', 'left', 'right'])
          .optional()
          .describe(
            'The side of the lot the edge faces: the lot edge with that role (front is the street).',
          ),
        direction: point
          .optional()
          .describe('The edge faces this way, [x,z] in the site frame (need not be unit).'),
        line: z
          .array(point)
          .length(2)
          .optional()
          .describe(
            'The edge stands on the line through these two [x,z] points, on or beyond the outline.',
          ),
      })
      .optional()
      .describe(
        'Grade across the lot along one straight edge instead of around the outline. Give exactly one of facing, direction, line.',
      ),
    pads: z
      .array(gradePadInput)
      .min(1)
      .max(6)
      .optional()
      .describe(
        'One pad per level, each with its own height and margin. Not with levelId or footprint.',
      ),
  },
}

const gradePadOutput = z.object({
  levelId: z.string().optional(),
  slabId: z.string().optional(),
  slabTopM: z.number().optional(),
  footprint: z.array(point),
  padHeightM: z.number(),
  marginM: z.number(),
  padAreaM2: z.number(),
})

export const gradeAroundHouseOutput = {
  breaks: breaksOutput,
  levelId: z.string().optional(),
  slabId: z.string().optional(),
  footprint: z.array(point).optional(),
  slabTopM: z.number().optional(),
  padHeightM: z.number().optional(),
  marginM: z.number().optional(),
  pads: z.array(gradePadOutput).optional(),
  run: z.number(),
  reachM: z.number(),
  batterSlopeDeg: z.number(),
  padAreaM2: z.number(),
  cutVolumeM3: z.number(),
  fillVolumeM3: z.number(),
  netM3: z.number(),
  changedSamples: z.number().int(),
  steepestSampledSlopeDeg: z.number(),
  daylight: z.object({
    reached: z.boolean(),
    farthestChangeM: z.number(),
    outsideLotM2: z.number(),
  }),
  lawn: z.object({ levelM: z.number(), bankRunM: z.number(), areaM2: z.number() }).optional(),
  edge: z
    .object({
      role: z.string().optional(),
      normal: point,
      frontM: z.number(),
      edgeM: z.number(),
      padStripM: z.object({ fromM: z.number(), toM: z.number() }),
    })
    .optional(),
  terraces: z
    .object({ riserM: z.number(), treadM: z.number(), resolutionM: z.number() })
    .optional(),
  wall: z
    .object({
      heightM: z.number(),
      exact: z.boolean(),
      resolutionM: z.number().optional(),
      note: z.string().optional(),
      breakId: z.string().optional(),
      kind: z.literal('retaining').optional(),
      lengthM: z.number().optional(),
    })
    .optional(),
  sampling: samplingOutput,
}

export const setSiteLotTool = {
  name: 'set_site_lot',
  title: 'Set site lot',
  description:
    'With an open terrain break, the new lot crossing must remain covered by its authored endpoints; otherwise refuses unsupported_geometry. Extend the break endpoints before enlarging the lot. ' +
    'Set the property polygon without rewriting existing ground, setbacks or street-edge indices. Give polygon, or both widthM and depthM for an axis-aligned rectangle centred at anchor (default the current lot bounds centre). Coordinates are site-frame [x,z] metres. New land reads the same continuous ground: authored tiles, then the frozen legacy field, then its border slope decaying over 64 metres to a horizontal context plane. That plane is the lower of datum zero and the frozen legacy minimum, or zero without a legacy field; it is an inferred continuation, not surveyed ground. Painted ground is not rewritten either: ground laid over the whole lot (Environment lay_ground with site) carries over onto new land, as grass of the same tint and height or the same surface; ground laid over part of the lot, or before that was kept, does not, and new land there stays unpainted until it is laid. Tiled ground has no fixed lot-size ceiling; facts use a bounded sampling resolution for large lots. Returns siteId, polygon, areaM2 and the sampled minM/maxM height range with resolution. Refusals: no_site, ambiguous_site, invalid_input, invalid_polygon, footprint_empty, no_terrain (unreadable persisted ground). One undo step.',
  input: {
    polygon: polygonArea.optional(),
    widthM: measurement('length', 'm', {
      positive: true,
      description: 'Rectangle width in metres; give with depthM instead of polygon.',
    }).optional(),
    depthM: measurement('length', 'm', {
      positive: true,
      description: 'Rectangle depth in metres; give with widthM instead of polygon.',
    }).optional(),
    anchor: point.optional().describe('Rectangle centre [x,z]; default current lot bounds centre.'),
  },
}

export const siteLotOutput = {
  siteId: z.string(),
  polygon: z.array(point),
  areaM2: z.number(),
  minM: z.number(),
  maxM: z.number(),
  sampling: samplingOutput,
}

export const describeTerrainUnderHouseTool = {
  name: 'describe_terrain_under_house',
  title: 'Describe terrain under house',
  description:
    'Advisory ground facts under a house: the footprint of the largest slab on a level (levelId, default the lowest level with a slab), in site-frame [x,z] metres, with slabTopM, highestM and lowestM ground under it, reliefM (highest minus lowest), clearanceUnderSlabM (slab top minus the highest ground: the least headroom under the slab), and dropAtEdges — per footprint edge, the largest fall from slab top to ground sampled along that edge. needsGuardAt lists the edges whose drop exceeds guardAdvisory.thresholdM. The guard link is advisory only, never a write: guardAdvisory states the threshold (the same 0.5 m verify_scene uses for its unguarded_drop observation — only the threshold is shared, since these drops compare slab top against terrain alone while verify_scene also accounts for landings, neighbouring surfaces and existing guards) and the typical requirement (a guard is typically required above about 0.76 m, IRC R312). Heights are sampled estimates at field spacing, labelled in sampling. Refusals: no_site, ambiguous_site, no_terrain, invalid_input, level_not_found, not_a_level, no_building, building_rotation_unsupported (the building tips out of the site plane), footprint_empty (no slab footprint on the level), disconnected_footprint (the largest slab is in several disconnected pieces), invalid_polygon, sampling_limit, sampling_insufficient. Where no relief is shaped the ground under the house is the datum plane, with a note. Reads persisted terrain only; changes nothing.',
  input: {
    levelId: z
      .string()
      .optional()
      .describe(
        'Level whose largest slab is the house footprint; default the lowest level with a slab.',
      ),
  },
  annotations: { readOnlyHint: true },
}

export const siteTerrainOutput = {
  breaks: breaksOutput,
  hasTerrain: z.boolean(),
  flat: z.boolean(),
  reliefM: z.number(),
  minM: z.number(),
  maxM: z.number(),
  datumM: z.literal(0),
  slopeMeanDeg: z.number(),
  slopeMaxDeg: z.number(),
  slopeAtCorners: z.array(
    z.object({
      x: z.number(),
      z: z.number(),
      slopeDeg: z.number(),
      normal: z.array(z.number()).length(3),
    }),
  ),
  edgeDrops: z.array(
    z.object({ from: point, to: point, dropM: z.number(), maxSlopeDeg: z.number() }),
  ),
  areaAboveGradeM2: z.number(),
  areaBelowGradeM2: z.number(),
  note: z.string().optional(),
  sampling: samplingOutput.extend({ cellM: z.number() }),
}

export const terrainLineOutput = {
  breaks: breaksOutput,
  points: z.array(z.object({ x: z.number(), z: z.number(), yM: z.number(), slopeDeg: z.number() })),
  note: z.string().optional(),
  sampling: samplingOutput.extend({ stepM: z.number(), actualStepM: z.number() }),
}

export const terrainContoursOutput = {
  breaks: breaksOutput,
  datum: z.literal(0),
  lines: z.array(z.object({ levelM: z.number(), points: z.array(point) })),
  note: z.string().optional(),
  sampling: samplingOutput.extend({ intervalM: z.number() }),
}

const minMaxOutput = z.object({ minM: z.number(), maxM: z.number() })
const edgeOutput = z.object({ from: point, to: point })

export const shapeTerrainOutput = {
  changedSamples: z.number().int(),
  beforeMinMaxM: minMaxOutput,
  afterMinMaxM: minMaxOutput,
  touchedM2: z.number(),
  sampling: samplingOutput,
}

export const terrainPadOutput = {
  breaks: breaksOutput,
  cutVolumeM3: z.number(),
  fillVolumeM3: z.number(),
  netM3: z.number(),
  padAreaM2: z.number(),
  padHeightM: z.number(),
  maxSlopeIntoPadDeg: z.number(),
  retainingHeightM: z.array(edgeOutput.extend({ heightM: z.number() })),
  changedSamples: z.number().int(),
  sampling: samplingOutput,
  /** Present when a pad with blendM 0 could not be written as an exact face. */
  edge: z
    .object({
      kind: z.literal('lattice_step'),
      exact: z.literal(false),
      reason: z.string(),
      resolutionM: z.number(),
      note: z.string(),
    })
    .optional(),
}

export const terrainUnderHouseOutput = {
  breaks: breaksOutput,
  levelId: z.string(),
  slabId: z.string(),
  footprint: z.array(point),
  slabTopM: z.number(),
  highestM: z.number(),
  lowestM: z.number(),
  reliefM: z.number(),
  clearanceUnderSlabM: z.number(),
  dropAtEdges: z.array(edgeOutput.extend({ dropM: z.number() })),
  needsGuardAt: z.array(edgeOutput.extend({ dropM: z.number() })),
  guardAdvisory: z.object({
    advisory: z.literal(true),
    thresholdM: z.number(),
    basis: z.string(),
    typicalRequirement: z.string(),
  }),
  note: z.string().optional(),
  sampling: samplingOutput.extend({ cellM: z.number() }),
}
