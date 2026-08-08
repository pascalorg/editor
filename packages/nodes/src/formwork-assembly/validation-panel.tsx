'use client'

import { type AnyNode, type AnyNodeId, useScene } from '@pascal-app/core'
import {
  type Finding,
  failingElementIds,
  INVARIANT_LABELS,
  type InvariantId,
  validationSummary,
} from '@pascal-app/core/formwork'
import { PanelSection } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useMemo, useState } from 'react'
import { Note, Section } from './report-ui'
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

function FindingRow({ finding, onSelect }: { finding: Finding; onSelect: () => void }) {
  const where = locus(finding)
  return (
    <button
      className="w-full space-y-0.5 border-border/30 border-t pt-1 text-left first:border-t-0 first:pt-0 hover:bg-white/[0.03]"
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

  const errors = report.findings.filter((finding) => finding.severity === 'error')
  const warnings = report.findings.filter((finding) => finding.severity === 'warning')
  const select = (ids: AnyNodeId[]) => setSelection({ selectedIds: ids as AnyNode['id'][] })

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

          {errors.length > 0 && (
            <Section title={`${errors.length} cannot be built`}>
              {errors.map((finding) => (
                <FindingRow
                  finding={finding}
                  key={`${finding.invariant}-${finding.elementIds.join('-')}-${finding.message}`}
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
