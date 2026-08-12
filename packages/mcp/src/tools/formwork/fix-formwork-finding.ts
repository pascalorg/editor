import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  applyPourLimitsPatch,
  FIX_FORMWORK_FINDING_DESCRIPTION,
  findingByKey,
  fixFindingInput,
} from '@pascal-app/core/formwork'
import type { AnyNode, AnyNodeId, FormworkAssemblyNode } from '@pascal-app/core/schema'
import { buildSolverJointNodes } from '@pascal-app/nodes/construction-joint/headless'
import {
  fixOutcome,
  noSuchFinding,
  plannedFix,
  reconcileFormworkNodes,
  validateProjectFormwork,
} from '@pascal-app/nodes/formwork-assembly/headless'
import { z } from 'zod'
import type { Patch } from '../../bridge/scene-bridge'
import type { SceneOperations } from '../../operations'
import { publishLiveSceneSnapshot } from '../live-sync'
import { refusal, sceneNodeList, sceneNodes, textResult } from './shared'

export const fixFormworkFindingOutput = {
  findingKey: z.string(),
  applied: z.array(z.string()),
  elementId: z.string(),
  rebuiltShutters: z.number(),
  cleared: z.boolean(),
  errorCount: z.number(),
  warningCount: z.number(),
  raised: z.array(z.object({ invariant: z.string(), message: z.string() })),
  message: z.string(),
}

/**
 * The one write on this surface whose subject is a *finding* rather than a building.
 *
 * Everything else here records a decision somebody made — a system, a date, a
 * substitution. This applies a decision the check itself already made, which is only
 * defensible because of what it does afterwards: it re-runs the whole suite and reports
 * whether that finding stopped firing. A fix tool that returned "ok" would be asking to
 * be trusted about the one thing an agent cannot check for itself.
 *
 * ## Why it takes a key and no values
 *
 * The cap comes off the finding. An input that also accepted a height would let a model
 * apply its own figure under the check's name, and the reply would then report a defect
 * cleared by arithmetic nobody verified — where the cap the check offers was searched
 * through the real splitter and kept only because the real joints came back clean.
 *
 * ## Why it rebuilds, and why that is not a separate call
 *
 * A pour limit changes how many pours an element has and builds nothing. `set_pour_limits`
 * can leave that to the agent because the agent asked for the limit and is told to attach;
 * here the agent asked for a *fix*, and a fix that leaves the element cast in more pours
 * than it is formed for has traded a reported error for an unreported one — the takeoff
 * short by the difference, with nothing in the numbers marking it. So the write and the
 * rebuild go in one `applyPatch` with the joints, for the reason `attach_formwork` does:
 * a rebuild that half-lands leaves an element formed for nothing.
 *
 * ## Why the second validation is scoped like the first
 *
 * Whole-scene, because the fix is. A cap on one wall changes that wall's joints and
 * nothing else's, but the suite reads the neighbours to classify faces, and a re-check
 * narrowed to the element would miss exactly the collateral this tool exists to report.
 */
export function registerFixFormworkFinding(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'fix_formwork_finding',
    {
      title: 'Fix a formwork finding',
      description: FIX_FORMWORK_FINDING_DESCRIPTION,
      inputSchema: fixFindingInput,
      outputSchema: fixFormworkFindingOutput,
    },
    async ({ findingKey: key }) => {
      const nodes = sceneNodes(bridge)
      const before = validateProjectFormwork(nodes).report
      const finding = findingByKey(before.findings, key)
      if (!finding) return refusal(noSuchFinding(key))

      const plan = plannedFix(finding)
      if (plan.refusal !== undefined || !plan.elementId || !plan.limits) {
        return refusal(plan.refusal ?? 'Nothing to apply for that finding.')
      }
      const host = nodes[plan.elementId]
      if (!host) return refusal(`Error: ${plan.elementId} is no longer in the scene.`)

      // The same gate a hand-made `set_pour_limits` passes, so a fix cannot write a cap the
      // tool itself would refuse.
      const patch = applyPourLimitsPatch(host.type as 'wall' | 'column' | 'slab', plan.limits)
      if (patch.error !== undefined) return refusal(patch.error)

      const patches: Patch[] = [
        { op: 'update', id: plan.elementId, data: patch.writes as Partial<AnyNode> },
      ]
      let rebuilt = 0
      if (plan.rebuild === true) {
        // Reconciled against the element as it will be, not as it is: the cap is what
        // creates the pour units the new shutters are for, so the split has to be read off
        // the updated node or the rebuild would form the old pour.
        const levelNodes = sceneNodeList(bridge).map((node) =>
          node.id === plan.elementId ? ({ ...node, ...patch.writes } as AnyNode) : node,
        )
        const updated = levelNodes.find((node) => node.id === plan.elementId) as Parameters<
          typeof reconcileFormworkNodes
        >[0]
        const existing = levelNodes
          .filter((node) => node.type === 'formwork-assembly' && node.parentId === plan.elementId)
          .map((node) => node as unknown as FormworkAssemblyNode)
        const { create, keep, orphan } = reconcileFormworkNodes(updated, existing, levelNodes)
        rebuilt = keep.length + create.length
        patches.push(
          ...orphan.map(
            (assembly): Patch => ({ op: 'delete', id: assembly.id as AnyNodeId, cascade: true }),
          ),
          ...create.map(
            (assembly): Patch => ({
              op: 'create',
              node: assembly as unknown as AnyNode,
              parentId: plan.elementId as AnyNodeId,
            }),
          ),
          // Each cut between two pour units is a real construction joint carrying
          // roughening and starter bars, so it exists as a node or the work is invisible to
          // the takeoff.
          ...buildSolverJointNodes(updated, levelNodes).map(
            (joint): Patch => ({
              op: 'create',
              node: joint as unknown as AnyNode,
              parentId: (joint.parentId as AnyNodeId | null) ?? undefined,
            }),
          ),
        )
      }
      bridge.applyPatch(patches)
      await publishLiveSceneSnapshot(bridge, 'fix_formwork_finding')

      // The claim this tool actually makes. Read from the scene the fix produced rather
      // than from the plan that produced it, so the verdict cannot agree with itself.
      const after = validateProjectFormwork(sceneNodes(bridge)).report
      const outcome = fixOutcome(before, after, key)

      return textResult({
        findingKey: key,
        applied: patch.changed,
        elementId: plan.elementId as string,
        rebuiltShutters: rebuilt,
        cleared: outcome.cleared,
        errorCount: after.errorCount,
        warningCount: after.warningCount,
        raised: outcome.raised.map((entry) => ({
          invariant: entry.invariant as string,
          message: entry.message,
        })),
        message: [`${patch.changed.join(', ')} on ${plan.elementId}`, outcome.message]
          .filter(Boolean)
          .join('. '),
      })
    },
  )
}
