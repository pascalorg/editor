import { z } from 'zod'
import { DOOR_STYLES, WINDOW_STYLES } from '../building/opening-style-presets'
import { DoorType, WindowType } from '../schema/nodes/opening-types'
import { measurement } from './measurement'
import { NodeId } from './node-id'

const DESCRIPTION = `Turn a whole design you wrote as free three.js into an editable Pascal scene, in one call. You read your own module however you like (its source, running it and reading the objects, both) and hand over a conversion payload: levels, walls with their openings, rooms, slabs, columns, railings, every piece of furniture as an authored object with its own module, and lights. Pascal does the rest server-side: compiles and stores each item, places it, derives the rooms and their floors, paints, runs its checks, saves, and answers with a gate report you iterate against. Nothing you hand over is silently dropped: what cannot be placed comes back by name with a reason, and what Pascal corrected (a wall end snapped onto the centerline it meets) is listed.

Coordinates: metres, plan x/z, Y up, each level's floor at y = 0 in its own frame. A wall is its centerline; walls meet where centerlines meet, so end a partition on the centerline of the wall it runs into. An opening's 'along' is measured from the wall's start to the opening's centre; give each opening its type (how it opens) and style (its look), or its own module for a shape they cannot express. An item's position is where its bottom centre stands; its module follows the add_object contract (metres, Y up, built in its installed orientation; at most 300k triangles and 32 materials per item; name materials slot_<finish>; drawers, doors and lids as animation clips; a THREE light named light:<id> where a bulb is). A hex colour is written as an exact material, one per distinct colour. Pascal builds a wall's cap, the floor plate and the ceiling itself: fold a module's caps, underlays and floor planks into the wall, the room's floor finish and the room (say so in notes), never into slabs or regions: baseboards are the wall's skirting, a plank or tile floor is the room's floorCode, tiles, panelling or boards on a wall are its faceLeft / faceRight (or the room's wallCode); a slab is a terrace, a platform, a balcony. Build the building as it is built: a wall at its real height, nothing lowered or removed for viewing.

The report says what was written, what Pascal defaulted (defaults: a window with no type is fixed and cannot open), what it warns about but wrote (warnings: thin slabs, too many slabs or regions) and what it refused (defects, by your ids).

Call again with the same scene and a corrected payload to update the previous conversion (replace: true). Stable element identities and manual changes are retained; overlapping changes are refused. An existing building without a conversion baseline is never cleared.`

const plan = (what: string) =>
  z.array(z.number()).length(2).describe(`[x, z] ${what} in plan metres.`)
const xyz = (what: string) =>
  z.array(z.number()).length(3).describe(`[x, y, z] ${what} in metres, y above the level's floor.`)
const length = (description: string, opts: { positive?: boolean; default?: number } = {}) =>
  measurement('length', 'm', { description, ...opts })

export const authorSceneOpening = z.object({
  kind: z.enum(['door', 'window']),
  along: length("From the wall's start to the opening's centre, along the centerline."),
  width: length('Opening width.', { positive: true }),
  height: length('Opening height.', { positive: true }),
  sill: length(
    'Bottom of the opening above the floor; 0 for a door or floor-to-ceiling glazing (default 0).',
    { default: 0 },
  ),
  name: z.string().max(80).optional(),
  type: z
    .enum([...DoorType.options, ...WindowType.options.filter((t) => t !== 'sliding')])
    .optional()
    .describe(
      'How it opens. A door: hinged (default), double (two leaves), french (two glazed leaves), folding, pocket, barn, sliding, garage-sectional, garage-rollup, garage-tiltup. A window: fixed (default; cannot open), sliding, casement, awning, hopper, single-hung, double-hung, bay, bow, louvered. Give it: a window with no type is written fixed.',
    ),
  style: z
    .enum([...DOOR_STYLES, ...WINDOW_STYLES])
    .optional()
    .describe(
      "Its look, by name. A door's leaf: panel (default), glass, modern, paneled-glass, french, shaker, six-panel, craftsman, half-louvered, barn. A fixed window's panes: single (default), double-hung, triple-hung, casement, sliding, grid, tall-grid, wide-grid, horizontal-bands, transom, picture; an operable window draws its own sashes, so a style on one is dropped and reported.",
    ),
  leaves: z
    .number()
    .int()
    .min(1)
    .max(4)
    .optional()
    .describe(
      "A door's leaves, 1 to 4 (default: what its type has; 2 for double, french and sliding).",
    ),
  code: z
    .string()
    .min(1)
    .max(48_000)
    .optional()
    .describe(
      "A three.js module for an opening type and style cannot express (an arched double door, a round window): the add_door / add_window code contract, mount 'wall', a cutout mesh the wall cuts, an open clip unless it is fixed. Width and height are what it builds; type keeps its meaning (default hinged for a door, fixed for a window), style is ignored. Compiled and stored as an item's module is.",
    ),
  color: z
    .string()
    .optional()
    .describe(
      'Exact #rrggbb for a door’s panel and frame or a window’s frame (default: the opening’s own finish).',
    ),
  frameColor: z
    .string()
    .optional()
    .describe(
      'Exact #rrggbb for the frame (default: color, or the opening’s own finish when color is absent).',
    ),
  hinge: z
    .enum(['start', 'end'])
    .optional()
    .describe(
      "Which end of the wall the door's hinge is nearer (default start). The handle goes on the opposite edge.",
    ),
  swing: z
    .enum(['front', 'back'])
    .optional()
    .describe("The side the door opens towards: the wall's front or back face."),
})

const WALL_FACE_MODULE =
  "a three.js module that builds this face's finish (tiles with joints, panelling, boards) for exactly the face: it receives params.outline, params.holes (its doors and windows), params.base and params.thickness in wall-local metres (x along the wall from its start, y up from the face's base, z out of the face) and lays the finish out: Pascal cuts the build to the outline and its openings, so tiles and boards may run past the edges and over the doors and windows (the holes are there for a layout that wants them, tiles centred on a window); Pascal rebuilds it when the wall or its openings change"

const faceToHeight = (whose: string) =>
  length(`Where ${whose} stops, metres up from the face's base (default: the full face).`, {
    positive: true,
  }).optional()

const authorSceneWallFace = z.object({
  code: z.string().min(1).max(48_000).describe(`The face's finish: ${WALL_FACE_MODULE}.`),
  toHeight: faceToHeight('the finish'),
})

export const authorSceneWall = z.object({
  id: z
    .string()
    .min(1)
    .max(64)
    .describe('Your own id, unique across every wall and item on all levels.'),
  start: plan('start'),
  end: plan('end'),
  height: length('Wall height.', { positive: true }),
  thickness: length('Wall thickness.', { positive: true }),
  color: z
    .string()
    .optional()
    .describe(
      'Paint for both faces: #rrggbb, written as an exact material, or a library ref (library:<id>) from search_materials.',
    ),
  colorLeft: z
    .string()
    .optional()
    .describe(
      "Paint for the face on the left when looking from start to end, same forms as color; over color. The left is the wall's front.",
    ),
  colorRight: z
    .string()
    .optional()
    .describe(
      'Paint for the face on the right when looking from start to end, same forms as color; over color.',
    ),
  openings: z.array(authorSceneOpening).optional(),
  skirting: z
    .object({
      height: length('Skirting height up the face (default 0.1 m).', {
        default: 0.1,
        positive: true,
      }),
      depth: length('How far it stands proud of the face (default 0.012 m).', {
        default: 0.012,
        positive: true,
      }),
      color: z
        .string()
        .optional()
        .describe(
          "#rrggbb, written as an exact material, or library:<id> (default: the skirting's own finish as Pascal draws it).",
        ),
    })
    .optional()
    .describe(
      "The wall's skirting (baseboard), native on the wall: it runs along the faces a room stands on, steps with the floor and breaks at doors. Give it here, never as an item.",
    ),
  faceLeft: authorSceneWallFace
    .optional()
    .describe(
      `The face on the left looking from start to end (the front, colorLeft's face), built by ${WALL_FACE_MODULE}; colorLeft stays the paint under it. Over the room's wallCode. The report warns when the build leaves part of the face uncovered.`,
    ),
  faceRight: authorSceneWallFace
    .optional()
    .describe(
      `The face on the right looking from start to end (colorRight's face), built by ${WALL_FACE_MODULE}; colorRight stays the paint under it. Over the room's wallCode. The report warns when the build leaves part of the face uncovered.`,
    ),
})

export const authorSceneRoom = z.object({
  name: z
    .string()
    .min(1)
    .max(80)
    .describe(
      "The room's name as a person would say it (Bedroom 2, Salle de bains, Living + kitchen).",
    ),
  seed: plan('a point inside the room'),
  floor: z
    .string()
    .optional()
    .describe(
      "The floor's material: a library ref (library:<id>) from search_materials, or #rrggbb for an exact flat colour.",
    ),
  floorRegions: z
    .array(z.object({ polygon: z.array(plan('vertex')).min(3), finish: z.string() }))
    .default([])
    .describe(
      'Parts of the floor in another finish (the kitchen tiles inside an open-plan room), library:<id> or #rrggbb. Regions are fixed polygons that do not follow a resize: one region per finish, never one per plank.',
    ),
  floorCode: z
    .string()
    .min(1)
    .max(48_000)
    .optional()
    .describe(
      "A three.js module that builds the floor finish for the room's polygon: it receives params.polygon, params.holes and params.elevation (level coordinates, metres) and lays out the planks, tiles or boards: Pascal cuts the build to the polygon and its holes, so a row may run past the edges (the holes are there for a layout that wants them). Pascal rebuilds it when the room changes; floor stays the fallback finish. The report warns when the build leaves part of the floor uncovered.",
    ),
  wallCode: z
    .string()
    .min(1)
    .max(48_000)
    .optional()
    .describe(
      `The finish of every wall face that looks into this room (the faces its floor meets, where the skirting runs), each built by ${WALL_FACE_MODULE}. A wall's own faceLeft / faceRight wins over it. The report warns when the build leaves part of a face uncovered.`,
    ),
  wallToHeight: faceToHeight("the room's wallCode"),
})

export const authorSceneSlab = z.object({
  name: z.string().max(80).optional(),
  polygon: z.array(plan('vertex')).min(3),
  thickness: length('Slab thickness (default 0.15 m).', { default: 0.15, positive: true }),
  top: length(
    "The slab's top above the level's floor; a balcony at 0, a plinth below 0 (default 0).",
    {
      default: 0,
    },
  ),
  finish: z.string().optional().describe('library:<id> or #rrggbb (an exact colour).'),
  railing: z
    .array(
      z.object({
        start: plan('start'),
        end: plan('end'),
        height: length('Railing height (default 1.1 m).', { default: 1.1, positive: true }),
      }),
    )
    .optional()
    .describe('Railing runs on this slab (a balcony).'),
})

export const authorSceneColumn = z.object({
  name: z.string().max(80).optional(),
  position: plan('centre'),
  width: length('Column width.', { positive: true }),
  depth: length('Column depth.', { positive: true }),
  height: length('Column height.', { positive: true }),
  color: z.string().optional(),
})

export const authorSceneItem = z.object({
  id: z.string().min(1).max(64).describe('Your own id, for the report and for hosting.'),
  name: z.string().min(1).max(80),
  category: z
    .string()
    .min(1)
    .max(40)
    .describe('One word a catalog would use: bed, chair, sofa, plant, lamp, sink.'),
  code: z
    .string()
    .min(1)
    .max(48_000)
    .describe("The piece's own three.js module (see the description)."),
  position: xyz('bottom centre'),
  rotation: measurement('angle', 'deg', {
    default: 0,
    description: 'Turn about the vertical axis (default 0).',
  }),
  host: z
    .string()
    .optional()
    .describe(
      'The id of the item this one rests on or hangs from (a lamp on a nightstand), or of the wall it is fixed to (a baseboard, a casing, a mirror, art), so moving the host moves it. On a wall, position is still the world bottom centre: the item faces the room on the nearest face, keeping its outward distance from that face; a point inside the wall moves to the face and is reported. Rotation is ignored.',
    ),
})

export const authorSceneLight = z.object({
  position: xyz('the bulb'),
  color: z.string().default('#ffffff').describe('#rrggbb (default white).'),
  intensity: z
    .number()
    .positive()
    .default(1)
    .describe('Relative brightness, 1 for an ordinary bulb (default 1).'),
  fixture: z
    .string()
    .optional()
    .describe(
      'The id of the item holding this light (a pendant, a lamp). Default: without a fixture, a minimal ceiling point is created on the ceiling of the room containing the light’s plan position; outside any room, it attaches to the nearest item on this level and reports the fallback.',
    ),
})

export const authorSceneLevel = z.object({
  name: z.string().min(1).max(80),
  elevation: length("The level's floor height above the ground floor's (default 0).", {
    default: 0,
  }),
  walls: z.array(authorSceneWall).optional(),
  rooms: z.array(authorSceneRoom).default([]).describe('Room seeds and finishes (default []).'),
  slabs: z.array(authorSceneSlab).optional(),
  columns: z.array(authorSceneColumn).optional(),
  items: z.array(authorSceneItem).optional(),
  lights: z.array(authorSceneLight).default([]),
})

export const authorScenePayload = z.object({
  levels: z.array(authorSceneLevel).min(1),
  notes: z
    .array(z.string().max(1200))
    .default([])
    .describe(
      'What you could not convert, or converted with a change, one sentence each. Kept with the scene.',
    ),
})
export type AuthorScenePayload = z.infer<typeof authorScenePayload>

export const authorSceneTool = {
  name: 'author_scene',
  title: 'Author scene',
  description: DESCRIPTION,
  input: {
    payload: authorScenePayload,
    module: z
      .string()
      .max(400_000)
      .optional()
      .describe(
        'The three.js module the payload was read from. Stored with the scene as its source.',
      ),
    adapter: z
      .string()
      .max(400_000)
      .optional()
      .describe(
        'The program that produced the payload from the module. Stored with the scene, so a regenerated design starts from it.',
      ),
    replace: z
      .boolean()
      .default(false)
      .describe(
        'Apply a new design delta to the previous conversion, preserving manual edits (default false).',
      ),
    buildingId: z
      .string()
      .optional()
      .describe(
        'The building to convert into. Required when there are several and no active level selects one.',
      ),
    sceneId: NodeId.optional().describe('The scene to write; the active one when omitted.'),
  },
  annotations: { destructiveHint: true },
}
