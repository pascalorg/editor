import { z } from 'zod'

const point = z.array(z.number()).length(3)

export const VIEW_SIDES = [
  'north',
  'north-east',
  'east',
  'south-east',
  'south',
  'south-west',
  'west',
  'north-west',
  'above',
] as const

export const viewSceneTool = {
  name: 'view_scene',
  title: 'Look at the scene',
  description:
    "Look at the building in 3D from a viewpoint you pick and get the picture back. Use it to compare what you built with a reference and say what differs before you fix it: the facade from the photo's own camera (camera: the camera.pose straighten_facade_photo returned), rendered at the photo's aspect to lay beside it; or from the photo's side at street height (from, eyeHeight 1.7); one face square on (projection orthographic) beside its straightened elevation; the massing from above. North is the plan's top edge (z grows south, x east). The view frames the target (a building, a level, a wall or a zone; the whole building by default) from outside, unless you place the eye yourself with position or camera. A door, a window or an item on a floor frames at detail scale, an opening seen from its outside face: a close-up to lay beside the photo's crop of the same element, to see what differs. Over the MCP an editor tab open on the project renders the picture: with none open it is refused (no_editor_open). A picture is not a measure: take sizes and counts from the tools.",
  input: {
    target: z
      .string()
      .optional()
      .describe(
        'A building, level, wall, zone, door, window or floor item id to frame. Default: every wall in the scene.',
      ),
    from: z
      .enum(VIEW_SIDES)
      .optional()
      .describe('The side the eye stands on, as a compass on the plan. Default south-west.'),
    elevation: z
      .number()
      .min(-10)
      .max(89)
      .optional()
      .describe('Degrees above the horizon the eye looks down from. Default 12.'),
    eyeHeight: z
      .number()
      .min(0)
      .optional()
      .describe('Metres above the ground for a street view (1.7), instead of elevation.'),
    // Arrays of three, not tuples: a tuple's list-form schema is refused by some clients.
    position: point
      .optional()
      .describe('The eye exactly, [x, height, z] in metres; it looks at the target.'),
    fov: z
      .number()
      .min(10)
      .max(100)
      .optional()
      .describe('Vertical field of view in degrees for a perspective view. Default 45.'),
    projection: z
      .enum(['perspective', 'orthographic'])
      .optional()
      .describe('orthographic for a square-on elevation of a face, no perspective.'),
    camera: z
      .looseObject({
        position: point,
        target: point,
        fov: z.number().min(5).max(120),
        aspect: z.number().min(0.2).max(5),
      })
      .optional()
      .describe(
        "A photo's camera, as straighten_facade_photo returned it (camera.pose, passed whole): the render takes its eye, aim and field of view at the photo's aspect. Not with from, position, elevation, eyeHeight, fov or projection.",
      ),
  },
}
