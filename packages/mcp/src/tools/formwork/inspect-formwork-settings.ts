import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  findFormworkSettingsNode,
  formworkSettingsReport,
  INSPECT_FORMWORK_SETTINGS_DESCRIPTION,
} from '@pascal-app/core/formwork'
import { z } from 'zod'
import type { SceneOperations } from '../../operations'
import { formworkAssemblyCount, sceneNodeList, textResult } from './shared'

/**
 * Loose objects rather than a field-by-field mirror of the node's schema.
 *
 * Every other output shape in this directory names its fields, and this one deliberately
 * does not: the settings groups are the node's own schema, and a second declaration of
 * them here would be a copy that passes review on the day it is written and then quietly
 * stops carrying a field the node gained. A group the schema knows about and this
 * shape does not is silently dropped from the reply — the project stating something the
 * agent cannot see, which is the exact failure this tool exists to prevent.
 */
const group = z.record(z.string(), z.unknown())

export const inspectFormworkSettingsOutput = {
  anythingStated: z.boolean(),
  resolved: z.object({
    pressureStandard: z.string(),
    measurementStandard: z.string(),
    riseRateMH: z.number(),
    concreteTemperatureC: z.number(),
    concrete: group,
    placement: group,
    curing: group,
    falseworkLoads: group,
    bracing: group,
    parts: group,
    ownedStock: z.record(z.string(), z.number()).nullable(),
    rates: group.nullable(),
  }),
  stated: z
    .object({
      pressureStandard: z.string().nullable(),
      measurementStandard: z.string().nullable(),
      concrete: group.nullable(),
      placement: group.nullable(),
      curing: group.nullable(),
      falseworkLoads: group.nullable(),
      bracing: group.nullable(),
      parts: group.nullable(),
      stock: group.nullable(),
      rates: group.nullable(),
    })
    .nullable(),
  assumedDefaults: z.object({
    riseRateMH: z.number(),
    concreteTemperatureC: z.number(),
    pressureStandard: z.string(),
    measurementStandard: z.string(),
  }),
  shuttersAffectedByAChange: z.number(),
}

export function registerInspectFormworkSettings(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'inspect_formwork_settings',
    {
      title: 'Inspect formwork settings',
      description: INSPECT_FORMWORK_SETTINGS_DESCRIPTION,
      inputSchema: {},
      outputSchema: inspectFormworkSettingsOutput,
    },
    async () => {
      const nodes = sceneNodeList(bridge)
      const report = formworkSettingsReport(findFormworkSettingsNode(nodes))
      return textResult({
        ...report,
        // What a change here would reach. Counted so a caller can say what a write is
        // about to re-design, not so anything is rebuilt: a shutter's parts and its
        // design report both solve from the settings at the moment they are read.
        shuttersAffectedByAChange: formworkAssemblyCount(nodes),
      })
    },
  )
}
