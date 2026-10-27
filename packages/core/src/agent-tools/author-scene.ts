import { z } from 'zod'
import { DOOR_STYLES, WINDOW_STYLES } from '../building/opening-style-presets'
import { DoorType, WindowType } from '../schema/nodes/opening-types'
import { RoofType } from '../schema/nodes/roof-types'
import { measurement, roofPitch } from './measurement'
import { NodeId } from './node-id'

const DESCRIPTION = `Turn a whole design you wrote as free three.js into an editable Pascal scene, in one call. You read your own module however you like (its source, running it and reading the objects, both) and hand over a conversion payload: levels, walls (straight, curved or glass) with their openings, rooms, slabs, voids, columns, railings, stairs, every piece of furniture as an authored object with its own module, and lights. Pascal does the rest server-side: compiles and stores each item, places it, derives the rooms and their floors, paints, runs its checks, saves, and answers with a gate report you iterate against. Nothing you hand over is silently dropped: what cannot be placed comes back by name with a reason, and what Pascal corrected (a wall end snapped onto the centerline it meets) is listed.

Coordinates: metres, plan x/z, Y up, each level's floor at y = 0 in its own frame. A wall is its centerline; walls meet where centerlines meet, so end a partition on the centerline of the wall it runs into. An opening's 'along' is measured from the wall's start to the opening's centre; give each opening its type (how it opens) and style (its look), or its own module for a shape they cannot express. An item's position is where its bottom centre stands, except a ceiling item's (mount 'ceiling': a pendant, a ceiling light): it hangs from the ceiling of the room containing its plan position, its top on that ceiling, and its y is not read. A rug, a mat or a runner is an item lying on the room's floor. What stands on a floor stands on its finish: on a room with a floorCode, on the top of its planks or tiles, so its y stays 0. Its module follows the add_object contract (metres, Y up, built in its installed orientation; at most 300k triangles and 32 materials per item; name materials slot_<finish>; drawers, doors and lids as animation clips; a THREE light named light:<id> where a bulb is). A hex colour is written as an exact material, one per distinct colour. Pascal builds a wall's cap, the floor plate and the ceiling itself: fold a module's caps, underlays and floor planks into the wall, the room's floor finish and the room (say so in notes), never into slabs or regions: baseboards are the wall's skirting, a plank or tile floor is the room's floorCode, tiles, panelling or boards on a wall are its faceLeft / faceRight (or the room's wallCode), cladding, brick or battens outside its faceOutside; a slab is a terrace, a platform, a balcony; a stair is its level's stairs, which open the floor above; the roof over the top level is roof, Pascal's own segments when its shape is one of theirs, else your geometry as roof items, both on the building's roof level above the top storey. Pascal draws what bold architecture needs natively: a curved wall is one wall with the point its arc passes through, through (never a run of short straight ones), a glass front a curtain wall, a double-height room a void in the floor of the level above it (its ceiling opens with it, a railing along its edges), an archway a passage with an arch shape. Paint a wall by what its faces look onto, colorInside and colorOutside: which face is inside is Pascal's to find. Build the building as it is built: a wall at its real height, nothing lowered or removed for viewing.

Hand over the payload, or your module and its adapter, the program that reads the module and returns the payload: Pascal runs the adapter (one that throws comes back with its error, and nothing is written). An item names its piece instead of code when add_object makes it from words; one still being made is written when it lands, with no call from you. Pieces made from words are written many at a time while you go on, so furniture made that way does not lengthen your turn the way pieces you write yourself do.

The report says what was written, what Pascal defaulted (defaults: a window with no type is fixed and cannot open), what it warns about but wrote (warnings: thin slabs, too many slabs or regions), what it refused (defects, by your ids), the items waiting for their pieces (pending), and Pascal's checks of what stands (checks, each passed or with what failed: doors and windows a person opens move, glazing is glass, every room's floor covered, every placed piece standing, nothing written as loose debris or buried, wall finishes built, stairs arriving inside a room clear of walls, every level holding rooms or walls: the ground, terraces and foundations belong to the ground level, Pascal draws the site and foundations).

Call again with replace: true to revise the previous conversion: the module and adapter you leave out are the stored ones, edits change parts of them, and with neither a payload nor a module, adapter or edits the stored conversion is written again. Stable element identities and manual changes are retained; overlapping changes are refused. An existing building without a conversion baseline is never cleared.`

const plan = (what: string) =>
  z.array(z.number()).length(2).describe(`[x, z] ${what} in plan metres.`)
const xyz = (what: string) =>
  z.array(z.number()).length(3).describe(`[x, y, z] ${what} in metres, y above the level's floor.`)
const length = (description: string, opts: { positive?: boolean; default?: number } = {}) =>
  measurement('length', 'm', { description, ...opts })

export const authorSceneOpening = z.object({
  kind: z
    .enum(['door', 'window', 'passage'])
    .describe(
      'door, window, or passage: a doorway with no leaf (a cased opening, an archway between rooms), which takes no type, style, leaves, hinge, swing or code.',
    ),
  along: length(
    "From the wall's start to the opening's centre, along the centerline (along the arc on a curved wall).",
  ),
  width: length('Opening width.', { positive: true }),
  height: length('Opening height.', { positive: true }),
  sill: length(
    'Bottom of the opening above the floor; 0 for a door or floor-to-ceiling glazing (default 0).',
    { default: 0 },
  ),
  name: z.string().max(80).optional(),
  shape: z
    .enum(['rectangle', 'rounded', 'arch'])
    .optional()
    .describe(
      'Its outline: rectangle (default), rounded top corners, or arch (a round top), for a door, a window or a passage.',
    ),
  archHeight: length(
    "An arch's rise above its straight sides, within height (default 0.45 m for a door or passage, 0.35 m for a window).",
    { positive: true },
  ).optional(),
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
  "a three.js module that builds this face's finish (tiles with joints, panelling, boards) for exactly the face: it receives, in wall-local metres (x along the wall from its start, y up from the face's base, z out of the face), params.outline ({ x0, y0, x1, y1 }: the face), params.holes (its doors and windows, each { x0, y0, x1, y1 }), params.base (the floor along the face, [[x, y], …]) and params.thickness, and lays the finish out: Pascal cuts the build to the outline and its openings, so tiles and boards may run past the edges and over the doors and windows (the holes are there for a layout that wants them, tiles centred on a window); Pascal rebuilds it when the wall or its openings change"

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
  height: length(
    "Wall height, from its floor to its top: the room's height, as built. Under another level, the climb from the tallest wall within 0.5 m of that level's floor up to it is that floor's structure, which Pascal draws (2.7 m walls under a floor at 2.9 m: a 0.2 m floor); a wall reaching into that floor stops under it.",
    { positive: true },
  ),
  thickness: length('Wall thickness.', { positive: true }),
  through: plan(
    "the point the wall's arc passes through at its middle, bending it from start through it to end (a bay, an apse, a rounded corner, a drum: put it outside the building for one that bulges out): how far it stands from the straight line sets the bend, at most half the start-to-end distance (a half circle). Default: straight. Rooms derive from the arc and openings sit along it; a curved wall takes no faceLeft / faceRight or wallCode, and nothing hangs on it (host).",
  ).optional(),
  curtain: z
    .object({
      spacing: length('The mullions at most this far apart (default 1.5 m).', {
        default: 1.5,
        positive: true,
      }),
      frameColor: z
        .string()
        .optional()
        .describe(
          "The mullions' and frame's colour, #rrggbb or library:<id> (default: Pascal's dark grey).",
        ),
    })
    .optional()
    .describe(
      "A curtain wall: glass from the floor to the wall's top between mullions, straight or curved (a glass front, a winter garden). Doors may sit in it; its faces take no paint, skirting or face finish.",
    ),
  color: z
    .string()
    .optional()
    .describe(
      'Paint for both faces: #rrggbb, written as an exact material, or a library ref (library:<id>) from search_materials.',
    ),
  colorInside: z
    .string()
    .optional()
    .describe(
      'Paint for the face or faces that look into a room of this level, same forms as color: both faces of a partition, the room side of an outside wall. Pascal finds them once the rooms are derived and the report says which face it was; over color.',
    ),
  colorOutside: z
    .string()
    .optional()
    .describe(
      "Paint for a face no room of this level looks into (an outside wall's cladding or render), same forms as color; over color. Say an outside wall's two finishes this way, not by left and right. The floor between this level and the one above wears the colour most of this level's walls give here, so the facade reads as one.",
    ),
  colorLeft: z
    .string()
    .optional()
    .describe(
      "Paint for the face on the left when looking from start to end, same forms as color; over colorInside, colorOutside and color. The left is the wall's front.",
    ),
  colorRight: z
    .string()
    .optional()
    .describe(
      'Paint for the face on the right when looking from start to end, same forms as color; over colorInside, colorOutside and color.',
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
  faceOutside: authorSceneWallFace
    .optional()
    .describe(
      `The finish of the face no room of this level looks into (an outside wall's cladding, brick, render with bands, battens), built by ${WALL_FACE_MODULE}; colorOutside stays the paint under it. Which face is outside is Pascal's to find, as for colorOutside: both faces of a wall no room stands on. The report warns when the build leaves part of the face uncovered.`,
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
      "A three.js module that builds the floor finish for the room's polygon: it receives params.polygon ([[x, z], …]) and params.holes ([[[x, z], …], …]), plan x/z in level coordinates, metres, and lays out the planks, tiles or boards. y = 0 is the floor's surface: lay the finish from there up, and Pascal stands the build on the room's floor plate and what stands on the floor (a rug, a sofa) on the build's top. Pascal cuts the build to the polygon and its holes, so a row may run past the edges (the holes are there for a layout that wants them). Pascal rebuilds it when the room changes; floor stays the fallback finish. The report warns when the build leaves part of the floor uncovered.",
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
  shape: z
    .enum(['square', 'round'])
    .default('square')
    .describe('square (default), or round: width is its diameter and depth is not read.'),
  width: length('Column width.', { positive: true }),
  depth: length('Column depth (default: its width).', { positive: true }).optional(),
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
    .optional()
    .describe("The piece's own three.js module (see the description); or piece."),
  piece: z
    .string()
    .min(1)
    .max(64)
    .optional()
    .describe(
      'Instead of code: the id of a piece add_object makes from words (its piece.id). Placed with its module once made; one still being made is placed when it lands.',
    ),
  position: xyz("bottom centre (a ceiling item's top centre, y not read)"),
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

export const authorSceneStair = z.object({
  name: z.string().max(80).optional(),
  start: plan("the middle of the bottom step's front edge, where the climb starts"),
  rotation: measurement('angle', 'deg', {
    default: 0,
    description:
      'Which way the first flight climbs: 0 toward +z, 90 toward +x, 180 toward −z, 270 toward −x (default 0).',
  }),
  width: length('Width across the climb (default 1.0 m).', { default: 1, positive: true }),
  layout: z
    .enum(['straight', 'l', 'u'])
    .default('straight')
    .describe(
      'straight (default); l: a flight, a landing as deep as the stair is wide, a flight turned 90°; u: a flight, a landing across, a flight back beside the first.',
    ),
  turn: z
    .enum(['left', 'right'])
    .optional()
    .describe("Which way an L or U turns, to the climber's left or right (default left)."),
  length: length(
    "The flights' run along the climb, landings aside (default: 0.28 m of going per riser, risers of at most 0.18 m).",
    { positive: true },
  ).optional(),
  steps: z
    .number()
    .int()
    .min(2)
    .optional()
    .describe('Risers in all (default: from the storey, risers of at most 0.18 m).'),
  lowerSteps: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("An L or U's risers up to its landing; the rest climb after it (default half)."),
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

export const authorSceneVoid = z.object({
  name: z.string().max(80).optional(),
  polygon: z
    .array(plan('vertex'))
    .min(3)
    .describe(
      "The opening in this level's floor, so the room below rises through it (a double-height living room under a gallery, a stairwell, an atrium). Pascal cuts the floor and the ceiling under it, and stops the cut at the faces of this level's walls.",
    ),
  railing: z
    .object({
      height: length('Railing height (default 1.1 m).', { default: 1.1, positive: true }),
      color: z.string().optional().describe('#rrggbb or library:<id> (default white).'),
    })
    .nullable()
    .optional()
    .describe(
      "A railing along the void's open edges, broken where a wall of this level stands or a stair arrives (default: a 1.1 m railing; null for none, a void you cannot walk up to).",
    ),
})

export const authorSceneRoofSegment = z.object({
  center: plan('its centre, between the walls it covers'),
  rotation: measurement('angle', 'deg', {
    default: 0,
    description: 'Turn about the vertical axis, as an item turns: at 0 its width runs along x.',
  }),
  width: length(
    "Along its ridge, between the centerlines of the walls under it (a gable's rakes are its ends).",
    { positive: true },
  ),
  depth: length(
    "Across its ridge, between the centerlines of the walls under it (its eaves' sides).",
    {
      positive: true,
    },
  ),
  roofType: RoofType.default('gable').describe(
    'gable (default), hip, shed (one slope, its low eave toward its local +z), flat, or any of the roof shapes create_roof takes.',
  ),
  pitch: roofPitch('deg', {
    min: 0,
    max: 85,
    description: 'Slope of its planes (default 40°).',
  }).optional(),
  overhang: length("How far its eaves reach past the walls' faces, in plan (default 0.3 m).", {
    default: 0.3,
  }),
  gableOverhang: length(
    "How far a gable's or shed's rakes reach past its end walls, in plan.",
  ).optional(),
})

export const authorSceneRoof = z.object({
  name: z.string().max(80).optional(),
  segments: z
    .array(authorSceneRoofSegment)
    .default([])
    .describe(
      "Pascal's own roof over the top level, one segment per rectangle: it stands on the walls' tops and draws its own gable ends, eaves and fascia (default []).",
    ),
  color: z.string().optional().describe("#rrggbb of the segments' covering."),
  wallColor: z
    .string()
    .optional()
    .describe('#rrggbb of the walls the segments raise: their gable ends.'),
  items: z
    .array(authorSceneItem)
    .optional()
    .describe(
      "Roof geometry the segments cannot draw (a roof of another shape, a chimney, a dormer), as items on the roof level. position's y is measured from the top level's floor, as that level's items are.",
    ),
})

export const authorSceneLevel = z.object({
  name: z.string().min(1).max(80),
  elevation: length(
    "The level's floor height above the ground floor's (default 0), its walking surface. It sets the storey below: a storey is as tall as the climb to the next level's floor (its stairs follow), the top one as its tallest wall; the walls under keep their height and this level's floor fills the climb above them.",
    { default: 0 },
  ),
  walls: z.array(authorSceneWall).optional(),
  rooms: z.array(authorSceneRoom).default([]).describe('Room seeds and finishes (default []).'),
  slabs: z.array(authorSceneSlab).optional(),
  voids: z
    .array(authorSceneVoid)
    .optional()
    .describe('Openings in this level’s floor onto the level below; never on the first level.'),
  columns: z.array(authorSceneColumn).optional(),
  stairs: z
    .array(authorSceneStair)
    .optional()
    .describe(
      "Stairs rising from this level to the next one in levels, as Pascal's stair tool builds them: the risers follow the storey height and each stair opens the floor above over its flights. Never a stair as an item.",
    ),
  items: z.array(authorSceneItem).optional(),
  lights: z.array(authorSceneLight).default([]),
})

export const authorScenePayload = z.object({
  levels: z.array(authorSceneLevel).min(1),
  roof: authorSceneRoof
    .optional()
    .describe(
      "The roof over the top level, on the building's roof level above it, so exploded and solo level views lift it off the plan.",
    ),
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
    payload: authorScenePayload
      .optional()
      .describe(
        'The conversion payload. Leave it out to have Pascal run the adapter on the module, or, with neither, to write the stored conversion again.',
      ),
    module: z
      .string()
      .max(400_000)
      .optional()
      .describe(
        'The three.js module the payload is read from. Stored with the scene as its source; left out, the stored one is used.',
      ),
    adapter: z
      .string()
      .max(400_000)
      .optional()
      .describe(
        "The program that turns the module into the payload: `export default async function adapt({ THREE, addons, source, run, toModule })` returning the payload. Pascal runs it where three.js modules run (no network, files or DOM); source is the module's text, run(code = source) builds a module (its default or named build({ THREE, scene, addons })) and answers { scene }, its world matrices updated; toModule(object, { origin, rotation, mount, animations }) writes an object of the built scene as an item's or an opening's module, answering { code, position, size, triangles }. Stored with the scene; left out, the stored one is used.",
      ),
    edits: z
      .array(
        z
          .object({
            in: z.enum(['module', 'adapter']),
            find: z.string().min(1).describe('Text that occurs exactly once in it.'),
            replace: z.string().describe('What replaces it.'),
          })
          .strict(),
      )
      .max(200)
      .optional()
      .describe(
        'Changes to the module or the adapter as given, or as stored when left out, applied in order; the changed texts are run and stored.',
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
