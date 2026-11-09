import { z } from 'zod'

export const SITE_CONTEXT_LAYERS = [
  'parcel',
  'zoning',
  'flood',
  'code_basis',
  'elevation',
  'utilities',
  'soils',
  'wetlands',
  'structures',
  'boundaries',
] as const

export const siteContextInput = {
  address: z.string().trim().min(1).max(500).optional(),
  latitude: z.number().finite().min(-90).max(90).optional(),
  longitude: z.number().finite().min(-180).max(180).optional(),
  layers: z.array(z.enum(SITE_CONTEXT_LAYERS)).min(1).max(SITE_CONTEXT_LAYERS.length).optional(),
  geometry: z.boolean().optional(),
  adjacent: z.boolean().optional(),
}

export const siteContextInputSchema = z
  .object(siteContextInput)
  .strict()
  .refine(
    (input) => input.address || (input.latitude !== undefined && input.longitude !== undefined),
    'An address or coordinates are required.',
  )

const context = {
  pluginId: z
    .string()
    .regex(/^[a-z0-9-]+:[a-z0-9-]+$/)
    .optional()
    .describe(
      "The installed Pascal plugin whose service grant this request uses: a plugin's own agent names it (get_scene.installedPlugins or the host's plugin list; an ID is not permission). Omit it to act as the person in Pascal's own Studio, which offers Studio media only.",
    ),
  projectId: z
    .string()
    .regex(/^project_[A-Za-z0-9_-]+$/)
    .optional()
    .describe(
      'The hosted project to use. Omit only when the host has an active hosted project. Local scene IDs do not authorize hosted services.',
    ),
}

const maxCredits = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER)
  .describe(
    'The maximum Pascal credits approved for this operation. Read list_pascal_services for the price; the gateway refuses a higher charge.',
  )

const readAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
}
/** A frame view_scene answered: its viewId, these exact pixels. */
const VIEW_ID = /^[0-9a-f]{64}\.(png|jpg|webp|gif)$/

const resultAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
}

export const listPascalServicesTool = {
  name: 'list_pascal_services',
  action: 'catalog',
  title: 'List Pascal services',
  description:
    "List the hosted services this project may use, current prices and available media models: those of an installed plugin, or without pluginId Pascal's own Studio and its default models. This lookup is free. Discoverability does not grant permission or spend credits.",
  input: context,
  annotations: readAnnotations,
} as const

export const pullSiteDataTool = {
  name: 'pull_site_data',
  action: 'site.pull',
  title: 'Pull site context',
  description:
    'Retrieve sourced parcel, terrain/elevation, flood, wetlands and other selected site context for a hosted project. Uses the fixed Pascal credit price from list_pascal_services, bounded by maxCredits. Keep pullKey for retries. Returns a retained operation; use get_site_pull while running or to reopen it free. Partial coverage and unknowns remain explicit. Does not edit the scene.',
  input: {
    ...context,
    ...siteContextInput,
    pullKey: z
      .string()
      .regex(/^[A-Za-z0-9_-]{8,128}$/)
      .describe(
        'A unique key for this requested pull. Reuse the same key and input after a lost response; changing either starts a different operation or is refused.',
      ),
    maxCredits,
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
} as const

export const getSitePullTool = {
  name: 'get_site_pull',
  action: 'site.result',
  title: 'Read saved site context',
  description:
    'Read a retained site operation and its sourced result for this project and plugin without another charge. May reconcile an interrupted operation and its refund. Does not start another pull or edit the scene.',
  input: { ...context, operationId: z.string().min(1).max(128) },
  annotations: resultAnnotations,
} as const

export const generateStudioMediaTool = {
  name: 'generate_studio_media',
  action: 'studio.generate',
  title: 'Generate project media',
  description:
    "Render an image, material or video of the project with a model from list_pascal_services, charged to this project's Pascal wallet. A call without quoteToken answers a quote (status 'quote': the model, settings, sources and the exact credits) and charges nothing: tell the person what it costs and ask before rendering, then call again with the same input and the quote's quoteToken to submit. When the person said the cost doesn't matter, pass confirm: false with maxCredits to submit at once. A submission answers a job to read with get_studio_generation. Sources are project snapshot or render ids, or a view_scene viewId (type 'view': the frame you looked at, kept in the project's Studio gallery once it is rendered); a source that is gone is refused, never dropped. Keep generationKey for retries: the same key and input never charge twice. Does not edit the scene.",
  input: {
    ...context,
    modelId: z.string().min(1).max(100),
    prompt: z.string().max(400_000).optional(),
    sources: z
      .array(
        z.discriminatedUnion('type', [
          z
            .object({
              type: z.enum(['snapshot', 'render']),
              id: z.string().min(1).max(128),
              role: z.string().max(100).optional(),
              frame: z.enum(['start', 'end']).optional(),
            })
            .strict(),
          z
            .object({
              type: z.literal('view'),
              id: z.string().regex(VIEW_ID).describe("A view_scene answer's viewId."),
              role: z.string().max(100).optional(),
              frame: z.enum(['start', 'end']).optional(),
            })
            .strict(),
        ]),
      )
      .max(32)
      .optional(),
    settings: z
      .object({
        aspectRatio: z.string().max(100).optional(),
        durationSeconds: z.number().finite().positive().optional(),
        resolution: z.string().max(100).optional(),
        quality: z.string().max(100).optional(),
      })
      .strict()
      .optional(),
    generationKey: z
      .string()
      .regex(/^[A-Za-z0-9_-]{8,128}$/)
      .describe(
        'A unique key for this requested render, the same for its quote and its submission. Reuse it with the same input after a lost response; a different input under it is refused.',
      ),
    quoteToken: z
      .string()
      .max(4096)
      .optional()
      .describe("The quote's token, once the person agreed to its credits: submits the render."),
    confirm: z
      .boolean()
      .optional()
      .describe(
        'false only when the person said the cost does not matter: submits without a quote, up to maxCredits.',
      ),
    maxCredits: maxCredits.optional(),
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
} as const

export const getStudioGenerationTool = {
  name: 'get_studio_generation',
  action: 'studio.status',
  title: 'Read project media generation',
  description:
    'Poll or reopen a media job created for this project and plugin without another charge. May reconcile provider completion or failure and its refund. Does not submit another generation or edit the scene.',
  input: {
    ...context,
    id: z.string().min(1).max(128),
    includePreview: z
      .boolean()
      .optional()
      .describe(
        'true to see a finished image: its preview (WebP, at most 1280 px) comes back as a picture. A video has none; give the person its video_url.',
      ),
  },
  annotations: resultAnnotations,
} as const

/** Released hosted operations; workflow implementation and admission belong to the host. */
export const HOSTED_SERVICE_TOOL_CONTRACTS = [
  listPascalServicesTool,
  pullSiteDataTool,
  getSitePullTool,
  generateStudioMediaTool,
  getStudioGenerationTool,
] as const

export type HostedServiceToolName = (typeof HOSTED_SERVICE_TOOL_CONTRACTS)[number]['name']
export type HostedServiceAction = (typeof HOSTED_SERVICE_TOOL_CONTRACTS)[number]['action']

export function findHostedServiceTool(name: string) {
  return HOSTED_SERVICE_TOOL_CONTRACTS.find((tool) => tool.name === name)
}
