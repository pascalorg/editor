import { z } from 'zod'

const color = z.string().regex(/^#[\da-f]{6}$/i)
const intensity = z.number().nonnegative()
const light = z.object({ color, intensity })

/** Saved rendering defaults. Geometry and canonical bake visibility are independent. */
export const SitePresentation = z.object({
  theme: z.string().min(1).optional(),
  exposure: intensity.optional(),
  shading: z.enum(['solid', 'rendered']).optional(),
  edges: z.enum(['off', 'soft', 'strong']).optional(),
  shadows: z.boolean().optional(),
  lighting: z
    .object({
      background: color.optional(),
      backgroundSky: color.nullable().optional(),
      ground: color.optional(),
      ambient: light.optional(),
      hemi: z.object({ sky: color, ground: color, intensity }).optional(),
      lights: z
        .array(
          light.extend({
            position: z.tuple([z.number(), z.number(), z.number()]),
            castShadow: z.boolean().optional(),
          }),
        )
        .optional(),
      environment: z.object({ source: z.enum(['gradient', 'room', 'none']), intensity }).optional(),
    })
    .optional(),
  postprocessing: z
    .object({ ambientOcclusion: z.boolean().optional(), colorGrading: z.boolean().optional() })
    .optional(),
  display: z
    .object({
      mode: z.enum(['finished', 'construction', 'systems']).optional(),
      families: z
        .partialRecord(
          z.enum([
            'finish',
            'exposed-structure',
            'framing',
            'masonry',
            'sheathing',
            'insulation',
            'membrane',
            'fill',
            'foundation',
            'service-space',
            'device',
            'run',
            'inspection',
          ]),
          z.boolean(),
        )
        .optional(),
      disciplines: z
        .partialRecord(
          z.enum(['mechanical', 'plumbing', 'electrical', 'low-voltage', 'fire']),
          z.boolean(),
        )
        .optional(),
      xray: z.boolean().optional(),
      colorBy: z.enum(['material', 'service']).optional(),
    })
    .optional(),
})

export type SitePresentation = z.infer<typeof SitePresentation>
