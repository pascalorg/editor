import { refuse } from '../agent-tools/refusal'
import { checkCoherence } from '../coherence'
import { disputeRecord } from '../coherence/disputes'
import type { DisputeEvidence } from '../coherence/types'
import type { AgentOperation } from './types'

type DisputeInput = { itemId: string; reason: string; evidence: DisputeEvidence }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

/**
 * `dispute_coherence_item`: the maker's reason and evidence for an item, kept in the metadata of the
 * node the item is about, one record per issue with the measurement it was made on. Nothing on a
 * node's schema changes. The item stands as disputed while that measurement holds.
 */
export const disputeCoherenceItem: AgentOperation<DisputeInput> = (nodes, input) => {
  const reason = input.reason.trim()
  const detail = input.evidence.detail.trim()
  if (!reason) refuse('reason_required', 'Say why the item stands, in a sentence.')
  if (!detail)
    refuse('evidence_required', 'Say what shows it: a measurement you took, or what a view showed.')

  const issues = checkCoherence(nodes)
  const members = issues.filter((issue) => issue.group === input.itemId)
  if (!members.length) {
    const itemIds = [...new Set(issues.map((issue) => issue.group))]
    refuse(
      'item_not_found',
      itemIds.length
        ? `There is no coherence item ${input.itemId}. The items are: ${itemIds.join(', ')}.`
        : `There is no coherence item ${input.itemId}: the checklist is empty.`,
      { itemIds },
    )
  }
  const carrier = nodes[members[0]!.carrierId]!
  const statement = { reason, evidence: { kind: input.evidence.kind, detail } }
  const metadata = (carrier.metadata ?? {}) as Record<string, unknown>
  const coherence = isRecord(metadata.coherence) ? metadata.coherence : {}
  const disputes = isRecord(coherence.disputes) ? coherence.disputes : {}
  return {
    result: {
      ok: true,
      itemId: input.itemId,
      status: 'disputed',
      disputedIssues: members.length,
      message: `Recorded on ${carrier.id}. ${input.itemId} stays out of the open list until a write changes its measurement.`,
    },
    changes: {
      update: [
        {
          id: carrier.id,
          data: {
            metadata: {
              ...metadata,
              coherence: {
                ...coherence,
                disputes: {
                  ...disputes,
                  ...Object.fromEntries(
                    members.map((issue) => [issue.id, disputeRecord(issue, statement)]),
                  ),
                },
              },
            },
          },
        },
      ],
    },
  }
}
