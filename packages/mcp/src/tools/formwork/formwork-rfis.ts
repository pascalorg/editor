import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  FORMWORK_RFI_DESCRIPTION,
  formworkRfiCandidates,
  RFI_ADDRESSEE_LABELS,
  rfiSummary,
} from '@pascal-app/core/formwork'
import { validateProjectFormwork } from '@pascal-app/nodes/formwork-assembly/headless'
import { z } from 'zod'
import type { SceneOperations } from '../../operations'
import { NodeIdSchema } from '../schemas'
import { formworkScopeInput, noSuchLevel, sceneNodes, textResult } from './shared'

export const formworkRfisOutput = {
  scope: z.string(),
  questions: z.array(
    z.object({
      invariant: z.string(),
      addressee: z.enum(['engineer-of-record', 'architect']),
      addresseeLabel: z.string(),
      subject: z.string(),
      question: z.string(),
      unblocks: z.string(),
      elementIds: z.array(NodeIdSchema),
      findingKeys: z.array(z.string()),
      context: z.array(z.string()),
      beforePour: z.boolean(),
    }),
  ),
  beforePourCount: z.number(),
  findingCount: z.number(),
  summary: z.array(z.string()),
}

/**
 * The findings this surface must not offer to fix.
 *
 * `validate_formwork` already says what would clear every finding, and for eleven of the
 * twenty-one invariants the honest answer is "nothing this feature writes". Left there,
 * an agent reads a defect with no call attached and does the natural thing: it proposes a
 * layout change, or it invents a detail. Both are the sender doing the designer's work,
 * on the two subjects — a waterstop across a joint, an anchor load into hardened concrete
 * — where being wrong is a leak or a collapse rather than a re-order.
 *
 * So this is the other half of the remedy answer, and it is a separate tool rather than a
 * field on the validate reply because the two are asked at different times. Validation is
 * run before quoting a takeoff; the questions are drafted when somebody sits down to write
 * them, over a scope, in the wording they will be sent in.
 *
 * ## Why it re-validates rather than taking findings as input
 *
 * A tool accepting a findings array would let a model hand back an edited copy of a
 * validate reply and receive questions about defects the scene no longer has — or worse,
 * about wording it composed itself. The scope in, the scene read, the suite run: the
 * questions are then about the building as it stands.
 *
 * ## Why `findingCount` is reported beside the questions
 *
 * Ten questions over forty findings is the normal shape, and without the second number a
 * reply of ten reads as a job with ten problems. The gap is the point: most findings are
 * ours to fix and `validate_formwork` says how.
 */
export function registerFormworkRfis(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'formwork_rfis',
    {
      title: 'Formwork questions for the designer',
      description: FORMWORK_RFI_DESCRIPTION,
      inputSchema: formworkScopeInput,
      outputSchema: formworkRfisOutput,
    },
    async ({ elementIds, levelId }) => {
      const nodes = sceneNodes(bridge)
      if (levelId !== undefined && nodes[levelId]?.type !== 'level') return noSuchLevel(levelId)

      const { report } = validateProjectFormwork(nodes, {
        hostIds: elementIds,
        parentId: levelId,
      })
      const candidates = formworkRfiCandidates(report.findings)

      return textResult({
        scope: levelId ?? (elementIds ? 'the elements named' : 'whole scene'),
        questions: candidates.map((candidate) => ({
          invariant: candidate.invariant as string,
          addressee: candidate.addressee,
          addresseeLabel: RFI_ADDRESSEE_LABELS[candidate.addressee],
          subject: candidate.subject,
          question: candidate.question,
          unblocks: candidate.unblocks,
          elementIds: candidate.elementIds as string[],
          findingKeys: candidate.findingKeys,
          context: candidate.context,
          beforePour: candidate.beforePour,
        })),
        beforePourCount: candidates.filter((candidate) => candidate.beforePour).length,
        // The denominator. Without it, ten questions read as a job with ten problems
        // rather than as the tenth of forty findings that are not ours to answer.
        findingCount: report.findings.length,
        // The same sentences the Buildability panel prints, ending in the one that keeps
        // a list of questions from being read as questions already sent.
        summary: rfiSummary(candidates),
      })
    },
  )
}
