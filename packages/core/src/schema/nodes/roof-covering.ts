import { z } from 'zod'

/** Visual covering detail only: does not change the roof's structural or hosting surface. */
export const RoofCovering = z
  .object({
    profile: z.enum(['tile', 'clay', 'slate']),
    width: z.number().finite().min(0.05).max(2).default(0.3),
    course: z.number().finite().min(0.05).max(2).default(0.32),
    relief: z.number().finite().min(0).max(0.05).default(0.008),
    distance: z.number().finite().min(1).max(100).default(20),
    caps: z.boolean().optional(),
  })
  .describe(
    'Opt-in near-camera plain tile, rounded clay or slate courses with staggered joints, lap shading and normal detail, in roof-plane metres: width, course spacing, relief, and camera distance. Requires a plain top colour (for example topMaterialPreset "#ad5936"); textured finishes keep their own maps instead. Planar gable, hip, shed, gambrel, dutch and mansard only; not glazed, swept or curved roofs. Absent: the existing finish unchanged. Optional caps:true adds ridge/hip cap courses only to a single untrimmed gable/hip with no hosted children except native gutters/downspouts, no sibling roofs on its level and no upper-building clips; never valleys. Caps are omitted above 512 pieces per segment. Export retains the same detail and caps regardless of camera distance. Fascia and gutters are separate.',
  )

export type RoofCovering = z.infer<typeof RoofCovering>
