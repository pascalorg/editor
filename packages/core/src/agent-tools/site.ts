import { z } from 'zod'
import { measurement } from './measurement'
import { NodeId } from './node-id'

const building = NodeId.optional().describe(
  "The building, by its id (list_levels' parentId). Default: the building of the floor the person is viewing, else the scene's only building.",
)

const yard = (side: string) =>
  measurement('length', 'm', {
    min: 0,
    description: `The ${side} yard: from the lot line to the house, square to the house.`,
  }).optional()

export const getSiteTool = {
  name: 'get_site',
  title: 'Get site',
  description:
    'Read the site a building stands on, in its level coordinates: the lot, the buildable area inside the setbacks and its centre, the street side, north, the address, parcel and zoning when known, whether the lot is only the new-project placeholder, and where the footprint sits now with its yards.',
  input: { building },
}

export const placeBuildingTool = {
  name: 'place_building',
  title: 'Place building',
  description:
    "Stand a building on its site before or after its walls go up. It moves only the building node, so walls, levels and roofs keep their coordinates and move with it. The footprint (outline, the plan you are about to draw, in the coordinates you will draw it; else the walls standing) lands centred in the buildable area, or at the yards a site plan or the person gives. A building with walls keeps its rotation unless rotationDeg is given (get_site's squareRotationDeg squares it to the street); one with none yet is turned square to the street. Fences, paths and plants on its levels move with it.",
  input: {
    building,
    outline: z
      .array(z.array(z.number()).length(2))
      .min(3)
      .optional()
      .describe(
        "The footprint's corners in order, as [x, z] in metres, in the level coordinates the walls are (or will be) drawn in. Default: the walls standing.",
      ),
    yards: z
      .object({
        front: yard('front'),
        rear: yard('rear'),
        left: yard('left (seen from the street)'),
        right: yard('right (seen from the street)'),
      })
      .optional()
      .describe(
        'Where the house stands instead of centred: at most one of front and rear, and one of left and right, from a site plan or the person. An axis not given stays centred in the buildable area. Needs the site to know its street (frontEdge).',
      ),
    rotationDeg: measurement('angle', 'deg', {
      description:
        "The building's rotation about the vertical. Default: the rotation it has, or square to the street while it has no walls.",
    }).optional(),
  },
}
