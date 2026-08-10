'use client'

import {
  COST_GAP_LABELS,
  formatMoney,
  SCHEDULE_GAP_LABELS,
  STRIKE_TARGET_LABELS,
  STRIKING_STANDARD_LABELS,
  scheduleInPourOrder,
  scheduleOccupancyDays,
} from '@pascal-app/core/formwork'
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
  const cost = solution.cost
  const costByLine = new Map(cost?.lines.map((entry) => [entry.line, entry]))
  const money = (value: number) => formatMoney(value, cost?.currency)
  const schedule = solution.schedule
  const occupancy = schedule === undefined ? undefined : scheduleOccupancyDays(schedule)
  const sets = solution.sets
  const acquisition = solution.acquisition

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
            {cost === undefined ? (
              <Note>
                No rates recorded, so this takeoff carries no money. A rate is the one input here
                that no code publishes and no product carries, so nothing is assumed for it — enter
                what the project pays per part in its formwork settings and every line prices.
              </Note>
            ) : (
              <Section title="Cost to hold">
                <Readout
                  label="Hire"
                  value={money(cost.hireCost)}
                  value2={
                    cost.linesAtMinimum.length > 0
                      ? `${cost.linesAtMinimum.length} at the minimum period`
                      : undefined
                  }
                />
                {cost.rechargeCost > 0 && (
                  <Readout
                    label="Recharges"
                    value={money(cost.rechargeCost)}
                    value2="altered hire, at list"
                  />
                )}
                {cost.consumedCost > 0 && (
                  <Readout label="Consumed" value={money(cost.consumedCost)} value2="bought" />
                )}
                <Readout
                  label={cost.complete ? 'Total' : 'Total so far'}
                  value={money(cost.totalCost)}
                  value2={cost.complete ? undefined : 'a floor, not a price'}
                />
                {/* Beside the total rather than inside it, and that is the whole claim: the
                    total is what this job spends, and the yard's own rack is not spent. Shown
                    at all because a rack priced at nothing makes owning formwork free, which
                    is what a reader concludes from a total that quietly leaves it out. */}
                {cost.ownedCost > 0 && (
                  <>
                    <Readout
                      label="Own stock"
                      value={money(cost.ownedCost)}
                      value2="not in the total"
                    />
                    <Note>
                      What the yard's own rack would earn over the days this job holds it, at the
                      project's own hire rate — an internal recharge rather than cash. Not
                      amortisation: there is no panel life here to spread a purchase over.
                    </Note>
                  </>
                )}
                {cost.ownedQuantityExcluded > 0 && (
                  <Note>
                    {cost.ownedQuantityExcluded} parts off the rack could not be charged at all — no
                    hire rate to charge them at, or nothing strikes them. Those are in this job at
                    nothing.
                  </Note>
                )}
                {cost.gaps.map((gap) => (
                  <Note key={gap}>{COST_GAP_LABELS[gap]}.</Note>
                ))}
                <Note>
                  Formwork held only. No labour, no transport, no finance — and labour is normally
                  the largest of those.
                </Note>
              </Section>
            )}
            {schedule === undefined ? (
              <Note>
                No pour is dated, so this takeoff carries no programme. A pour date is the one input
                here that cannot be derived from anything — deriving it from the order the shutters
                were built would be a programme nobody agreed to. Date a pour on its assembly and
                the delivery and strike dates follow from the periods above.
              </Note>
            ) : (
              <Section title="Programme">
                {schedule.firstErectAt !== undefined && (
                  <Readout label="Plant wanted" value={schedule.firstErectAt} value2="on site by" />
                )}
                <Readout
                  label="First pour"
                  value={schedule.firstPourAt ?? '—'}
                  value2={
                    schedule.firstPourAt === schedule.lastPourAt ? undefined : 'concrete goes in'
                  }
                />
                {schedule.lastPourAt !== schedule.firstPourAt && (
                  <Readout label="Last pour" value={schedule.lastPourAt ?? '—'} />
                )}
                {schedule.lastReleaseAt !== undefined && (
                  <Readout
                    label="Plant free"
                    value={schedule.lastReleaseAt}
                    value2="back to yard"
                  />
                )}
                {/* Arrival to release across every pour, and deliberately not the "held for"
                    figure above it: a set used on five pours a week apart is held two days
                    each time and on site for five weeks. Only this one is what is invoiced. */}
                {occupancy !== undefined && (
                  <Readout label="On site" value={`${occupancy} d`} value2="arrival to release" />
                )}
                {/* Keyed and labelled by the pour rather than only by its dates, because
                    "one of these is not dated" is not something a user can act on. */}
                {scheduleInPourOrder(schedule).map((pour) => (
                  <div
                    className="flex items-baseline justify-between gap-2 border-border/30 border-t pt-1 text-[10px]"
                    key={pour.id}
                  >
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">{pour.id}</span>
                    <span className="shrink-0 font-mono text-muted-foreground">
                      {pour.pourAt === undefined
                        ? 'not dated'
                        : `${pour.pourAt} → ${pour.strikeAt ?? 'not struck'}`}
                    </span>
                  </div>
                ))}
                {schedule.gaps.map((gap) => (
                  <Note key={gap}>{SCHEDULE_GAP_LABELS[gap]}.</Note>
                ))}
              </Section>
            )}
            {/* The order, and it is the last section because it is the one to act on: every
                figure above says what passes through the job and this says what to buy. Only
                where the programme can carry it — the refusal is a Note rather than an empty
                section, because a heading with nothing under it reads as a job that needs
                nothing at once. */}
            {sets === undefined
              ? schedule !== undefined && (
                  <Note>
                    No set count: {schedule.scheduledCount} of {schedule.pours.length} pours are
                    dated, which is too few to sweep. Counting sets over part of a programme reports
                    a peak the job never has, and it comes out low — so there is no figure rather
                    than a small one. Date the rest of the pours to get it.
                  </Note>
                )
              : sets.peaks.length > 0 && (
                  <Section title="Most needed at once">
                    <Note>
                      What to own or hire. The line quantities below are what passes through the
                      job; these stand at the same time.
                    </Note>
                    {sets.peakConcurrentOn !== undefined && (
                      <Readout
                        label="Pours at once"
                        value={String(sets.peakConcurrentPours)}
                        value2={`peak on ${sets.peakConcurrentOn}`}
                      />
                    )}
                    {sets.kinds.map((kind) => (
                      <Readout
                        key={kind.kind}
                        label={kind.label}
                        value={String(kind.peakQuantity)}
                        value2="to rack"
                      />
                    ))}
                    {/* Per catalog id under the per-kind rollup, because the rollup is what to
                        rack and this is what to order. The reuse figure is here to be read
                        against the peak — it is how hard the job works each set, and it is
                        deliberately not the buy-or-hire argument: see the section below. */}
                    {sets.peaks.map((peak) => (
                      <div
                        className="flex items-baseline justify-between gap-2 border-border/30 border-t pt-1 text-[10px]"
                        key={peak.catalogId}
                      >
                        <span className="min-w-0 flex-1 truncate text-muted-foreground">
                          {peak.description}
                        </span>
                        <span className="shrink-0 font-mono text-muted-foreground">
                          {peak.peakQuantity} × {peak.reuseFactor.toFixed(1)} uses
                        </span>
                      </div>
                    ))}
                    {sets.countedPours < sets.totalPours && (
                      <WarningLine
                        message={`${sets.totalPours - sets.countedPours} of ${sets.totalPours} pours are not in this sweep, so every figure here is a floor. An undated pour cannot reduce an overlap, so the real peak is this or higher.`}
                      />
                    )}
                    <Note>
                      A set is counted free from its release date, so back-to-back pours share one
                      set with no slack. A gang cannot strike, clean and refit the same day.
                    </Note>
                  </Section>
                )}
            {/* Last, because it is the only section that says what to *do*: everything above
                says what the job needs and this says what is missing from the rack. Absent
                until both the programme and the rack exist, and each absence gets its own
                sentence — a peak with nothing to compare it against is a rack nobody has
                recorded, which is a different fix from a programme nobody has dated. */}
            {acquisition === undefined
              ? sets !== undefined && (
                  <Note>
                    Nothing here says what to buy or hire: the peak above is what stands at once,
                    and no rack is recorded to compare it against. That is not a yard that owns
                    nothing — enter what it owns in the project's formwork settings and the
                    shortfall follows.
                  </Note>
                )
              : acquisition.lines.length > 0 && (
                  <Section title="To acquire">
                    <Readout
                      label="Short of the peak"
                      value={String(acquisition.shortfallQuantity)}
                      value2={
                        acquisition.shortfallQuantity === 0
                          ? 'the rack covers it'
                          : 'parts, across ids'
                      }
                    />
                    {acquisition.shortfallQuantity > 0 && acquisition.hireCost > 0 && (
                      <Readout
                        label="Hire vs buy"
                        value={`${money(acquisition.hireCost)} / ${money(acquisition.purchaseCost)}`}
                        value2={acquisition.complete ? undefined : 'both are floors'}
                      />
                    )}
                    {/* The payback beside the verdict, never the verdict alone: "hire" is the
                        answer on almost any single job, and the number is what a yard settles
                        against its own order book. */}
                    {acquisition.shortfalls.map((line) => (
                      <div
                        className="flex items-baseline justify-between gap-2 border-border/30 border-t pt-1 text-[10px]"
                        key={line.catalogId}
                      >
                        <span className="min-w-0 flex-1 truncate text-muted-foreground">
                          {line.description}
                        </span>
                        <span className="shrink-0 font-mono text-muted-foreground">
                          {line.shortfall} by {line.peakOn}
                          {line.paybackJobs === undefined
                            ? ''
                            : ` · ${line.verdict}, pays back over ${line.paybackJobs.toFixed(1)} jobs`}
                        </span>
                      </div>
                    ))}
                    {/* The list's own caveats are printed once at the top of the panel with
                        every other warning, so what belongs here is the one sentence that
                        stops the column above being misread. */}
                    <Note>
                      Short of the peak, not short of the bill — a job whose pours run in sequence
                      reuses its sets, so this is normally far under the hired quantity in the lines
                      below. Read the payback rather than the verdict: hire is cheaper than buying
                      on almost any single job, and the number is what a yard settles against its
                      own order book.
                    </Note>
                  </Section>
                )}
            <Section
              title={`${solution.bom.length} ${solution.bom.length === 1 ? 'line' : 'lines'}`}
            >
              {solution.bom.map((line) => {
                const split = supplyByLine.get(line)
                const held = hireByLine.get(line)
                const priced = costByLine.get(line)
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
                    {/* The charged period sits with the money rather than beside "held",
                        because where the two differ it is the minimum hire term that
                        explains the figure and not the strike time above it. */}
                    {priced !== undefined &&
                      (priced.totalCost !== undefined || priced.gaps.length > 0) && (
                        <div className="flex items-baseline justify-between gap-2 text-[10px] text-muted-foreground">
                          <span className="min-w-0 flex-1 truncate">
                            {[
                              ...(priced.atMinimumPeriod && priced.chargedDays !== undefined
                                ? [`charged ${priced.chargedDays.toFixed(0)} d, the minimum`]
                                : []),
                              ...priced.gaps.map((gap) => COST_GAP_LABELS[gap]),
                            ].join(' · ')}
                          </span>
                          <span className="shrink-0 font-mono">
                            {priced.totalCost === undefined
                              ? 'not priced'
                              : money(priced.totalCost)}
                          </span>
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
            Quantities, weights{cost === undefined ? '' : ', cost'} and the marks behind each line,
            plus any warning above — the file carries its own caveats, because it is what gets
            emailed on.
          </Note>
        </div>
      )}
    </div>
  )
}

export default FormworkTakeoffPanel
