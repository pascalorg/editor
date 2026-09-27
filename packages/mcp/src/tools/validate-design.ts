import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { DesignValidationSchema, validateDesign } from '@pascal-app/core/procedural-items'
import { z } from 'zod'
import type { SceneOperations } from '../operations'
import { READ_ONLY_TOOL_ANNOTATIONS } from './annotations'

export const validateDesignInput = {
  design: z
    .union([z.string(), z.record(z.string(), z.unknown())])
    .describe(
      'The design (procedural recipe v1) as an object, or as a JSON string for clients that cannot send recursive objects. Schema: pascal://schema/design.',
    ),
  parameters: z
    .record(z.string(), z.number())
    .optional()
    .describe('Parameter values to measure at, by parameter id. Defaults otherwise.'),
}

export const validateDesignOutput = DesignValidationSchema.shape

export function registerValidateDesign(server: McpServer, _bridge: SceneOperations): void {
  server.registerTool(
    'validate_design',
    {
      title: 'Validate design',
      description:
        'Check a design (procedural item recipe) without changing the scene. Returns `valid`, coded `diagnostics` with paths (errors block placement, warnings flag floating or unbalanced parts), the parameter `sweep`, and `measurements` at the given parameters: bounds, per-part bounds and instances, true triangle counts, draw groups per slot, datum contact and connected components. It is the authority: some rules are not expressible in pascal://schema/design. Repair and re-validate until `valid` is true.',
      inputSchema: validateDesignInput,
      outputSchema: validateDesignOutput,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async ({ design, parameters }) => {
      const result = validateDesign(design, { parameters })
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        structuredContent: result,
      }
    },
  )
}
