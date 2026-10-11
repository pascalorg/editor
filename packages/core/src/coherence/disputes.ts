import { z } from 'zod'
import type { AnyNode } from '../schema'
import { COHERENCE_TOLERANCES } from './tolerances'
import type {
  CoherenceFamily,
  CoherenceIssue,
  CoherenceItem,
  DisputeEvidence,
  DisputeStatement,
} from './types'

type SceneNodes = Readonly<Record<string, AnyNode>>

/**
 * What a dispute is judged on, per family: how the parts meet, never where the building stands.
 * Lifting the whole building moves every height and changes no junction, so only differences count.
 */
const DISPUTE_KEYS: Record<CoherenceFamily, readonly string[]> = {
  enclosure: ['overUnderside', 'shortOfUnderside', 'aboveCovering', 'coveringRange'],
  support: ['gap', 'nothing', 'overhang', 'backspan'],
  hosting: ['margin'],
}

const figureOf = (issue: CoherenceIssue, key: string): number =>
  (issue.figures as Record<string, number>)[key] ?? Number.NaN

const Record_ = z.object({
  reason: z.string(),
  evidence: z.object({ kind: z.enum(['measurement', 'view']), detail: z.string() }),
  figures: z.record(z.string(), z.number()),
})

/** A dispute as it is kept in the carrier's metadata, one per issue id. */
export type DisputeRecord = z.infer<typeof Record_>

const round3 = (value: number) => Math.round(value * 1000) / 1000

/** The measurement an issue had when it was disputed. */
export function disputeFigures(issue: CoherenceIssue): Record<string, number> {
  return Object.fromEntries(
    DISPUTE_KEYS[issue.family].map((key) => [key, round3(figureOf(issue, key))]),
  )
}

export function disputeRecord(
  issue: CoherenceIssue,
  statement: { reason: string; evidence: DisputeEvidence },
): DisputeRecord {
  return { ...statement, figures: disputeFigures(issue) }
}

/** The disputes on a node, by issue id; anything in its metadata that is not one is ignored. */
export function readDisputes(node: AnyNode | undefined): Record<string, DisputeRecord> {
  const raw = (node?.metadata as { coherence?: { disputes?: unknown } } | undefined)?.coherence
    ?.disputes
  if (!raw || typeof raw !== 'object') return {}
  const disputes: Record<string, DisputeRecord> = {}
  for (const [id, entry] of Object.entries(raw)) {
    const parsed = Record_.safeParse(entry)
    if (parsed.success) disputes[id] = parsed.data
  }
  return disputes
}

const holds = (issue: CoherenceIssue, record: DisputeRecord) =>
  DISPUTE_KEYS[issue.family].every((key) => {
    const was = record.figures[key]
    return (
      was !== undefined && Math.abs(figureOf(issue, key) - was) <= COHERENCE_TOLERANCES.disputeDrift
    )
  })

export type DisputeState = { state: 'standing' | 'reopened'; statement: DisputeStatement }

/**
 * What the maker has said about each group of issues. A group stands disputed while every issue in
 * it has a dispute whose measurement still holds; once a write moves one, or a new issue joins,
 * the whole group is open again and carries what was said. A group nobody spoke for is absent.
 */
export function disputeStates(
  issues: readonly CoherenceIssue[],
  nodes: SceneNodes,
): Map<string, DisputeState> {
  const groups = new Map<string, CoherenceIssue[]>()
  for (const issue of issues) groups.set(issue.group, [...(groups.get(issue.group) ?? []), issue])
  const states = new Map<string, DisputeState>()
  for (const [group, members] of groups) {
    const records = readDisputes(nodes[members[0]!.carrierId])
    const spoken = members.filter((issue) => records[issue.id])
    if (!spoken.length) continue
    const { reason, evidence } = records[spoken[0]!.id]!
    states.set(group, {
      state:
        spoken.length === members.length &&
        members.every((issue) => holds(issue, records[issue.id]!))
          ? 'standing'
          : 'reopened',
      statement: { reason, evidence },
    })
  }
  return states
}

/** The issues nobody has a standing dispute for: what is still open. */
export function activeIssues(
  issues: readonly CoherenceIssue[],
  nodes: SceneNodes,
): CoherenceIssue[] {
  const states = disputeStates(issues, nodes)
  return issues.filter((issue) => states.get(issue.group)?.state !== 'standing')
}

/** An item as the maker's words leave it: disputed with the reason, or open again with it. */
export function withDispute(item: CoherenceItem, state: DisputeState | undefined): CoherenceItem {
  if (!state) return item
  return state.state === 'standing'
    ? { ...item, status: 'disputed', dispute: state.statement }
    : { ...item, reopened: state.statement }
}
