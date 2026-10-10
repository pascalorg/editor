import { z } from 'zod'
import { SCENARIO_WIDTHS } from '../building/facade-widths'
import { FacadeModeSchema } from '../systems/facade/facade-config'
import { FacadeSetSchema } from '../systems/facade/facade-set'
import { FacadeUnitSchema } from '../systems/facade/facade-unit'
import { achievedOutput } from './achieved'
import { registerPlansGuideSection } from './guides'
import { NodeId } from './node-id'

const UNIT_DESCRIPTION =
  'A facade unit: the minimal facade of one run, corner to corner (or to any wall meeting it). ' +
  '`bays` in precedence order; each bay has a width, a widthMode (repeat | fixed | stretch), ' +
  'an anchor (`horizontal`), piers, and optionally an opening (window or door, with sill, ' +
  'panes and type: fixed draws the pane grid, casement (the default) one sash without it; rowRatios / columnRatios make the panes unequal, rows top to bottom, e.g. [0.6, 0.4] for a taller upper row), a balcony, infill panels beside the opening, a spandrel below/above it and a ' +
  'surround (jambs and a head) round it. `piers` clads what the bays leave, proud of the spandrels; ' +
  '`obstacles` shift moves an opening off a partition within its bay; room (for floors with rooms) moves it into the room holding most of its bay, narrowed to fit, and gives every habitable room a window. `grid` building keeps one column grid per face, laid on its typical storey, so the windows stack floor to floor. ' +
  '`paint` holds library material refs (`library:<id>`) for the wall face and frames; infill, ' +
  'spandrel and balcony take their own: brick library:brick-buff, library:brick-brown, ' +
  'library:flooring-agedbrick, library:flooring-rusticbrick, library:flooring-weatheredbrick; ' +
  'stone library:stone-limestone-ashlar; render library:concrete-stucco; siding ' +
  'library:siding-lap-charcoal (horizontal), library:siding-board-batten-charcoal (vertical); ' +
  'wood library:wood-cedar-soffit; colours library:preset-tan, library:preset-nearblack, ' +
  'library:preset-white; library:metal-steel, library:preset-glass. A balcony takes an ornament ' +
  '(ironwork: bands of motifs bars | circles | lozenges | crosses | arches | scrolls | waves). ' +
  'Pinned (fixed) bays are placed first; repeating and stretching bays fill what is left. ' +
  "A bay's width leaves out its piers: n repeats take n × width + (n − 1) × pier + 2 × endPier " +
  '(pier 1 m and endPier 0.2 m by default), so three 3.5 m bays need 12.9 m, not 10.9 m. ' +
  'Openings take recess, sillDepth, frameDepth and shape (rectangle | rounded | arch); paint.glass ' +
  'sets the glazing (library:preset-glass-dark); seed and imperfection (0 to 1) vary bays by column; ' +
  'the variants of a bay [{ weight, opening?, balcony? (null removes it), infill?, spandrel? }] are ' +
  'drawn per column and stack up the storeys. rhythm room restarts at every wall meeting the ' +
  'facade; side runs corner to corner with those walls as obstacles.'

export const previewFacadeUnitTool = {
  name: 'preview_facade_unit',
  title: 'Preview facade unit',
  description:
    "Resolve a facade unit on test runs without touching any scene, the way the editor's facade studio does: at several run widths (like breakpoints) and with interior walls meeting the facade. Returns, per width, the runs, openings, panels and balconies in metres from the left corner, placements skipped for lack of room, and a one-line sketch, plus an elevation drawing of them all in the unit's materials. Use it to check a unit before apply_facade: compare the drawing with the photo, at the lengths of the walls it will cover. Returns the unit's previewId, which the apply tools require: a unit changed afterwards needs a new preview.",
  input: {
    unit: FacadeUnitSchema.describe(UNIT_DESCRIPTION),
    widths: z
      .array(z.number().min(0.5).max(60))
      .max(12)
      .optional()
      .describe(`Run widths to test, in metres. Default ${SCENARIO_WIDTHS.join(', ')}.`),
    height: z.number().min(2).max(8).default(3).describe('Storey height, in metres.'),
    partitions: z
      .array(z.number())
      .max(12)
      .default([])
      .describe(
        'Interior walls meeting the facade, in metres from its left corner. Each ends a run and the unit starts again beside it; positions outside a width are ignored for it.',
      ),
  },
}

export const applyFacadeTool = {
  name: 'apply_facade',
  title: 'Apply facade',
  description:
    'Fill walls with a facade unit: native windows, doors, cladding panels and balconies, owned by the facade so a later apply_facade re-solves them in place. The unit restarts at every corner, and with rhythm room at every wall meeting the facade. mode dress keeps the openings already on the walls (from the plans or placed by hand), where they are and as big as they are, and dresses them with the bays of the unit. Ask by floor (levelIds) — no wall id needed — by wall, or for a list of walls (wallIds) in one call. Returns a drawing of what it built on the longest walls: compare it with the photo. Use this rather than placing openings one by one; re-apply with a changed unit to change a facade. Preview the unit first and pass its previewId: a unit not previewed as applied is refused (unit_not_previewed).',
  input: {
    wallId: NodeId.optional().describe(
      'A wall on the facade to fill; or pass wallIds or levelIds.',
    ),
    wallIds: z
      .array(NodeId)
      .min(1)
      .max(200)
      .optional()
      .describe(
        'Walls to fill with this unit in one call, each on its own with scope (wall for the short walls of recesses and returns): one save instead of one per wall.',
      ),
    levelIds: z
      .array(NodeId)
      .min(1)
      .max(32)
      .optional()
      .describe(
        "Floors to fill, without a wall id: one call for a band of floors. With scope exterior each floor's outer loop; with scope balconies the walls behind its plan's balcony steps, found where they are now.",
      ),
    scope: z
      .enum(['wall', 'exterior', 'interior', 'both', 'balconies'])
      .default('exterior')
      .describe(
        "`wall`: this wall only. `exterior` / `interior`: the whole outside or inside loop of walls, on its level. `both`: both faces of the loop. `balconies` (with levelIds): the walls behind the floor's balcony steps, after the loop's main unit.",
      ),
    unit: FacadeUnitSchema.describe(UNIT_DESCRIPTION),
    previewId: z
      .string()
      .describe('The previewId preview_facade_unit returned for this exact unit.'),
    replaceExisting: z
      .boolean()
      .default(false)
      .describe(
        'Remove existing windows and doors the facade openings would overlap (e.g. an old facade, imported openings) instead of skipping those placements.',
      ),
    replaceBalconies: z
      .boolean()
      .default(false)
      .describe(
        'Let a unit without balconies delete the balcony stack on these walls (refused otherwise: balcony_stack_replaced); then apply the stack again with scope balconies.',
      ),
    mode: FacadeModeSchema.optional().describe(
      'place (default): the unit places its openings. dress: keep the openings already there and dress them.',
    ),
    joinTolerance: z
      .number()
      .min(0)
      .max(0.2)
      .optional()
      .describe(
        "Metres within which wall ends make one corner of the floor's outside loop: a millimetre by default, so a real gap stays open. A vectorised plan's corners often miss by a few centimetres: 0.05 joins them.",
      ),
  },
}

export const applyFacadeSetTool = {
  name: 'apply_facade_set',
  title: 'Apply a facade set to a building',
  description:
    "Apply a whole facade to a building in one call: a set of units by storey role — first (ground), middle (the typical floors), top — plus free units on picked walls (a balcony stack), with corner chains and bands; the building's facade node keeps it, so applying again updates it. Returns the coverage per unit (length, share, openings), the walls left uncovered and issues by code. Preview each unit with preview_facade_unit first and pass every previewId: a unit not previewed as applied is refused (unit_not_previewed). mode dress keeps the openings already on the walls and dresses them.",
  input: {
    buildingId: NodeId.optional().describe(
      'Default: the building of the floor being viewed, or the only one.',
    ),
    set: FacadeSetSchema.describe(
      '{ name, units: [{ key, role: first | middle | top | free, unit }], corners?: [{ kind: harpee | droite | bossage | brick | pilaster, material, course, long, short, relief, joint, edges, from, to }], bands?: [{ kind: base | course | cornice, at, material, height, depth }] }. One unit per storey role; a missing role is covered by middle.',
    ),
    mode: FacadeModeSchema.optional().describe('place (default) or dress.'),
    previewIds: z
      .array(z.string())
      .min(1)
      .max(16)
      .describe('The previewId of every unit of the set, from preview_facade_unit.'),
    freeAreas: z
      .array(
        z.object({
          unitKey: z.string().describe('A free unit of the set.'),
          wallIds: z
            .array(NodeId)
            .min(1)
            .max(64)
            .describe('Walls on one storey; the area runs from it to the top.'),
        }),
      )
      .max(16)
      .optional(),
    replaceExisting: z
      .boolean()
      .default(false)
      .describe('Remove openings in the way of the units instead of skipping them.'),
  },
}

export const describeFacadeTool = {
  name: 'describe_facade',
  title: 'Describe a building facade',
  description:
    'Read the facade set a building carries, as data: its units (role, bays with their openings, balconies, infill, variants, paint), corners, bands and the areas each unit covers (storeys, outside loop or plan segments). Null when no set was applied. Use it to adjust a set and apply it again.',
  input: {
    buildingId: NodeId.optional().describe(
      'Default: the building of the floor being viewed, or the only one.',
    ),
  },
}

const Extent = z.object({
  left: z.number(),
  right: z.number(),
  bottom: z.number(),
  top: z.number(),
})

/**
 * What apply_facade answers, on every surface (core `facadeAppliedResult`); each host adds its
 * drawing of the result.
 */
export const applyFacadeOutput = {
  status: z.literal('applied'),
  levels: z.number(),
  walls: z.number(),
  runs: z.number(),
  replaced: z.number(),
  skipped: z.number(),
  leftOut: z
    .array(z.object({ wallId: z.string(), covered: z.number(), length: z.number() }))
    .optional()
    .describe(
      'Loop walls that run past a corner of the loop, left out: split each at the junction and apply again.',
    ),
  curved: z
    .array(z.string())
    .optional()
    .describe('Arcs of the loop, left out: a facade goes on straight walls only.'),
  unlitRooms: z
    .array(z.string())
    .optional()
    .describe("With obstacles 'room': the habitable rooms no window fits, by zone name."),
  achieved: achievedOutput,
}

export const facadePreviewOutput = {
  previewId: z.string(),
  scenarios: z.array(
    z.object({
      width: z.number(),
      runs: z.array(z.object({ start: z.number(), end: z.number() })),
      openings: z.array(Extent.extend({ kind: z.enum(['window', 'door']) })),
      panels: z.array(Extent.extend({ part: z.string() })),
      balconies: z.array(z.object({ left: z.number(), right: z.number() })),
      skipped: z.number(),
      error: z.string().nullable(),
      sketch: z.string(),
    }),
  ),
  elevationSvg: z
    .string()
    .describe('Every scenario drawn at one scale in its materials, to compare with the photo.'),
}

/** The plans guide's step 5, brought with these tools. */
registerPlansGuideSection({
  name: 'facade',
  order: 5,
  text: "5. Facade from the photo. Find where it was taken first: describe the photo from the photo alone (per face, from the corner outward, the flush, recessed and projecting stretches with their bays and balconies) and call locate_photo without a floor (it tries them all); it names the corner and the walls of each face, left and right as the photo shows them. When it is not confident (two corners tie, or the best still disagrees), ask the person which corner the photo shows before straightening anything. Where straighten_facade_photo is available, straighten every face you can see in one call (a corner photo shows two, and they share its camera), each on the walls of its flush stretch: its edges, the same feature (window heads) on a low and a high storey with their levels, two points far apart along each, and its walls. A face whose far edge leaves the photo is still straightened from the corner: give only that edge, picked the same as on the other face. Add two more horizontal lines per face (sills, heads) and a pier side or two as verticals: on short lines a pick a pixel off moves a measure by several per cent. Check the close-ups and call again if a point is off; when the photo's storey height disagrees with the scene's, set the storeys to the photo's before building units. Then take every number of the units from those elevations, not from the perspective photo. First read it: the storey bands (a ground floor, the typical floors, a top floor that often differs — siding instead of brick, taller windows, no piers — is its own kind, never the typical unit reused) and the runs that differ (the balcony stack, the corners). Then measure each kind before writing it: count the window bays on one face in the photo and divide that wall's length (get_walls) by the count for the bay width; take the pier, window and sill as shares of the 3 m storey, as the photo shows them; count each window's panes (columns and rows) and make it windowType fixed, which draws them (casement, the default, draws one sash without its panes); the siding beside a window is infill { material, width: as the photo shows it, often half the window's, sides: left or right as the photo shows, height: opening } (left at its defaults it is a thin dark strip on both sides, the whole storey high). Map what you see to the unit: brick piers are pier and paint.wall, standing proud with piers { material, thickness: 0.06 } over thinner spandrels (thickness 0.02), the wide corner piers endPier, siding beside a window infill, the band under it a spandrel, a trim round a window a surround { material, width, head: plain or cornice }, a balcony a bay with a door and a balcony. Each unit carries the photo's materials, or it is unfinished: paint.wall for the face (brick library:brick-buff, library:brick-brown, library:flooring-agedbrick, library:flooring-rusticbrick or library:flooring-weatheredbrick; stone library:stone-limestone-ashlar; render library:concrete-stucco; a colour such as library:preset-tan), paint.frame (black frames library:preset-nearblack), infill and spandrel each with its material (horizontal lap siding library:siding-lap-charcoal, vertical boards library:siding-board-batten-charcoal, a darker brick library:brick-brown, metal library:metal-steel, wood library:wood-cedar-soffit), and a balcony's railingMaterial, deckMaterial and ironwork (ornament: vertical pickets are { bands: [{ motif: 'bars', pitch: 0.1 }], bar: 0.016, panel: 0 }). Flat colours have no texture: keep library:preset-nearblack for frames and railings, never a whole wall, where it reads as a hole; dark cladding is library:siding-board-batten-charcoal or library:siding-lap-charcoal, as the boards run in the photo. The balcony stack is a unit whose bay holds a door and a balcony of the plan's width and depth, for the walls balconyWalls names; its bay plus both end piers must fit the shortest of those walls, or it builds nothing there. It runs from the floor of its walls to the top: anchor it on the lowest floor whose plan draws the balconies, never on a floor without them. The walls between the balconies of a row (balconyStretches) take a second free unit in the stack's cladding, so the whole stretch reads as one. Never apply a unit you have not previewed — the apply tools require the previewId each preview returns and refuse a unit changed since (unit_not_previewed): preview_facade_unit draws each unit at the lengths of the walls it will cover, at the storey height of the floors it goes on: put the drawing beside the photo, say what differs (rhythm, window size, piers, materials), fix it once, then apply. A facade unit does not draw a band running across the whole facade or a set-back floor: build it with add_object at its size, or paint the face (a timber band), and record it approximated where it only stands in. Tell the user the kinds, then apply each band of floors in one direct call — apply_facade with levelIds, not inside a program, so the drawing of what it built comes back: first the band's main unit with scope exterior, then the balcony stack with scope balconies on the same floors (no wall ids: they are found where they are now); another run that differs takes scope wall. Look at each drawing beside the photo before the next band. Where view_scene is available, look at the band in 3D too, from the photo's side at street height (eyeHeight 1.7), beside the photo: say what differs (rhythm, window size, piers, materials, the balconies) and fix it once. Re-applying a loop replaces what its runs had: over a balcony stack it is refused (balcony_stack_replaced) unless you pass replaceBalconies: true, and then you apply the stack again after. A facade needs the exterior walls (3). Never place facade openings one by one. On floors built from plans, every partition meeting the facade ends a run, so runs are about a room long (often 3–5 m): size each unit so one bay plus both end piers fits the shorter runs, or it places nothing there; set obstacles: 'room': an opening landing on a partition moves into the room holding most of its bay and narrows to fit it, every bedroom and living room on the facade gets a window, and the result names the rooms it could not light (unlitRooms) — say so rather than leave them dark. Set grid: 'building' too, so every floor of a face keeps the columns of its typical floor and the windows stack as in the photo; a partition in the way moves that column on that floor only. Once each unit previews right and the floors are copied (8), apply them together with apply_facade_set, passing the previewId of every unit: the ground unit as first, the typical floors as middle, the top floor as top, the balcony stack as a free unit on its walls (freeAreas), with the corner chains and bands the photo shows; describe_facade reads it back to adjust. Where the openings already come from the plans, mode dress keeps them and dresses them.",
})
