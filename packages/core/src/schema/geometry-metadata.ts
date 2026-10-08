import { z } from 'zod'

export function capText(value: string, limit: number): string {
  const text = value.trim().slice(0, limit)
  return /[\uD800-\uDBFF]$/.test(text) ? text.slice(0, -1) : text
}

export function capPrompt(value: string): string {
  let bytes = 0
  let result = ''
  for (const char of value.trim()) {
    bytes += new TextEncoder().encode(char).length
    if (bytes > 4096) break
    result += char
  }
  return result
}

const text = (limit: number) =>
  z
    .string()
    .overwrite((value) => capText(value, limit))
    .max(limit)

export const geometryMetaFields = {
  name: text(120).optional().describe('What the user would call this design.'),
  description: text(200)
    .optional()
    .describe('A short description of this design, at most 200 characters.'),
  category: text(60).optional().describe('What this design is, in one or two words.'),
  tags: z
    .array(
      z
        .string()
        .overwrite((value) => capText(value.toLowerCase(), 32))
        .max(32),
    )
    .overwrite((values) => values.slice(0, 5))
    .max(5)
    .optional()
    .describe('Up to five short lowercase search tags, at most 32 characters each.'),
}

/** What an agent tool says about a design, recorded in its artifacts' provenance. */
export const GeometryReuseFields = z.object(geometryMetaFields)

/**
 * Reuse metadata on a scripted node's source. The name lives on the node and an
 * item's category on its asset, so neither is repeated here.
 */
export const GeometrySourceMeta = GeometryReuseFields.omit({ name: true }).extend({
  parent: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
})
export type GeometrySourceMeta = z.infer<typeof GeometrySourceMeta>

export const GeometryArtifactMetadata = z.object({
  ...geometryMetaFields,
  prompt: z.string().overwrite(capPrompt).max(4096).optional(),
  model: text(200).optional(),
  sessionId: text(200).optional(),
  operationId: text(200).optional(),
  kind: z.enum(['item', 'door', 'window', 'column']).optional(),
  mount: z.enum(['floor', 'wall', 'wall-side', 'ceiling']).optional(),
})
export type GeometryArtifactMetadata = z.infer<typeof GeometryArtifactMetadata>
