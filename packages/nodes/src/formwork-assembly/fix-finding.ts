import type { Finding, FormworkRemedy, ValidationReport } from '@pascal-app/core/formwork'
import {
  findingByKey,
  findingKey,
  formworkRemedy,
  INVARIANT_LABELS,
  remedySummary,
} from '@pascal-app/core/formwork'
import type { AnyNodeId } from '@pascal-app/core/schema'

/**
 * Applying a remedy, and then checking that it worked.
 *
 * The second half is the point. `remedy.ts` says which call clears a finding and takes
 * the arguments from the check's own figures, and every cap it offers was verified
 * against the real splitter before it was offered — but a *scene* is not one element,
 * and the write lands in a scene. Capping a wall's lifts to move a joint off a window
 * changes how many pours the wall has, which changes its shutter count, its bill, and
 * possibly which other checks fire. So a fix reports what it achieved rather than that
 * it ran: the finding cleared, or it did not, or it cleared and something else appeared.
 *
 * That last case is why this is a module and not two calls a surface makes in order. A
 * fix that clears one error and raises two is a fix somebody wants to know about before
 * they move on, and no surface would notice it by reading a success flag.
 *
 * ## Why nothing here mutates
 *
 * It plans the write and reads the two reports; the caller applies. The three callers
 * apply differently — the panel through the store inside one history step, the chat
 * tools against a plain graph on the server, MCP through its bridge — which is the same
 * division `pour-patch.ts` draws one layer down, for the same reason: a shared write
 * would have to pick one of the three. What is shared is the decision and the verdict,
 * which are the parts that must not diverge.
 *
 * ## Why only `set_pour_limits` is applicable
 *
 * It is the only tool a `write` remedy ever names, because it is the only one whose
 * arguments are fully derivable. The other four writes each end in a field somebody has
 * to decide — a cast order, a pour id, a pressure standard, a crane — and a surface that
 * filled those in would be choosing the pour sequence on the user's behalf. So a plan
 * for anything else comes back as a refusal carrying the reason, rather than as a button
 * that does nothing.
 */

/** The three caps `set_pour_limits` writes. A remedy naming any other field is refused. */
const POUR_LIMIT_FIELDS = ['maxLiftHeight', 'maxPourLength', 'maxPourVolume'] as const

type PourLimitField = (typeof POUR_LIMIT_FIELDS)[number]

export interface FormworkFixPlan {
  /** The defect this is for, named the way both validations name it. */
  key: string
  label: string
  message: string
  remedy: FormworkRemedy
  /** The element to write to. Absent on a refusal. */
  elementId?: AnyNodeId
  /**
   * The caps to write, as `applyPourLimitsPatch` takes them.
   *
   * Passed through that function by the caller rather than written raw, so a fix and a
   * hand-made `set_pour_limits` go through one gate — the slab caveat included.
   */
  limits?: Partial<Record<PourLimitField, number>>
  /** True where the shutters have to be rebuilt after the write, or the cap builds nothing. */
  rebuild?: boolean
  /** Why this cannot be applied. Absent where it can. */
  refusal?: string
}

/**
 * The write that would clear `finding`, or the reason there is none.
 *
 * A refusal rather than a bare null, because the reasons are different conversations:
 * nothing in this feature fixes that defect, somebody has to decide one argument, or the
 * remedy names a call this path does not drive. A caller that could only see "no" would
 * phrase all of them as the same shrug.
 */
export function plannedFix(finding: Finding): FormworkFixPlan {
  const remedy = formworkRemedy(finding)
  const base = {
    key: findingKey(finding),
    label: INVARIANT_LABELS[finding.invariant] ?? (finding.invariant as string),
    message: finding.message,
    remedy,
  }
  if (remedy.kind === 'none') {
    return { ...base, refusal: `Nothing here fixes this. ${remedy.note}` }
  }
  if (remedy.kind === 'choice') {
    return {
      ...base,
      refusal: `This one needs a decision, not a call: ${remedy.field} on ${remedy.tool} is yours to choose. ${remedy.note}`,
    }
  }
  if (remedy.tool !== 'set_pour_limits') {
    return {
      ...base,
      refusal: `${remedy.tool} is not applied from here — make the call yourself. ${remedy.note}`,
    }
  }

  const elementId = remedy.args?.elementId
  const limits: Partial<Record<PourLimitField, number>> = {}
  for (const [field, value] of Object.entries(remedy.args ?? {})) {
    if (field === 'elementId') continue
    // A field outside the three is refused rather than dropped. Dropping it would apply
    // a fix that is not the one the check offered and then report the check as fixed
    // when the arithmetic behind it never ran.
    if (!(POUR_LIMIT_FIELDS as readonly string[]).includes(field) || typeof value !== 'number') {
      return {
        ...base,
        refusal: `The remedy names ${field}, which set_pour_limits does not write.`,
      }
    }
    limits[field as PourLimitField] = value
  }
  if (typeof elementId !== 'string' || Object.keys(limits).length === 0) {
    return {
      ...base,
      refusal: 'The remedy names no element and no cap, so there is nothing to apply.',
    }
  }

  return {
    ...base,
    elementId: elementId as AnyNodeId,
    limits,
    // Not a flag a caller may skip. A cap changes how many pours the element has and
    // builds nothing, so between the write and the rebuild the element is cast in more
    // pours than it is formed for and its takeoff is short by the difference — worse
    // than the finding was.
    ...(remedy.thenAttach ? { rebuild: true as const } : {}),
  }
}

export interface FormworkFixOutcome {
  cleared: boolean
  /** The finding, still there, where the fix did not work. */
  remaining?: Finding
  /** Both counts before and after, so a fix that traded one error for two shows. */
  before: { errorCount: number; warningCount: number }
  after: { errorCount: number; warningCount: number }
  /** Defects the fix introduced, keyed the same way — so these are genuinely new. */
  raised: Finding[]
  /** What to tell the user, in one sentence. */
  message: string
}

/**
 * Whether the defect `key` named is gone, and what else moved.
 *
 * Takes the two reports rather than the two scenes, so each caller validates through
 * the path it already uses and this never runs a solve of its own.
 *
 * `raised` is computed by key, so a finding whose figures moved is not counted as new —
 * the same reason `findingKey` holds no figures. A half-worked fix therefore reads as
 * the one defect it is rather than as one cleared and one raised.
 */
export function fixOutcome(
  before: ValidationReport,
  after: ValidationReport,
  key: string,
): FormworkFixOutcome {
  const remaining = findingByKey(after.findings, key)
  const known = new Set(before.findings.map(findingKey))
  const raised = after.findings.filter((finding) => !known.has(findingKey(finding)))
  const cleared = remaining === undefined

  const head = cleared
    ? 'Fixed — the check no longer fires.'
    : // Reported as unfixed rather than as done, because a remedy that leaves the defect
      // in place is the failure this path exists to catch: a plausible write, a plausible
      // reply, and the shutter still unbuildable.
      `Not fixed — the check still fires: ${remaining?.message}`
  const collateral =
    raised.length === 0
      ? ''
      : ` It raised ${raised.length} ${raised.length === 1 ? 'finding' : 'findings'} that were not there before: ${raised.map((finding) => finding.message).join(' ')}`

  return {
    cleared,
    ...(remaining ? { remaining } : {}),
    before: { errorCount: before.errorCount, warningCount: before.warningCount },
    after: { errorCount: after.errorCount, warningCount: after.warningCount },
    raised,
    message: `${head}${collateral}`,
  }
}

/**
 * Every finding with what to do about it — the read the panel prints and a model acts
 * on.
 *
 * One shape for all three surfaces, because a fix offered on screen and a fix described
 * to an agent have to be the same fix. Two derivations of "what clears this" diverge the
 * first time either changes, and a user told one thing by the panel and another by the
 * assistant has no way to tell which is right.
 */
export interface FormworkFindingWithRemedy {
  /** Pass this to a fix, and it is also what a second validation is compared on. */
  key: string
  invariant: string
  severity: Finding['severity']
  label: string
  elementIds: string[]
  message: string
  locus: Finding['locus'] | null
  /** The remedy as one sentence, in the words every surface uses. */
  remedy: string
  /** Whether a fix call can apply it, or why it cannot. */
  fixable: boolean
  refusal?: string
}

export function findingsWithRemedies(findings: readonly Finding[]): FormworkFindingWithRemedy[] {
  return findings.map((finding) => {
    const plan = plannedFix(finding)
    return {
      key: plan.key,
      invariant: finding.invariant as string,
      severity: finding.severity,
      label: plan.label,
      elementIds: finding.elementIds as string[],
      message: finding.message,
      locus: finding.locus ?? null,
      remedy: remedySummary(finding),
      fixable: plan.refusal === undefined,
      ...(plan.refusal ? { refusal: plan.refusal } : {}),
    }
  })
}

/**
 * The refusal for a key no report has.
 *
 * Its own sentence because the likeliest cause is not a typo: a key from an earlier
 * reply, whose defect a previous fix already cleared. So it names the re-read rather
 * than reporting a missing record, and it is shared so both AI surfaces say it once.
 */
export function noSuchFinding(key: string): string {
  return `Error: no current finding keyed ${key}. Call validate_formwork again and take the key from that reply — a fix applied since may already have cleared it.`
}
