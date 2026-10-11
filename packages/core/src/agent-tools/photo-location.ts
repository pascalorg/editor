import { z } from 'zod'
import { NodeId } from './node-id'
import { extendVerifyScene } from './verify-scene'

export const photoStretch = z.object({
  kind: z
    .enum(['flush', 'recess', 'projection'])
    .describe('flush: on the face line; recess: set back from it; projection: standing out of it.'),
  bays: z
    .number()
    .int()
    .min(1)
    .max(60)
    .optional()
    .describe('The window bays you count on this stretch, when the photo shows it whole.'),
  balconies: z
    .number()
    .int()
    .min(0)
    .max(30)
    .optional()
    .describe('The balconies on this stretch on one typical storey.'),
})

const face = z.object({
  segments: z
    .array(photoStretch)
    .min(1)
    .max(8)
    .describe('The stretches of this face from the corner outward, as far as the photo goes.'),
})

export const locatePhotoTool = {
  name: 'locate_photo',
  title: 'Locate a building photo on the plan',
  description:
    "Find which outside corner of the building a corner photo shows, and which walls each of its two faces is: the walls straighten_facade_photo needs. Describe the photo first, from the photo alone: for the face left of the corner and the face right of it, the stretches from the corner outward (flush, recess or projection) with the bays and balconies per storey you count. The tool walks the floor's exterior outline as seen from outside each corner and ranks the corners against that description, saying what does not match. Left and right are the photo's: a mirrored reading would put the facade on the wrong walls. Without levelId it tries every floor and keeps the one the description fits best (a floor whose walls run straight past a recess fits none). It assumes the plan is drawn as seen from above, not mirrored. confident is false when two corners fit equally (ambiguous) or the best one still disagrees with the photo: then ask the person which corner it is, never straighten or build on a guess.",
  input: {
    levelId: NodeId.optional().describe(
      'One floor to match on. Omit it to try every floor with exterior walls and keep the best.',
    ),
    left: face.describe('The face on the left of the corner in the photo.'),
    right: face.describe('The face on the right of the corner in the photo.'),
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

// verify_scene compares the photo, as the agent read it, with what is built: the photo's input and
// sentence, declared here with the photo, for the check photo-facade-check registers.
extendVerifyScene({
  description:
    'Pass the photo as you described it to locate_photo and it is compared with what is built, floor by floor (photo_facade_mismatch).',
  input: {
    photo: z
      .object({
        faces: z
          .array(
            z.object({
              wallId: NodeId.describe('A wall of the face the photo shows.'),
              from: z
                .enum(['left', 'right'])
                .optional()
                .describe(
                  "The face's end its stretches are listed from, as seen: left (default, a frontal photo or the face right of a corner) or right (the face left of a corner, listed from the corner outward).",
                ),
              whole: z
                .boolean()
                .optional()
                .describe('The photo shows the whole face, so its last stretch is counted too.'),
              segments: z.array(photoStretch).min(1).max(8),
            }),
          )
          .min(1)
          .max(4),
      })
      .optional()
      .describe(
        'The photo as you read it: each face it shows, its stretches (flush, recess or projection) with the bays and balconies per storey. Each floor is compared with it.',
      ),
  },
})
