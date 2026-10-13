import { z } from 'zod'
import { NodeId } from './node-id'

const fraction = z.number().min(0).max(1)
const point = z
  .array(fraction)
  .length(2)
  .describe('A point of the photo as [across, down], fractions of its width and height (0 to 1).')
const segment = z.array(point).length(2)

export const straightenFacadePhotoTool = {
  name: 'straighten_facade_photo',
  title: 'Straighten a facade photo',
  description:
    "Straighten faces of a building photo into elevations at a known scale, to measure the facade instead of guessing it: bay pitch, pier and window widths, pane grids, side panels, spandrels, sill and head heights. Pass every face the photo shows in one call: they share the photo's camera, found from the lines picked on them, so each elevation is metric from its walls' width and the storey height is measured from the photo rather than taken from the scene. Per face: its vertical edges (two points on each, top and bottom as seen), the same feature on at least two storeys (the window heads of a low and a high floor, say: two points far apart along each, with that storey's level), and the face's walls on one storey (their extent is the width). A face whose far edge leaves the photo gives only the corner it shares with another face. Points are fractions of the photo, [0,0] its top left and [1,1] its bottom right. Returns per face the straightened elevation with a metre grid and the scene's storeys drawn at the picked feature, a close-up of each picked corner to check (call again with corrected points if one is off), the photo pixels per metre at each side, the fit error and the photo's storey height beside the scene's; and the camera: its focal length (a phone's main camera is about 26 mm), its tilt, what it assumes, and its pose in the scene (position, target, up, vertical fov, the photo's aspect): view_scene from that pose shows the scene as the photo does. One face seen square on (a frontal photo) gives a pose too, its focal length taken from focal35mm when it cannot be read from the photo. A single face with both edges is fitted from its own picks, its heights from the storeys. Only what lies on the wall plane measures true: balconies, overhangs and anything standing proud are smeared, and a face seen at a grazing angle has too few pixels per metre for panes.",
  input: {
    source: z.string().describe("The photo: its attachment URL, as the user's message gives it."),
    faces: z
      .array(
        z.object({
          name: z.string().optional().describe('What the face is, e.g. "east, corner to recess".'),
          wallIds: z
            .array(NodeId)
            .min(1)
            .max(32)
            .describe('The walls of this face on one storey, end to end (get_walls).'),
          edges: z
            .object({ left: segment.optional(), right: segment.optional() })
            .describe(
              'Two points on each vertical edge of the face as seen in the photo. When its far edge leaves the photo, give only the corner it shares with another face of this call, picked the same on both: the shared camera places the face from that corner, and its walls give the rest of its width.',
            ),
          rows: z
            .array(
              z.object({
                levelId: NodeId,
                points: segment,
                height: z
                  .number()
                  .min(0)
                  .max(20)
                  .optional()
                  .describe(
                    "The feature's height above that storey's floor when you know it (window heads about 2.1 m): it sets the camera's height. With heights, two rows on one storey are enough (the floor line at 0 and the eaves at the wall's height), which a single-storey house needs. Without it the edges' foot is taken for the ground.",
                  ),
              }),
            )
            .min(2)
            .max(8)
            .describe(
              'The same feature on several storeys (window heads, spandrel tops): two points far apart along it on each, and the level it belongs to. Their lines meet where the face recedes, which fixes the camera: long lines on storeys far apart hold it steadier.',
            ),
          points: z
            .array(
              z.object({
                along: z
                  .number()
                  .describe("Metres along the face from its left end as seen (the walls' extent)."),
                height: z.number().describe('Metres up from the floor of levelId.'),
                levelId: NodeId.optional().describe(
                  "The floor it is measured from. Default: the face walls'.",
                ),
                point: point,
              }),
            )
            .max(40)
            .optional()
            .describe(
              "Points at places you know on the face: a window's or a door's corners from the scene (get_walls), an eave's end. On one face seen square on they steady the camera's pose most: two edges and two lines alone move it metres for a few pixels of error.",
            ),
          lines: z
            .array(segment)
            .max(8)
            .optional()
            .describe(
              'More horizontal lines on this face, no level needed: sills, heads, spandrel or storey lines, two points far apart along each. They steady the camera: on two short rows a pick a pixel off can move a measure by several per cent, with two more lines it stays within a few.',
            ),
        }),
      )
      .min(1)
      .max(4),
    focal35mm: z
      .number()
      .min(8)
      .max(800)
      .optional()
      .describe(
        "The camera's focal length on a 36 × 24 mm frame, when you know it (the photo's metadata, or a render's camera): a face seen square on does not show it, and the pose then takes a phone's 26 mm and says so (focalAssumed).",
      ),
    verticals: z
      .array(segment)
      .max(12)
      .optional()
      .describe(
        "Vertical lines on the building besides the face edges (pier sides, window jambs, another corner), two points far apart on each. They give the camera's tilt and roll more surely than the face edges alone.",
      ),
  },
}
