import { z } from 'zod'
import { AssetUrl } from './asset-url'
import { generateId } from './base'
import type { AnyNodeId } from './types'

export type DefinitionId = `definition_${string}`

export const Definition = z.object({
  id: z.custom<DefinitionId>(
    (value) => typeof value === 'string' && value.startsWith('definition_'),
    'Definition id must start with "definition_"',
  ),
  name: z.string().min(1),
  rootNodeId: z.custom<AnyNodeId>(
    (value) => typeof value === 'string' && value.length > 0,
    'Definition root node id is required',
  ),
  thumbnail: AssetUrl.optional(),
})

export type Definition = z.infer<typeof Definition>

export const generateDefinitionId = (): DefinitionId => generateId('definition')
