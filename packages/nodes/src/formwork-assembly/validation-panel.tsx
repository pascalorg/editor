'use client'

import {
  type AnyNode,
  type AnyNodeId,
  runAsSingleSceneHistoryStep,
  useScene,
} from '@pascal-app/core'
import {
  applyPourLimitsPatch,
  type Finding,
  failingElementIds,
  INVARIANT_LABELS,
  type InvariantId,
  remedySummary,
  validationSummary,
} from '@pascal-app/core/formwork'
import { PanelSection } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useMemo, useState } from 'react'
import { buildSolverJointNodes } from '../construction-joint'
import { type CastableHostNode, reconcileFormworkNodes } from './attach'
import { formworkAssembliesOnHost } from './dirty-scope'
import { type FormworkFixOutcome, fixOutcome, plannedFix } from './fix-finding'
import { Note, Section } from './report-ui'
import type { FormworkAssemblyNode } from './schema'
import { useTakeoffLevels } from './takeoff'
import { validateProjectFormwork } from './validate-project'

/**
 * Whether the job can be built, on screen.
 *
 * The engine could already say a bill was for something nobody can erect and there
 * was nowhere in the product that said it. This is that surface. It sits beside the
 * takeoff and shares its scope selector, because the two answer one question in two
 * halves: what the level needs, and whether the level stands up.
 *
 * Three things about the shape are deliberate.
 *
 * Errors are separated from warnings rather than sorted among them, because they are
 * different conversations: an error is a thing the crew cannot do, a warning is an
 * exception somebody has to sign. A single list ordered by severity still reads as
 * one worklist, and the reader has to find the boundary themselves.
 *
 * Every finding selects. A validator naming `wall_3` in a project with forty walls
 * has told the reader almost nothing they can act on — the id is only useful as a
 * way of getting to the wall.
 *
 * And `notChecked` is shown, always. A report that lists only failures reads as a
 * clean bill of health for everything it never examined, which is the one way a
 * validation panel can be actively worse than no panel.
 *
 * ## The fix button, and why most findings do not get one
 *
 * Three of the twenty-one invariants have a fix whose every argument the check itself
 * supplies, and only those get a button. The rest print what would clear them instead:
 * seven end in an argument somebody has to decide — a cast order, a pour id, which
 * crane — and eleven cannot be cleared by any write this feature has at all. A button
 * on those would be a button that appears to work, which is worse than no button,
 * because the reader would take the check's silence afterwards as the defect having
 * gone.
 *
 * The button also does not report success. It applies the write, rebuilds the shutters
 * the new split needs, re-runs the whole suite and says whether *that* finding actually
 * cleared — and names anything the fix raised that was not there before. A cap that
 * moves a joint off one window and through the next is the failure mode here, and it
 * would read as a clean fix to anything that trusted the write.
 */

/** The findings, and what could not be looked at, for a scope. */
function useProjectValidation(levelId: string | undefined) {
  const nodes = useScene((s) => s.nodes)
  // On the level id rather than a scope object, for the reason `useProjectFormwork`
  // is: this solves every shutter in the scene, and a dependency that changes
  // identity per render re-validates the whole job on every keystroke elsewhere.
  return useMemo(
    () => validateProjectFormwork(nodes as Record<string, AnyNode>, { parentId: levelId }),
    [nodes, levelId],
  )
}

/**
 * Apply one finding's fix, rebuild what it re-split, and re-check.
 *
 * One history step over all of it, because the three writes are one decision: a Ctrl-Z
 * that took the cap and left the shutters would leave the element formed for a pour it
 * no longer has, which is a state the user never asked for and cannot see.
 *
 * The rebuild is not optional and not the user's next click. A cap changes how many
 * pours the element has and builds nothing, so an element left un-rebuilt is cast in
 * more pours than it is formed for and its takeoff is short by the difference — a
 * quieter fault than the finding that was just cleared.
 *
 * Then the whole suite runs again, from the store's own nodes rather than from the
 * `nodes` this render closed over. Re-validating is the entire point: the verdict is
 * whether the check stopped firing, and a fix reported from the arithmetic that
 * proposed it would only ever agree with itself.
 */
function useApplyFix(report: ReturnType<typeof useProjectValidation>['report'], levelId?: string) {
  return useCallback(
    (finding: Finding): FormworkFixOutcome | { refusal: string } => {
      const plan = plannedFix(finding)
      if (plan.refusal !== undefined || !plan.elementId || !plan.limits) {
        return { refusal: plan.refusal ?? 'Nothing to apply.' }
      }
      const elementId = plan.elementId as AnyNode['id']
      const host = useScene.getState().nodes[elementId] as CastableHostNode | undefined
      if (!host) return { refusal: 'That element is no longer in the scene.' }

      // Through the same gate a hand-made `set_pour_limits` goes through, so a cap the
      // patch would refuse is refused here too rather than written straight to the node.
      const patch = applyPourLimitsPatch(host.type, plan.limits)
      if (patch.error !== undefined) return { refusal: patch.error }

      runAsSingleSceneHistoryStep(useScene, () => {
        const scene = useScene.getState()
        scene.updateNode(elementId, patch.writes as Partial<AnyNode>)
        if (plan.rebuild !== true) return
        const after = useScene.getState()
        const updated = after.nodes[elementId] as CastableHostNode | undefined
        if (!updated) return
        const levelNodes = Object.values(after.nodes) as AnyNode[]
        const existing = formworkAssembliesOnHost(elementId as string, after.nodes)
          .map((id) => after.nodes[id] as unknown as FormworkAssemblyNode)
          .filter(Boolean)
        const { create, keep, orphan } = reconcileFormworkNodes(updated, existing, levelNodes)
        for (const assembly of create) after.createNode(assembly, elementId as AnyNodeId)
        for (const assembly of orphan) after.deleteNode(assembly.id as AnyNodeId)
        // The survivors were built against the old split, so their geometry is stale even
        // where their nodes are not: lift 0 of a wall that just gained a 3 m cap covers a
        // third of the height it did.
        for (const assembly of keep) after.markDirty(assembly.id as AnyNodeId)
        for (const joint of buildSolverJointNodes(updated, levelNodes)) {
          after.createNode(joint, (joint.parentId as AnyNodeId | null) ?? undefined)
        }
      })

      const recheck = validateProjectFormwork(
        useScene.getState().nodes as Record<string, AnyNode>,
        { parentId: levelId },
      )
      return fixOutcome(report, recheck.report, plan.key)
    },
    [levelId, report],
  )
}

function locus(finding: Finding): string | undefined {
  const parts: string[] = []
  if (finding.locus?.alongM !== undefined) parts.push(`${finding.locus.alongM.toFixed(2)} m along`)
  if (finding.locus?.elevationM !== undefined)
    parts.push(`${finding.locus.elevationM.toFixed(2)} m up`)
  if (finding.locus?.liftIndex !== undefined) parts.push(`lift ${finding.locus.liftIndex + 1}`)
  if (finding.locus?.segmentIndex !== undefined)
    parts.push(`segment ${finding.locus.segmentIndex + 1}`)
  return parts.length > 0 ? parts.join(' · ') : undefined
}

function FindingRow({
  finding,
  onFix,
  onSelect,
}: {
  finding: Finding
  onFix: (finding: Finding) => FormworkFixOutcome | { refusal: string }
  onSelect: () => void
}) {
  const where = locus(finding)
  const plan = plannedFix(finding)

  return (
    <div className="space-y-0.5 border-border/30 border-t pt-1 first:border-t-0 first:pt-0">
      <button
        className="w-full space-y-0.5 text-left hover:bg-white/[0.03]"
        onClick={onSelect}
        type="button"
      >
        <div className="flex items-baseline justify-between gap-2 text-[11px]">
          <span className="min-w-0 flex-1 text-foreground/90">
            {INVARIANT_LABELS[finding.invariant as InvariantId] ?? finding.invariant}
          </span>
          <span
            className={
              finding.severity === 'error'
                ? 'shrink-0 text-[10px] text-red-400'
                : 'shrink-0 text-[10px] text-amber-500'
            }
          >
            {finding.elementIds.length > 1 ? `${finding.elementIds.length} elements` : 'select'}
          </span>
        </div>
        <div className="text-[10px] text-muted-foreground leading-snug">{finding.message}</div>
        {where && <div className="font-mono text-[10px] text-muted-foreground/70">{where}</div>}
      </button>

      {/* What would clear it, on every finding and not only the fixable ones. A row that
          said nothing about the eighteen with no button would be a defect the reader has
          no next step for. */}
      <div className="text-[10px] text-muted-foreground/80 leading-snug">
        {remedySummary(finding)}
      </div>

      {plan.refusal === undefined && (
        <button
          className="rounded-md border border-border/50 px-1.5 py-0.5 text-[10px] text-foreground/80 hover:bg-accent/40"
          onClick={() => onFix(finding)}
          type="button"
        >
          {plan.rebuild === true ? 'Apply and rebuild the shutters' : 'Apply'}
        </button>
      )}
    </div>
  )
}

/**
 * What the last fix did, held at panel level rather than on the row.
 *
 * A fix that works removes its own row, and an outcome stored on the row would go with
 * it — so the one case worth reporting most, "that cleared it", would be the one case
 * that never appeared. Which is also why it survives a re-validate: the panel re-runs
 * the suite on every scene change, and a verdict tied to the render would be gone before
 * it was read.
 */
function FixOutcomeNote({ outcome }: { outcome: FormworkFixOutcome | { refusal: string } }) {
  const bad = 'refusal' in outcome || !outcome.cleared || outcome.raised.length > 0
  return (
    <div
      className={
        bad
          ? 'px-1 text-[10px] text-amber-500/90 leading-snug'
          : 'px-1 text-[10px] text-emerald-400/90 leading-snug'
      }
    >
      {'refusal' in outcome ? outcome.refusal : outcome.message}
    </div>
  )
}

export function FormworkValidationPanel() {
  const levels = useTakeoffLevels()
  const [levelId, setLevelId] = useState<string | undefined>(undefined)
  // A level deleted while the panel is open would otherwise scope to nothing and read
  // as a job with nothing wrong in it.
  const scopedLevel = levels.find((level) => level.id === levelId)
  const { report, shutteredIds } = useProjectValidation(scopedLevel?.id)
  const setSelection = useViewer((s) => s.setSelection)
  const applyFix = useApplyFix(report, scopedLevel?.id)
  const [outcome, setOutcome] = useState<FormworkFixOutcome | { refusal: string } | undefined>(
    undefined,
  )

  const errors = report.findings.filter((finding) => finding.severity === 'error')
  const warnings = report.findings.filter((finding) => finding.severity === 'warning')
  const select = (ids: AnyNodeId[]) => setSelection({ selectedIds: ids as AnyNode['id'][] })
  const fix = (finding: Finding) => {
    const result = applyFix(finding)
    setOutcome(result)
    return result
  }

  return (
    <div className="subtle-scrollbar flex h-full flex-col overflow-y-auto">
      <div className="px-3 py-3 text-muted-foreground text-xs leading-snug">
        Whether what the takeoff orders can be erected. Errors cannot be built as specified;
        warnings can, by an exception somebody accepts.
      </div>

      <PanelSection title="Scope">
        <div className="flex flex-col gap-0.5 px-1 pb-1 text-xs">
          <label className="flex items-center gap-2" htmlFor="formwork-validation-scope">
            <span className="min-w-0 flex-1 truncate text-muted-foreground">Covers</span>
            <select
              className="h-7 min-w-0 max-w-[60%] rounded-md border border-border/50 bg-[#232325] px-1.5 text-foreground outline-none"
              id="formwork-validation-scope"
              onChange={(event) => setLevelId(event.target.value || undefined)}
              value={scopedLevel?.id ?? ''}
            >
              <option value="">Whole project</option>
              {levels.map((level) => (
                <option key={level.id} value={level.id}>
                  {level.label}
                </option>
              ))}
            </select>
          </label>
          <Note>
            Neighbours outside the scope still count: a wall on the storey below buries the face of
            one above it, so the topology is read across the scene and only the findings are scoped.
          </Note>
        </div>
      </PanelSection>

      <PanelSection title="Findings">
        <div className="space-y-2 px-1 pb-1">
          {/* `validationSummary` leads with one sentence per severity present and then
              repeats every message; the messages are rendered per finding below, so only
              the leading sentences are taken. Verbatim, so the panel, the file and the
              model do not phrase one fault three ways. */}
          {validationSummary(report)
            .slice(0, (errors.length > 0 ? 1 : 0) + (warnings.length > 0 ? 1 : 0) || 1)
            .map((line) => (
              <div className="text-[11px] text-foreground/80 leading-snug" key={line}>
                {line}
              </div>
            ))}

          {outcome !== undefined && <FixOutcomeNote outcome={outcome} />}

          {errors.length > 0 && (
            <Section title={`${errors.length} cannot be built`}>
              {errors.map((finding) => (
                <FindingRow
                  finding={finding}
                  key={`${finding.invariant}-${finding.elementIds.join('-')}-${finding.message}`}
                  onFix={fix}
                  onSelect={() => select(finding.elementIds)}
                />
              ))}
            </Section>
          )}

          {warnings.length > 0 && (
            <Section
              title={`${warnings.length} ${warnings.length === 1 ? 'exception' : 'exceptions'} to accept`}
            >
              {warnings.map((finding) => (
                <FindingRow
                  finding={finding}
                  key={`${finding.invariant}-${finding.elementIds.join('-')}-${finding.message}`}
                  onFix={fix}
                  onSelect={() => select(finding.elementIds)}
                />
              ))}
            </Section>
          )}

          {errors.length > 0 && (
            <button
              className="w-full rounded-md border border-border/50 py-1 text-[11px] text-muted-foreground hover:text-foreground"
              onClick={() => select(failingElementIds(report))}
              type="button"
            >
              Select every failing element
            </button>
          )}
        </div>
      </PanelSection>

      {/* Last, and never omitted. What was not looked at is part of the result. */}
      <PanelSection title="Not checked">
        <div className="space-y-1 px-1 pb-1">
          <Note>
            {report.elementIds.length} in scope, {shutteredIds.length} shuttered. An element with no
            shutter has no layout to fault, so the layout and pressure checks skip it.
          </Note>
          {report.notChecked.map((entry) => (
            <div className="space-y-0.5" key={entry.invariant}>
              <div className="text-[11px] text-foreground/80">
                {INVARIANT_LABELS[entry.invariant as InvariantId] ?? entry.invariant}
              </div>
              <div className="text-[10px] text-muted-foreground/80 leading-snug">{entry.needs}</div>
            </div>
          ))}
        </div>
      </PanelSection>
    </div>
  )
}

export default FormworkValidationPanel
