import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  describePourSplit,
  INSPECT_POUR_UNITS_DESCRIPTION,
  POUR_CUT_REASON_LABELS,
  type PourCutReason,
} from '@pascal-app/core/formwork'
import {
  formworkCoverageCaveat,
  pourUnitsForHost,
} from '@pascal-app/nodes/formwork-assembly/headless'
import { z } from 'zod'
import type { SceneOperations } from '../../operations'
import { castableOrRefusal, round, sceneNodeList, sceneNodes, textResult } from './shared'

export const inspectPourUnitsOutput = {
  elementId: z.string(),
  kind: z.string(),
  limits: z.object({
    maxLiftHeight: z.number().nullable(),
    maxPourLength: z.number().nullable(),
    maxPourVolume: z.number().nullable(),
  }),
  pourUnitCount: z.number(),
  shutterCount: z.number(),
  totalVolumeCuM: z.number(),
  units: z.array(
    z.object({
      segment: z.number(),
      lift: z.number(),
      startAlong: z.number(),
      endAlong: z.number(),
      baseElevation: z.number(),
      topElevation: z.number(),
      volumeCuM: z.number(),
      bearsOnLiftBelow: z.boolean(),
      startCut: z.string().nullable(),
      endCut: z.string().nullable(),
    }),
  ),
  coverageCaveat: z.string().nullable(),
  message: z.string(),
}

/**
 * How an element is divided into separately cast pours, and why each cut is there.
 *
 * This is the read behind three different answers, which is why it exists rather than
 * being folded into the bill. The unit count is the shutter count, so it is how an agent
 * checks whether an element is formed for the way it is cast. Each cut is a construction
 * joint carrying roughening and starter bars, so the reasons are the answer to "why is
 * there a joint there" — and they are reported as core's own labels rather than bare enum
 * names, because a host with no system prompt has nothing to translate `MAX_POUR_VOLUME`
 * with.
 *
 * And `volumeCuM` is per unit on purpose: it is what the batch plant has to deliver in one
 * go before the first concrete placed reaches initial set. A total is in `totalVolumeCuM`
 * for the concrete order, but the per-unit figure is the one the supply constraint is
 * about, and adding them is how a 3-lift wall reads as deliverable in one pour.
 */
export function registerInspectPourUnits(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'inspect_pour_units',
    {
      title: 'Inspect pour units',
      description: INSPECT_POUR_UNITS_DESCRIPTION,
      inputSchema: { elementId: z.string().min(1) },
      outputSchema: inspectPourUnitsOutput,
    },
    async ({ elementId }) => {
      const nodes = sceneNodes(bridge)
      const host = castableOrRefusal(nodes, elementId)
      if ('isError' in host) return host

      const all = sceneNodeList(bridge)
      const units = pourUnitsForHost(host, all)
      const shutterCount = all.filter(
        (node) => node.type === 'formwork-assembly' && node.parentId === elementId,
      ).length
      const label = (reason: PourCutReason | undefined): string | null =>
        reason === undefined ? null : POUR_CUT_REASON_LABELS[reason]
      const caveat = formworkCoverageCaveat(elementId, shutterCount, Math.max(1, units.length))

      return textResult({
        elementId,
        kind: host.type as string,
        limits: {
          maxLiftHeight: host.maxLiftHeight ?? null,
          maxPourLength: host.maxPourLength ?? null,
          maxPourVolume: host.maxPourVolume ?? null,
        },
        pourUnitCount: Math.max(1, units.length),
        shutterCount,
        totalVolumeCuM: round(units.reduce((sum, unit) => sum + unit.volumeCuM, 0)),
        units: units.map((unit) => ({
          segment: unit.segmentIndex,
          lift: unit.liftIndex,
          startAlong: round(unit.startAlong),
          endAlong: round(unit.endAlong),
          baseElevation: round(unit.baseElevation),
          topElevation: round(unit.topElevation),
          volumeCuM: round(unit.volumeCuM),
          bearsOnLiftBelow: unit.hasJointBelow,
          startCut: label(unit.startCutReason),
          endCut: label(unit.endCutReason),
        })),
        coverageCaveat: caveat ?? null,
        message: [`${elementId} is ${describePourSplit(units)}`, caveat].filter(Boolean).join('. '),
      })
    },
  )
}
