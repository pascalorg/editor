import { z } from 'zod'

const color = z.string().regex(/^#[\da-f]{6}$/i)
const intensity = z.number().nonnegative()
const light = z.object({ color, intensity })
const vector = z.tuple([z.number(), z.number(), z.number()])
const shadowCamera = z
  .object({
    left: z.number(),
    right: z.number(),
    top: z.number(),
    bottom: z.number(),
    near: z.number().positive(),
    far: z.number().positive(),
  })
  .refine(
    (camera) =>
      camera.left < camera.right && camera.bottom < camera.top && camera.near < camera.far,
    'A shadow camera needs ordered horizontal, vertical and depth bounds.',
  )

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
            position: vector,
            target: vector.optional(),
            castShadow: z.boolean().optional(),
            shadow: z
              .object({
                intensity: z.number().min(0).max(1).optional(),
                bias: z.number().optional(),
                normalBias: intensity.optional(),
                radius: intensity.optional(),
                // One 4096 square map is the shared viewer's authored-shadow memory budget.
                mapSize: z
                  .union([z.literal(512), z.literal(1024), z.literal(2048), z.literal(4096)])
                  .optional(),
                camera: shadowCamera.optional(),
              })
              .optional(),
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
