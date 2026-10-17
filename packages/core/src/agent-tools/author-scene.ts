import { z } from 'zod'
import { measurement } from './measurement'
import { NodeId } from './node-id'

const DESCRIPTION = `Turn a whole design you wrote as free three.js into an editable Pascal scene, in one call. You read your own module however you like (its source, running it and reading the objects, both) and hand over a conversion payload: levels, walls with their openings, rooms, slabs, columns, railings, every piece of furniture as an authored object with its own module, and lights. Pascal does the rest server-side: compiles and stores each item, places it, derives the rooms and their floors, paints, runs its checks, saves, and answers with a gate report you iterate against. Nothing you hand over is silently dropped: what cannot be placed comes back by name with a reason, and what Pascal corrected (a wall end snapped onto the centerline it meets) is listed.

Coordinates: metres, plan x/z, Y up, each level's floor at y = 0 in its own frame. A wall is its centerline; walls meet where centerlines meet, so end a partition on the centerline of the wall it runs into. An opening's 'along' is measured from the wall's start to the opening's centre. An item's position is where its bottom centre stands; its module follows the add_object contract (metres, Y up, built in its installed orientation; at most 300k triangles and 32 materials per item; name materials slot_<finish>; drawers, doors and lids as animation clips; a THREE light named light:<id> where a bulb is). Build the building as it is built: a wall at its real height, nothing lowered or removed for viewing.

Call again with the same scene and a corrected payload to replace the previous conversion (replace: true); the default refuses to overwrite a scene that already holds a conversion.`

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
  color: z
    .string()
    .optional()
    .describe("The leaf's or frame's colour as #rrggbb, when the design has one."),
  hinge: z
    .enum(['start', 'end'])
    .optional()
    .describe("Which end of the wall the door's hinge is nearer."),
  swing: z
    .enum(['front', 'back'])
    .optional()
    .describe("The side the door opens towards: the wall's front or back face."),
})

export const authorSceneWall = z.object({
  id: z.string().min(1).max(64).describe('Your own id, for the report.'),
  start: plan('start'),
  end: plan('end'),
  height: length('Wall height.', { positive: true }),
  thickness: length('Wall thickness.', { positive: true }),
  color: z
    .string()
    .optional()
    .describe('Paint for both faces as #rrggbb; Pascal picks the nearest library colour.'),
  openings: z.array(authorSceneOpening).optional(),
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
      "The floor's material: a library ref (library:<id>) from search_materials, or #rrggbb for a flat colour.",
    ),
  floorRegions: z
    .array(z.object({ polygon: z.array(plan('vertex')).min(3), finish: z.string() }))
    .default([])
    .describe('Parts of the floor in another finish (the kitchen tiles inside an open-plan room).'),
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
  finish: z.string().optional().describe('library:<id> or #rrggbb.'),
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
      'The id of the item this one rests on or hangs from (a lamp on a nightstand), so moving the host moves it.',
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
      'The id of the item holding this light (a pendant, a lamp). Without one, the light is attached to the nearest item.',
    ),
})

export const authorSceneLevel = z.object({
  name: z.string().min(1).max(80),
  elevation: length("The level's floor height above the ground floor's (default 0).", {
    default: 0,
  }),
  walls: z.array(authorSceneWall).optional(),
  rooms: z.array(authorSceneRoom).default([]),
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
      .describe('Replace the conversion this scene already holds (default false).'),
    sceneId: NodeId.optional().describe('The scene to write; the active one when omitted.'),
  },
  annotations: { destructiveHint: true },
}
