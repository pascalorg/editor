import { z } from 'zod'
import { measurement } from './measurement'

const point = z.array(z.number()).length(3)

/** Sides on the plan's compass: north is its top edge (z grows south, x east). */
export const COMPASS_SIDES = [
  'north',
  'north-east',
  'east',
  'south-east',
  'south',
  'south-west',
  'west',
  'north-west',
] as const

/**
 * Sides as a front photo names them, standing in the street facing the house: left and right are
 * that viewer's hands. They turn with the house's street: the one its site records, else its own
 * front.
 */
export const STREET_SIDES = [
  'street',
  'street-left',
  'street-right',
  'left',
  'right',
  'back',
  'back-left',
  'back-right',
] as const

export const VIEW_SIDES = [...COMPASS_SIDES, ...STREET_SIDES, 'above'] as const

/** The light a view is rendered in: the scene's own, or one a reference photo was taken in. */
export const VIEW_LIGHTING = ['current', 'day', 'overcast', 'sunset', 'dusk', 'night'] as const

/** The longest side of a view, in pixels: past it a vision model scales the picture down. */
export const VIEW_MAX_PX = 1920

export const viewSceneTool = {
  name: 'view_scene',
  title: 'Look at the scene',
  description:
    "Look at the building in 3D from a viewpoint you pick and get the picture back: the finished house, every storey and the roof by default, or an explicit Solo/Exploded level presentation, whatever view mode the person has on. Use it to compare what you built with a reference and say what differs before you fix it: the facade from the photo's own camera (camera: its position, aim, field of view and aspect), rendered at the photo's aspect to lay beside it; or from the photo's side at street height (from 'street', 'street-left', …, eyeHeight 1.7), in its light (lighting); one face square on (projection orthographic); the massing from above, or an aerial view (elevation 40). The view frames the target (a building, a level, a wall or a zone; the whole building, its roof included, by default) from outside, unless you place the eye yourself with position or camera. To stand inside a room and see its furniture and finishes at a person's height, give interior {zoneId} (a room: an id from get_zones or create_room): the eye stands in the room a step in from a corner, looking across it, with the cut below; from picks the side of the room it stands on, target something in the room to look at it. To see inside a floor, give interior {levelId}: the other floors and that floor's roofs and ceilings are left out of the picture, and everything on it, walls, openings and furniture alike, is cut at 0.65 of the storey's height (about two thirds), so a tall wardrobe or a door head is cut, not short; a roof level has no inside; with no eye given it looks down into the floor, or into the room or zone you target. The live view is not changed. A door, a window or an item on a floor frames at detail scale, an opening seen from its outside face: a close-up to lay beside the photo's crop of the same element, to see what differs. Over the MCP the user's editor tab open on the project renders the picture: with none open it is refused (editor_tab_required), a tab in the background must be brought to the front (editor_tab_hidden), and a tab that is open but busy or still loading answers editor_tab_busy: call view_scene again in a few seconds, the user need not be asked. A picture is not a measure: take sizes and counts from the tools.",
  input: {
    target: z
      .string()
      .optional()
      .describe(
        'A building, level, wall, zone, door, window or floor item id to frame. Default: every storey in the scene, walls and roofs.',
      ),
    interior: z
      .object({
        levelId: z.string().min(1).optional(),
        zoneId: z.string().min(1).optional(),
      })
      .optional()
      .describe(
        "Look inside, with one of: levelId (a floor): the other floors and its roofs and ceilings are left out of the picture, everything on it (walls, openings, furniture) cut at 0.65 of the storey height. Default framing looks down into it; camera or position still wins. zoneId (a room: an id from get_zones or create_room): the same cut, and the eye stands inside the room at a person's height (1.6 m, or eyeHeight), a step in from its corner farthest from what it looks at (from picks the corner on that side), looking across the room with a 75 degree field of view (fov changes it); with a target on the floor it looks at the target. position, elevation, from above or projection orthographic put the eye outside again, over the cut room.",
      ),
    presentation: z
      .discriminatedUnion('mode', [
        z.object({ mode: z.literal('stacked') }),
        z.object({ mode: z.literal('exploded') }),
        z.object({ mode: z.literal('solo'), levelId: z.string().min(1) }),
      ])
      .optional()
      .describe(
        'Verify the actual level presentation: stacked (default), exploded, or solo with a levelId. Solo keeps full-height geometry, including ceilings and any roofs incorrectly owned by that floor; it is not the clipped interior view. Does not change the live view. Do not combine with interior.',
      ),
    from: z
      .enum(VIEW_SIDES)
      .optional()
      .describe(
        "The side the eye stands on: a compass side (north is the plan's top edge, z grows south, x east), above, or a side as a front photo names it, standing in the street facing the house ('street-left' is its left front corner, 'back' the far side), from the street the site records, else the house's own front (its -z, the way a generated house faces). Default south-west.",
      ),
    elevation: measurement('angle', 'deg', {
      min: -10,
      max: 89,
      description:
        'Degrees above the horizon the eye looks down from: 35 to 60 for an aerial view. Default 12.',
    }).optional(),
    eyeHeight: measurement('length', 'm', {
      min: 0,
      description: 'Metres above the ground for a street view (1.7), instead of elevation.',
    }).optional(),
    // Arrays of three, not tuples: a tuple's list-form schema is refused by some clients.
    position: point
      .optional()
      .describe('The eye exactly, [x, height, z] in metres; it looks at the target.'),
    fov: measurement('angle', 'deg', {
      min: 10,
      max: 100,
      description: 'Vertical field of view in degrees for a perspective view. Default 45.',
    }).optional(),
    projection: z
      .enum(['perspective', 'orthographic'])
      .optional()
      .describe('orthographic for a square-on elevation of a face, no perspective.'),
    camera: z
      .union([
        z.literal('current'),
        z.looseObject({
          position: point,
          target: point,
          fov: measurement('angle', 'deg', { min: 5, max: 120 }),
          aspect: z.number().min(0.2).max(5),
        }),
      ])
      .optional()
      .describe(
        "A photo's camera (position, target, fov, aspect): the render takes its eye, aim and field of view at the photo's aspect. Or 'current': the person's own view, as their editor shows it now (the MCP has none: no_current_camera). Not with from, position, elevation, eyeHeight, fov or projection.",
      ),
    lighting: z
      .enum(VIEW_LIGHTING)
      .optional()
      .describe(
        "The light the picture is rendered in: the scene's own (current, the default), or day, overcast, sunset, dusk (twilight, the lights on) or night, as a reference photo was taken in.",
      ),
    maxPx: z
      .number()
      .int()
      .min(64)
      .max(VIEW_MAX_PX)
      .optional()
      .describe(
        "The picture's longest side in pixels, for a smaller one. Default 1920 by 1200, and never longer than 1920.",
      ),
    photo: z
      .looseObject({
        source: z
          .string()
          .min(1)
          .max(8_000_000)
          .describe(
            'The photo as a data:image/...;base64 URL (read the file and encode it); in the chat, the URL of a file the user attached works too.',
          ),
        region: z
          .array(z.number().min(0))
          .length(4)
          .describe("[left, top, right, bottom] in the photo's pixels: the element to compare."),
      })
      .optional()
      .describe(
        "The photo's crop of the element the view frames, returned beside it in the same call: a door's glass, a lamp's shape, a window's panes, at detail scale, to say what differs.",
      ),
  },
}
