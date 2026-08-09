'use client'

import { STRIKE_TARGET_LABELS, STRIKING_STANDARD_LABELS } from '@pascal-app/core/formwork'
import { ActionButton, downloadText, PanelSection } from '@pascal-app/editor'
import { Download } from 'lucide-react'
import { useState } from 'react'
import { Note, Readout, Section, WarningLine } from './report-ui'
import { projectFormworkCaveats } from './solve-project'
import { takeoffCsv, useProjectFormwork, useTakeoffLevels } from './takeoff'

/**
 * What the job needs, and the file to order it with.
 *
 * The scope this panel exists for is the one nothing else in the editor could
 * answer: every formwork readout before it was per element, and a wall's bill is
 * not what a yard delivers against. A floor is. Two bills of the same panels for
 * two walls on one level cannot be added together afterwards — the same panel type
 * is one line on a delivery note — so the aggregation has to happen before the
 * numbers are shown, not in the reader's head.
 *
 * A host panel rather than an inspector for the same reason the settings are: the
 * project is not a node anybody can click. The level selector is here rather than
 * following the viewport's active level because a takeoff is a document about a
 * scope somebody chose, and one that silently changed scope when the camera moved
 * would be a document nobody could reproduce.
 */

/**
 * A period in the unit it is read in.
 *
 * A vertical form comes off in 12 hours and props stay ten days, and "0.5 d" is a
 * figure a crew has to convert before it can act on it.
 */
function heldFor(hours: number): string {
  return hours < 24 ? `${hours.toFixed(hours < 10 ? 1 : 0)} h` : `${(hours / 24).toFixed(1)} d`
}

export function FormworkTakeoffPanel() {
  const levels = useTakeoffLevels()
  const [levelId, setLevelId] = useState<string | undefined>(undefined)
  // A level deleted while this panel is open would otherwise scope the takeoff to
  // nothing and read as a job with no formwork in it.
  const scopedLevel = levels.find((level) => level.id === levelId)
  const solution = useProjectFormwork({ levelId: scopedLevel?.id })
  const caveats = projectFormworkCaveats(solution)
  const subject = scopedLevel ? scopedLevel.label : 'Whole project'
  const supply = solution.supply
  // Keyed by the line object rather than by a composed string, because it is the same
  // object: `bomSupply` was handed `solution.bom` and returns entries pointing at it.
  const supplyByLine = new Map(supply?.lines.map((entry) => [entry.line, entry]))
  const hireByLine = new Map(solution.hire.lines.map((entry) => [entry.line, entry]))

  return (
    <div className="subtle-scrollbar flex h-full flex-col overflow-y-auto">
      <div className="px-3 py-3 text-muted-foreground text-xs leading-snug">
        One bill across every shuttered element in scope — what the job orders, not what any one
        wall needs. Elements with no shutter yet are not in it.
      </div>

      <PanelSection title="Scope">
        <div className="flex flex-col gap-0.5 px-1 pb-1 text-xs">
          <label className="flex items-center gap-2" htmlFor="formwork-takeoff-scope">
            <span className="min-w-0 flex-1 truncate text-muted-foreground">Covers</span>
            <select
              className="h-7 min-w-0 max-w-[60%] rounded-md border border-border/50 bg-[#232325] px-1.5 text-foreground outline-none"
              id="formwork-takeoff-scope"
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
            A level is the scope a pour is planned at — one week's formwork, one delivery, one
            return.
          </Note>
        </div>
      </PanelSection>

      <PanelSection title="Takeoff">
        {solution.elements.length === 0 ? (
          <div className="px-1 pb-1 text-[11px] text-muted-foreground">
            Nothing shuttered in this scope. Choose a system on a wall, column or slab and generate
            its formwork, and it appears here.
          </div>
        ) : (
          <div className="space-y-2 px-1 pb-1">
            {/* Caveats first and before the numbers, because each of them makes every
                figure below it wrong in a way the figures themselves cannot show. */}
            {caveats.map((caveat) => (
              <WarningLine key={caveat} message={caveat} />
            ))}
            <Section title="Scope">
              <Readout
                label="Elements"
                value={String(solution.elements.length)}
                value2={
                  solution.incomplete.length > 0 ? `${solution.incomplete.length} short` : undefined
                }
              />
              <Readout label="Pours" value={String(solution.shutterCount)} />
              <Readout label="Order lines" value={String(solution.bom.length)} />
              <Readout
                label="Total weight"
                value={`${solution.totalWeightKg.toFixed(0)} kg`}
                value2={solution.totalWeightComplete ? undefined : 'part of the set'}
              />
            </Section>
            {supply === undefined ? (
              <Note>
                No owned stock recorded, so this bill says nothing about what is hired. Enter what
                the yard owns in the project's formwork settings and every line splits.
              </Note>
            ) : (
              <Section title="Supply">
                <Readout label="From own stock" value={String(supply.ownedQuantity)} />
                <Readout
                  label="To hire"
                  value={String(supply.hiredQuantity)}
                  value2={
                    supply.hiredWeightKg === undefined
                      ? undefined
                      : `${supply.hiredWeightKg.toFixed(0)} kg held`
                  }
                />
                <Readout label="Consumed" value={String(supply.consumedQuantity)} />
                {supply.hiredModifiedQuantity > 0 && (
                  <Readout
                    label="Hired, altered here"
                    value={String(supply.hiredModifiedQuantity)}
                    value2="recharged at list"
                  />
                )}
                {supply.unusedOwnedIds.length > 0 && (
                  <Note>Owned and not used in this scope: {supply.unusedOwnedIds.join(', ')}.</Note>
                )}
              </Section>
            )}
            <Section title="Held for">
              {solution.hire.periods.map((period) => (
                <Readout
                  key={period.target}
                  label={STRIKE_TARGET_LABELS[period.target]}
                  value={heldFor(period.hours)}
                  value2={period.basis === 'calendar' ? undefined : 'above 10 °C'}
                />
              ))}
              <Note>
                {STRIKING_STANDARD_LABELS[solution.hire.standard]}. The set is tied up for the
                longest of these, not their sum — the props holding one slab do not shorten the
                props holding the next.
              </Note>
              {/* An assumption is not a caveat: the tables publish their own conservative
                  column, so there is always an answer. What the reader needs is which
                  figures the job chose and which the code chose for it. */}
              {solution.hire.assumed.map((assumption) => (
                <Note key={assumption.kind}>{assumption.message}</Note>
              ))}
            </Section>
            <Section
              title={`${solution.bom.length} ${solution.bom.length === 1 ? 'line' : 'lines'}`}
            >
              {solution.bom.map((line) => {
                const split = supplyByLine.get(line)
                const held = hireByLine.get(line)
                return (
                  <div
                    className="space-y-0.5 border-border/30 border-t pt-1 first:border-t-0 first:pt-0"
                    key={`${line.kind}-${line.catalogId ?? ''}-${line.description}-${line.provenance}`}
                  >
                    <div className="flex items-baseline justify-between gap-2 text-[11px]">
                      <span className="min-w-0 flex-1 truncate text-foreground/90">
                        {line.description}
                      </span>
                      <span className="shrink-0 font-mono text-foreground">
                        {line.quantity}
                        {line.unit === 'no' ? '' : ` ${line.unit}`}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between gap-2 text-[10px] text-muted-foreground">
                      <span className="min-w-0 flex-1 truncate">
                        {line.catalogId ?? 'made on site'}
                        {line.provenance === 'standard' ? '' : ` · ${line.provenance}`}
                      </span>
                      <span className="shrink-0 font-mono">
                        {line.totalWeightKg === undefined
                          ? 'weight not stated'
                          : `${line.totalWeightKg.toFixed(0)} kg`}
                      </span>
                    </div>
                    {/* Only where the line is actually split. "26 · own 26 · hire 0" is
                        noise on every line of a job that owns everything, and it is the
                        exceptions a buyer is reading this list for. */}
                    {split !== undefined && split.hiredQuantity > 0 && (
                      <div className="text-[10px] text-muted-foreground">
                        {split.ownedQuantity > 0 && `${split.ownedQuantity} off own stock · `}
                        hire {split.hiredQuantity}
                        {split.hiredModifiedQuantity > 0 && ', altered here'}
                      </div>
                    )}
                    {held?.hours !== undefined && (
                      <div className="text-[10px] text-muted-foreground">
                        held {heldFor(held.hours)}
                        {held.mixed === undefined
                          ? ''
                          : ' · mixed with a shorter period, longest shown'}
                      </div>
                    )}
                  </div>
                )
              })}
            </Section>
          </div>
        )}
      </PanelSection>

      {solution.bom.length > 0 && (
        <div className="space-y-1.5 p-3">
          <ActionButton
            icon={<Download className="h-3.5 w-3.5" />}
            label="Download CSV"
            onClick={() => {
              const { filename, text } = takeoffCsv(solution, subject)
              downloadText(text, filename)
            }}
          />
          <Note>
            Quantities, weights and the marks behind each line, plus any warning above — the file
            carries its own caveats, because it is what gets emailed on.
          </Note>
        </div>
      )}
    </div>
  )
}

export default FormworkTakeoffPanel
