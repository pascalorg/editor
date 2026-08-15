import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  MATERIAL_CATALOG,
  MATERIAL_CATEGORIES,
  MATERIAL_SURFACES,
  toLibraryMaterialRef,
} from '@pascal-app/core'
import { z } from 'zod'

/**
 * Publish the finish catalog so an agent can dress what it builds.
 *
 * Every other material path in the MCP surface takes a `library:<id>` ref and
 * has no way to tell you which ids exist — the catalog lived only in the
 * editor's picker. Guessing a texture id is not something a model should be
 * asked to do, so this is the same trick `describe_node_type` plays for node
 * schemas: read the editor's own table at call time rather than transcribe it.
 */

/** One page of finishes. The full catalog is ~114 entries; a filtered ask is the point. */
const DEFAULT_LIMIT = 40

export const listMaterialsInput = {
  category: z
    .enum(MATERIAL_CATEGORIES)
    .optional()
    .describe('Restrict to one material family, e.g. wood, tile, concrete.'),
  surface: z
    .enum(MATERIAL_SURFACES)
    .optional()
    .describe(
      'Restrict to finishes appropriate for this surface. Entries with no declared surfaces (flat colours) are universal and always included.',
    ),
  query: z.string().optional().describe('Case-insensitive substring match on the label or id.'),
  limit: z.number().int().positive().max(200).optional(),
}

export const listMaterialsOutput = {
  materials: z.array(
    z.object({
      /** Pass this verbatim as `paint_surfaces`'s `material`. */
      ref: z.string(),
      label: z.string(),
      category: z.string(),
      surfaces: z.array(z.string()).optional(),
      previewColor: z.string().optional(),
    }),
  ),
  categories: z.array(z.object({ category: z.string(), count: z.number() })),
  total: z.number().describe('Matches before the limit was applied.'),
}

export function registerListMaterials(server: McpServer): void {
  server.registerTool(
    'list_materials',
    {
      title: 'List materials',
      description:
        "List the finishes available to paint onto a node's surfaces — wood, stone, tile, brick, concrete, metal, fabric, flat colours. Returns a `ref` for each, which is what `paint_surfaces` takes. Filter by category, by the surface being painted, or by a text query; call with no arguments for the category index. Read from the editor's own catalog, so every ref returned is real.",
      inputSchema: listMaterialsInput,
      outputSchema: listMaterialsOutput,
    },
    async ({ category, surface, query, limit }) => {
      const needle = query?.trim().toLowerCase()
      const matches = MATERIAL_CATALOG.filter((item) => {
        if (category && item.category !== category) return false
        // No declared surfaces means universal (flat colours), not "matches nothing".
        if (surface && item.surfaces && !item.surfaces.includes(surface)) return false
        if (needle && !`${item.label} ${item.id}`.toLowerCase().includes(needle)) return false
        return true
      })

      const counts = new Map<string, number>()
      for (const item of matches) counts.set(item.category, (counts.get(item.category) ?? 0) + 1)

      const materials = matches.slice(0, limit ?? DEFAULT_LIMIT).map((item) => ({
        ref: toLibraryMaterialRef(item.id),
        label: item.label,
        category: item.category as string,
        ...(item.surfaces ? { surfaces: item.surfaces as string[] } : {}),
        ...(item.previewColor ? { previewColor: item.previewColor } : {}),
      }))

      const payload = {
        materials,
        categories: [...counts.entries()]
          .map(([c, count]) => ({ category: c, count }))
          .sort((a, b) => a.category.localeCompare(b.category)),
        total: matches.length,
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
      }
    },
  )
}
