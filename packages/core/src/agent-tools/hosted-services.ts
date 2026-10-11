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
    .describe(
      "The installed Pascal plugin whose service grant this request uses. Read get_scene.installedPlugins or the host's plugin list; an ID is not permission.",
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
    'List the hosted services an installed plugin may use in this project, current prices and available media models. This lookup is free. Discoverability does not grant permission or spend credits.',
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
    "Generate an image, material or video using an available model from list_pascal_services. Charges this project's Pascal wallet up to maxCredits; returns a job ID to read with get_studio_generation. Uses authorized project snapshot/render references. Does not edit the scene. After a lost response, inspect the project's Studio history before submitting again; a new submission may charge again.",
  input: {
    ...context,
    modelId: z.string().min(1).max(100),
    prompt: z.string().max(400_000).optional(),
    sources: z
      .array(
        z
          .object({
            type: z.enum(['snapshot', 'render']),
            id: z.string().min(1).max(128),
            role: z.string().max(100).optional(),
            frame: z.enum(['start', 'end']).optional(),
          })
          .strict(),
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
    maxCredits,
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
} as const

export const getStudioGenerationTool = {
  name: 'get_studio_generation',
  action: 'studio.status',
  title: 'Read project media generation',
  description:
    'Poll or reopen a media job created for this project and plugin without another charge. May reconcile provider completion or failure and its refund. Does not submit another generation or edit the scene.',
  input: { ...context, id: z.string().min(1).max(128) },
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
