import { z } from 'zod'
import { registerPlansGuideSection } from './guides'
import { measurement } from './measurement'
import { NodeId } from './node-id'

const guideIds = z.array(NodeId).min(1).max(32)

export const importPlanReferenceTool = {
  name: 'import_plan_reference',
  title: 'Import a plan',
  description:
    'Place a floor plan on a floor as an uncalibrated reference (a guide). An SVG plan also stores its contours, so create_reference_elements can build walls, slabs, units and zones from them; a PNG, JPEG or WebP plan has its walls traced into lines (the result says traced), which build the same way; doors and windows show as gaps in them, with no swings, and a host that cannot decode the image places it to read from (note). Then give it a scale: calibrate_plan_reference on a known length, or match_plan_reference onto a calibrated plan (the user can also do either in the editor). Returns the guide id, its pixel size, its largest contours with their position, and its lines grouped by stroke width.',
  input: {
    source: z
      .string()
      .min(1)
      .max(8_000_000)
      .describe(
        'The plan: the URL of a file the user attached, inline SVG markup, a data:image/...;base64 URL, or the asset:<id> of a file uploaded with request_upload (where the server offers it).',
      ),
    levelId: NodeId.optional().describe('The floor to place it on. Default: the active floor.'),
    name: z.string().min(1).max(120).optional().describe('Name for the plan, e.g. "Floor 2".'),
    sharedFrame: z
      .string()
      .min(1)
      .max(80)
      .optional()
      .describe(
        'Declare plans that share one image frame (same size and origin, e.g. every floor exported from one building map): once one is calibrated, align_reference_frames places the others.',
      ),
  },
}

export const adjustPlanReferenceTool = {
  name: 'adjust_plan_reference',
  title: 'Nudge a plan',
  description:
    'Correct a placed plan by hand: move it in metres, turn it about its centre, or scale it by a factor. Plans and elements linked to it follow. refine_plan_match makes this correction automatically after a match.',
  input: {
    guideId: NodeId.describe('The plan (guide) to move.'),
    dx: z.number().min(-200).max(200).default(0).describe('Move along x, in metres.'),
    dz: z.number().min(-200).max(200).default(0).describe('Move along z, in metres.'),
    rotateDegrees: z
      .number()
      .min(-180)
      .max(180)
      .default(0)
      .describe(
        'Turn about the plan centre, in degrees; positive turns it anticlockwise in the 2D plan.',
      ),
    scaleFactor: z
      .number()
      .min(0.5)
      .max(2)
      .default(1)
      .describe('Multiply the plan scale, e.g. 1.01 to make it 1% larger.'),
  },
}

export const refinePlanMatchTool = {
  name: 'refine_plan_match',
  title: 'Refine a plan match',
  description:
    "Tighten a plan match: fit a plan's outline onto the matching contour of a calibrated plan by least squares (rotation, translation, and scale within maxScaleChange), move the plan there, and report the leftover error in metres. Use after a two-point match, whose precision depends on the two points picked.",
  input: {
    targetGuideId: NodeId.describe('The plan to move, e.g. a unit plan just matched onto a floor.'),
    anchorGuideId: NodeId.describe('The calibrated plan it sits on, e.g. the floor plan.'),
    targetContourId: z
      .string()
      .optional()
      .describe("The target contour to fit. Default: the target's largest area."),
    anchorContourId: z
      .string()
      .optional()
      .describe('The anchor contour to fit onto. Default: the closest one of similar size.'),
    maxScaleChange: z
      .number()
      .min(0)
      .max(0.5)
      .default(0.02)
      .describe('How much the fit may rescale the target, as a fraction. Default 0.02 (2%).'),
  },
}

export const createReferenceElementsTool = {
  name: 'create_reference_elements',
  title: 'Build from calibrated references',
  description:
    "Create editable walls, slabs, units, zones or balconies from referenceContours stored on guides. Uses the same construction operation as the editor. import_plan_reference lists contour IDs: the largest contours, and lines grouped by stroke width (the thickest group is usually the walls). Omit shapeIds to use all contours; pass several guideIds for a building. Requires a calibrated plan (calibrate_plan_reference, match_plan_reference, align_reference_frames, or the user in the editor). Review the source contours: apartment envelopes do not include interior walls, corridors, doors or facade details. Walls join the walls already on the floor, as drawn walls do: a wall they meet is split there, and a wall drawn inside an existing one (a unit plan's outer wall on the envelope) is left out. An untouched default site grows to take the building; a site the user drew is left as drawn (outsideSite). Repeated calls reuse existing walls and skip existing contour elements.",
  input: {
    guideIds,
    kind: z
      .enum(['walls', 'slab', 'unit', 'zone', 'balcony', 'door', 'window'])
      .describe(
        'door or window: each group of touching shapes (a leaf and its arc, a frame and its glass) is one opening on the wall it sits in, or in a new wall across the gap it spans, as the plan workspace builds them.',
      ),
    shapeIds: z.array(z.string()).min(1).max(512).optional(),
    strokeWidthsPx: z
      .array(z.number().min(0.1).max(200))
      .min(1)
      .max(20)
      .optional()
      .describe(
        "Build every line of these stroke widths, as import_plan_reference's lineGroups list them (strokeWidthPx), on each plan in guideIds, instead of listing shapeIds: a group of more than 60 lines comes without its ids. One width group per thickness, e.g. [3, 4] with thickness 0.11 for a raster plan's partitions.",
      ),
    thickness: z.number().min(0.02).max(1).optional(),
    height: z
      .number()
      .min(0)
      .max(100)
      .optional()
      .describe(
        'Wall height in metres. Walls taller than their storey raise it to this height (storeysRaised in the result); without it they take the storey height.',
      ),
    balcony: z
      .object({
        depth: z.number().min(0.2).max(10),
        reverse: z.boolean(),
        thickness: z.number().min(0.02).max(1),
        railing: z.enum(['slat', 'rail', 'glass', 'none']),
        railingHeight: z.number().min(0.3).max(3),
        openEdge: z.number().int().nonnegative().nullable(),
      })
      .optional(),
    outlineSteps: z
      .enum(['facade', 'balconies', 'walls'])
      .optional()
      .describe(
        "A building map's outline steps out and back where it draws a balcony (survey_plan_references lists them). The floor plate and walls run straight along the facade past each step. `facade` (default): nothing is built in the step; the result's balconyWalls names the wall behind each one with the balcony's width and depth, for a balcony-stack facade unit (apply_facade, scope wall). `balconies`: build each step as a plain balcony. `walls`: follow the steps, for a bay window.",
      ),
    select: z
      .array(z.enum(['outline', 'apartments', 'cores']))
      .min(1)
      .max(3)
      .optional()
      .describe(
        "For building maps: build from the survey's groups on each floor — the outline, every apartment, every core (stair, lift, trash room) — instead of listing shapeIds, which differ on every floor. One call builds the same thing on all the floors in guideIds: walls with select apartments and cores are the party, corridor and core walls; unit with select apartments gives every apartment its unit.",
      ),
    replace: z
      .boolean()
      .optional()
      .describe(
        'Rebuild what these plan shapes built before: first remove the nodes of this kind that the same shapes built (never what was drawn by hand), with the openings and facade pieces on them, then build again — after correct_plan_reading, to turn balconies built as walls into balconies. One undo step; the result lists what was removed.',
      ),
    gaps: z
      .enum(['doors'])
      .optional()
      .describe(
        "With kind walls: a plan leaves a gap in its walls at each door and window. `doors` closes every gap the new walls leave (two walls in line, or a wall stopping short of another) with a wall across it, so the rooms close. Inside, where the plan draws the door's swing, the wall takes a door of the gap's width (doorsInGaps), and a gap with no swing is an open passage and stays open. Where the gap alone does not say what fills it (on the outside walls, or anywhere on a plan that draws no curves, a traced picture), openGaps lists each wall built across one with its place, width and t: add the door, window or slider the plan shows there, or delete the wall where the plan leaves it open (a passage, a porch, an alfresco).",
      ),
    into: z
      .enum(['fits'])
      .optional()
      .describe(
        "`fits`: build these unit plans into every apartment survey_plan_references fits them to, on every floor, mirrored or turned the way each apartment lies (its unitFits). Pass the unit plan's wall lines as shapeIds. The apartment gives the scale.",
      ),
  },
}

export const alignReferenceFramesTool = {
  name: 'align_reference_frames',
  title: 'Share measured reference frame',
  description:
    'Transfer a calibrated guide transform to guides with the exact same declared sharedFrame and dimensions in the same building. Moves linked reference geometry with the frame. Does not infer scale or align unrelated images: calibrate the anchor first.',
  input: { anchorGuideId: NodeId, targetGuideIds: guideIds },
}

// Fixed-length arrays, not tuples: the MCP SDK and zod write tuples as different JSON schemas.
const planPoint = z.array(z.number()).length(2)
const planPoints = z
  .array(planPoint)
  .length(2)
  .describe("Two points in the plan's own pixels (x to the right, y down), in order.")

export const getPlanReferenceTool = {
  name: 'get_plan_reference',
  title: 'Read a plan',
  description:
    "Read a placed plan: its pixel size, whether it is calibrated and on what, and its contours with position (xPx, yPx of the top-left corner, widthPx, heightPx, in the plan's pixels with y down), largest first. Filter by size or by a region to find a door leaf, a bathtub, a stair, a lift, a trash room or an apartment outline to calibrate or match on.",
  input: {
    guideId: NodeId.describe('The plan (guide) to read.'),
    minPx: z
      .number()
      .min(0)
      .optional()
      .describe('Only contours at least this long on their longer side.'),
    maxPx: z
      .number()
      .min(0)
      .optional()
      .describe('Only contours at most this long on their longer side.'),
    region: planPoints
      .optional()
      .describe(
        'Only contours inside this box: its top-left and bottom-right corners, in plan pixels.',
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .optional()
      .describe('At most this many contours. Default 60.'),
  },
}

export const calibratePlanReferenceTool = {
  name: 'calibrate_plan_reference',
  title: 'Calibrate a plan',
  description:
    "Give a plan its scale from one known length, as the editor's plan workspace does: a printed dimension, or a standard size you can see (an entry door leaf, a bathtub, a stair tread). Measure a contour (a door leaf end to end, a tub along its long side) or two points. Never an assumed room or bay size. The first point stays where it is. Say in label what you measured, so the user can check it. A plan that is already calibrated is refused unless replace.",
  input: {
    guideId: NodeId.describe('The plan (guide) to calibrate.'),
    contourId: z
      .string()
      .min(1)
      .optional()
      .describe(
        'A contour to measure (get_plan_reference lists them): a line end to end, an area along its bounding box.',
      ),
    edge: z
      .enum(['long', 'short'])
      .optional()
      .describe("For an area contour: its bounding box's long side (default) or short side."),
    points: planPoints.optional().describe('Or the two ends of the known length, in plan pixels.'),
    standard: z
      .enum(['entry-door', 'bathtub', 'stair-tread'])
      .optional()
      .describe(
        'A standard size you can see on the plan: an entry door leaf (36 in), a bathtub (60 in) or a stair tread (11 in).',
      ),
    length: measurement('length', 'm', {
      positive: true,
      max: 1000,
      description: 'Or the real length measured, e.g. a printed "12\'6"" or "3.8 m".',
    }).optional(),
    label: z
      .string()
      .min(3)
      .max(160)
      .describe('What you measured, e.g. "B2 entry door leaf, US standard 36 in".'),
    replace: z.boolean().optional().describe('Recalibrate a plan that already has a scale.'),
  },
}

export const matchPlanReferenceTool = {
  name: 'match_plan_reference',
  title: 'Match two plans',
  description:
    "Line one plan up on another from features they share, as the editor's plan workspace does: the same stair, lift or trash room on two floors, or a unit plan's outline on its apartment in a floor plan. Give the same two points on each plan in the same order (e.g. the stair's centre, then the lift's centre), or one contour on each (their bounding boxes' corners, for plans drawn the same way round). If the anchor is calibrated, the target takes its scale and moves onto it; if only the target is, the anchor takes the target's scale and the target moves onto it. Tighten afterwards with refine_plan_match.",
  input: {
    targetGuideId: NodeId.describe('The plan to move, e.g. a unit plan.'),
    anchorGuideId: NodeId.describe('The plan it goes on, e.g. the floor plan. It does not move.'),
    targetPoints: planPoints.optional().describe('Two points on the target plan.'),
    anchorPoints: planPoints
      .optional()
      .describe('The same two features on the anchor plan, in the same order.'),
    targetContourId: z.string().min(1).optional().describe('Or a contour on the target plan.'),
    anchorContourId: z
      .string()
      .min(1)
      .optional()
      .describe('And the matching contour on the anchor plan.'),
  },
}

export const surveyPlanReferencesTool = {
  name: 'survey_plan_references',
  title: 'Survey plans',
  description:
    'Study placed plans before building, as a person would: which floors are identical or nearly so and what differs; what each building map holds (its outline, apartments, cores such as stairs and lifts, balconies stepping out of the outline, and text drawn as shapes, which is never built); and where each unit plan fits on the floors, the same way round, mirrored or turned. It reads by rule (shapes by size, balconies as steps out of the outline) and says how each balcony was found; look at the plan and correct what it reads wrongly with correct_plan_reading.',
  input: {
    guideIds: z
      .array(NodeId)
      .min(1)
      .max(32)
      .optional()
      .describe('The plans to survey. Default: every placed plan.'),
  },
}

const planSide = z.enum(['north', 'south', 'east', 'west'])

export const correctPlanReadingTool = {
  name: 'correct_plan_reading',
  title: 'Correct a plan reading',
  description:
    "survey_plan_references reads a building map by rule: shapes by size (apartments, cores, text), balconies as short steps out of the outline. Where the plan says otherwise, correct the reading here; the survey, create_reference_elements (select, the balcony steps) and apply_facade's balconies scope then read the corrected plan. Pass the floors of one family together. Corrections are kept on each plan and add up; reset clears them. Plan pixels: x to the right, y down, north up.",
  input: {
    guideIds,
    roles: z
      .record(z.string(), z.enum(['apartment', 'core', 'label', 'ignore']))
      .optional()
      .describe('Shapes read as the wrong thing, by id, and what they are.'),
    addBalconies: z
      .array(
        z.object({
          box: planPoints.describe("Two opposite corners of the balcony, in the plan's pixels."),
          against: planSide.describe('The side of the box where the wall behind it stands.'),
        }),
      )
      .max(64)
      .optional()
      .describe(
        'Balconies the survey missed: a loggia drawn inside the outline (the walls then go round behind it), a balcony drawn without a shape of its own.',
      ),
    dropBalconies: z
      .array(planPoint)
      .max(64)
      .optional()
      .describe(
        'A point inside each balcony the survey read wrongly (a bay window, a jog of the drawing).',
      ),
    reset: z.boolean().optional().describe('Clear the corrections kept on these plans first.'),
  },
}

/** The plans guide's step 1, step 2, step 3, brought with these tools. */
registerPlansGuideSection({
  name: 'read',
  order: 1,
  text: "1. Read. Create one level per floor first, then import each floor plan onto its own level (import_plan_reference with its levelId), never several floors on one level; pass sharedFrame when several come from one building map (same image size and origin). SVG plans carry contours to build from, raster plans their traced walls, grouped by stroke width; a brochure may draw its outside walls no thicker than its partitions, so read which lines are outside from the outline, not the width. survey_plan_references finds the identical and similar floors, what each building map holds (outline, apartments, cores, balconies, text) and where each unit plan fits, mirrored or turned. It reads by rule: put each plan's preview beside its reading and correct what it got wrong with correct_plan_reading before building — a shape read as the wrong thing (roles), a balcony it missed (addBalconies: its box in plan pixels and the side of the wall behind it; a loggia drawn inside the outline is one), a step that is no balcony (dropBalconies) — for the floors of a family together. When something already built is wrong (balconies standing as walls, walls from a misread shape), correct the reading and rebuild it with create_reference_elements replace: true, which removes only what those plan shapes built; never put a facade on walls you know are wrong. Read the photo into facade kinds (5). Tell the user the plan in a few lines, then build it.",
})
registerPlansGuideSection({
  name: 'scale',
  order: 2,
  text: '2. Scale. calibrate_plan_reference on what you can see: a printed dimension, or a standard size (standard: entry-door 36 in, bathtub 60 in, stair-tread 11 in); never an assumed room or bay size, and say what you measured. A building map rarely draws doors or tubs: calibrate the unit plan, then match_plan_reference it onto its apartment with the same two corners on each; the map takes its scale and keeps its orientation, north as drawn. refine_plan_match reports the leftover error. Plans without a shared frame match on features they share (the same stair, lift or trash room). align_reference_frames places the plans of one sharedFrame. A calibration the user set in the editor stands unless they ask you to redo it.',
})
registerPlansGuideSection({
  name: 'massing',
  order: 3,
  text: "3. Massing, on every distinct floor, one call each for all of them: the floor plate (create_reference_elements, slab, select outline) and the exterior walls (walls, select outline), with a real storey height: building maps give none, and the default is lower than a real storey, which squashes every straightened photo later. Unless a section or the photo says otherwise, pass height 3 for residential storeys and 4–4.5 for a commercial or lobby ground floor, and say what you assumed. Walls run straight past the outline's balcony steps, and apartment walls stop at the facade there, so a balcony never gets walls on its open sides (balconyEdgesSkipped); the result names the wall behind each one (balconyWalls) for the balcony facade unit (5). Of a family of identical floors, build only the first. Stairs and lifts come after the copies (8).",
})
