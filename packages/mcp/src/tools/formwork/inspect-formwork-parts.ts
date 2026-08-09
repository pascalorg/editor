import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  formworkPartsQueryInput,
  INSPECT_FORMWORK_PARTS_DESCRIPTION,
  noFormworkAssembly,
} from '@pascal-app/core/formwork'
import { formworkPartsReport } from '@pascal-app/nodes/formwork-assembly/headless'
import { z } from 'zod'
import type { SceneOperations } from '../../operations'
import { castableOrRefusal, refusal, sceneNodes, textResult } from './shared'

export const inspectFormworkPartsOutput = {
  kind: z.string(),
  shutters: z.array(
    z.object({
      assemblyId: z.string(),
      segment: z.number(),
      lift: z.number(),
      partCount: z.number(),
      parts: z.array(
        z.object({
          mark: z.string(),
          kind: z.string(),
          label: z.string(),
          description: z.string(),
          catalogId: z.string().nullable(),
          provenance: z.string(),
          weightKg: z.number().nullable(),
          utilisation: z.number().nullable(),
          governingCheck: z.string().nullable(),
          omittedFromOrder: z.boolean(),
          note: z.string().nullable(),
        }),
      ),
    }),
  ),
  bom: z.array(
    z.object({
      description: z.string(),
      catalogId: z.string().nullable(),
      provenance: z.string(),
      quantity: z.number(),
      unit: z.string(),
      totalWeightKg: z.number().nullable(),
      marks: z.array(z.string()),
    }),
  ),
  totalWeightKg: z.number(),
  totalWeightComplete: z.boolean(),
  hardestWorked: z
    .object({
      mark: z.string(),
      utilisation: z.number(),
      governingCheck: z.string().nullable(),
    })
    .nullable(),
  beyondCapacity: z.array(
    z.object({
      mark: z.string(),
      utilisation: z.number(),
      governingCheck: z.string().nullable(),
    }),
  ),
  duplicateMarks: z.array(z.object({ assemblyId: z.string(), mark: z.string() })),
  staleEdits: z.array(z.object({ assemblyId: z.string(), mark: z.string() })),
  coversWholeElement: z.boolean(),
  coverageCaveat: z.string().nullable(),
}

/**
 * One element's shutter, part by part — the read a substitution has to be made against.
 *
 * `inspect_project_formwork` is the scope a yard orders at and this is not a smaller
 * version of it. What this carries and a bill cannot is the *marks*: a bill line says
 * 34 panels, and a decision is made about one of them. So this is the only read from
 * which `set_formwork_part` can be called, and the two are shipped together for that
 * reason — a write keyed on a handle no read reports is a write an agent can only make
 * by guessing.
 *
 * The report itself is `@pascal-app/nodes`', shared with the editor's chat tools. Its
 * comment says why the shape rather than the numbers is what would have diverged.
 */
export function registerInspectFormworkParts(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'inspect_formwork_parts',
    {
      title: 'Inspect formwork parts',
      description: INSPECT_FORMWORK_PARTS_DESCRIPTION,
      inputSchema: formworkPartsQueryInput,
      outputSchema: inspectFormworkPartsOutput,
    },
    async ({ elementId, kind }) => {
      const nodes = sceneNodes(bridge)
      const host = castableOrRefusal(nodes, elementId)
      if ('isError' in host) return host

      const report = formworkPartsReport(host, nodes, { kind })
      // Refused rather than answered with an empty bill. A bill of nothing reads as an
      // element that needs nothing, which is the opposite of one awaiting a shutter.
      if (!report) return refusal(noFormworkAssembly(elementId))

      return textResult(report)
    },
  )
}
