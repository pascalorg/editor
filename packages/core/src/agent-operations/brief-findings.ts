import { briefGaps } from './brief-gaps'
import { facadeRevision } from './design-facade'
import { formFinding, formRevision } from './design-form'
import { dressingRevision } from './room-dressing'
import type { SessionRecord } from './scene-checkpoint'
import type { SceneNodes } from './types'
import { CHECKPOINT_ORDER, registerSceneCheck } from './verify-scene'

/**
 * What the design brief in force says against the scene, for the one place each surface reads it:
 * the form the brief states, read back against the building (a finding where the scene is
 * plainer), a later brief of the turn that states the form, the facade or a room's dressing plainer
 * than the first (a revision), and what the brief leaves unstated while the turn built. None of
 * them refuses a write.
 */

export type BriefFinding = {
  code: string
  message: string
  /** Absent means warning, as a verify_scene issue's. */
  severity?: 'info' | 'warning'
}

/** Every code the brief's findings carry: how a reader picks them out of a verify_scene result or a program's diagnostics. */
export const BRIEF_FINDING_CODES: readonly string[] = [
  'form_simpler_than_brief',
  'form_revised_simpler',
  'facade_revised_simpler',
  'room_dressing_revised_simpler',
  'form_bounded_without_plan',
  'rooms_not_listed',
]

/** The scene against the brief: what a program's close reports, the revisions being the turn's and not the scene's. */
export function briefSceneFindings(
  brief: SessionRecord['designBrief'] | null | undefined,
  nodes: SceneNodes,
): BriefFinding[] {
  const form = formFinding(brief, nodes)
  return form ? [form] : []
}

/** The phase a program declares: what it is for, which says what of the brief it is too early to ask. */
export type BriefPhase = 'structure' | 'furnish' | 'finish' | 'edit'

/** How a reader reads the brief: `phase` is a program's own, which leaves out what the program is too early for (see `briefFindingsForPhase`). */
export type BriefReadOptions = { phase?: BriefPhase }

/** What a structure or furnish program can be asked of the brief: the form, a later brief's revision of it and of the facade, and what the brief leaves unstated. */
const FROM_STRUCTURE: ReadonlySet<string> = new Set([
  'form_simpler_than_brief',
  'form_revised_simpler',
  'facade_revised_simpler',
  'form_bounded_without_plan',
  'rooms_not_listed',
])

/**
 * The findings a program's close reports, by the program's own phase: a structure or furnish
 * program is asked of the form, the revisions and what the brief leaves unstated, a finish or edit
 * program (or one with no phase) of everything, the room dressing included. A program is not
 * asked, mid-build, for what it has not finished yet; the end of the turn is asked everything.
 */
export function briefFindingsForPhase(
  findings: readonly BriefFinding[],
  phase: BriefPhase | undefined,
): BriefFinding[] {
  return phase === 'structure' || phase === 'furnish'
    ? findings.filter((finding) => FROM_STRUCTURE.has(finding.code))
    : [...findings]
}

/** Where a later brief of the turn states a plainer form or facade than the first did. */
export function briefRevisions(
  session: Pick<SessionRecord, 'designBrief' | 'firstMassing' | 'firstTreatment' | 'firstDressing'>,
): BriefFinding[] {
  return [
    formRevision(session.firstMassing, session.designBrief),
    facadeRevision(session.firstTreatment, session.designBrief),
    dressingRevision(session.firstDressing, session.designBrief),
  ].filter((finding): finding is NonNullable<typeof finding> => finding !== null)
}

/** Everything the brief in force says of the scene and of the turn. */
export function briefFindings(
  session: Pick<
    SessionRecord,
    'designBrief' | 'firstMassing' | 'firstTreatment' | 'firstDressing' | 'made' | 'briefMadeAt'
  >,
  nodes: SceneNodes,
  options: BriefReadOptions = {},
): BriefFinding[] {
  return briefFindingsForPhase(
    [
      ...briefSceneFindings(session.designBrief, nodes),
      ...briefRevisions(session),
      ...briefGaps(session, nodes),
    ],
    options.phase,
  )
}

/**
 * verify_scene's copy of the brief's findings, as a check it runs after the checkpoint's comparison:
 * a warning each unless the finding says it informs.
 */
registerSceneCheck({
  name: 'brief findings',
  order: CHECKPOINT_ORDER,
  run: (nodes, _input, context) =>
    context.session
      ? briefFindings(context.session, nodes).map((finding) => ({
          type: finding.code,
          message: finding.message,
          severity: finding.severity ?? 'warning',
        }))
      : [],
})
