'use client'

import {
  COMMITMENT_GAP_LABELS,
  COST_GAP_LABELS,
  CUT_GAP_LABELS,
  formatMoney,
  LABOUR_GAP_LABELS,
  LOGISTICS_GAP_LABELS,
  PART_KIND_LABELS,
  PRECEDENCE_REASON_LABELS,
  RESEQUENCE_REFUSAL_LABELS,
  SCHEDULE_GAP_LABELS,
  SEQUENCE_GAP_LABELS,
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

/**
 * What the cost total is not, off the sections this panel actually shows.
 *
 * The same sentence `bom-csv.ts` builds, and built rather than written for its reason: a
 * fixed line naming labour, transport, craneage and finance tells a reader with a Logistics
 * section below that transport is missing from a takeoff that prices it.
 */
function costBasis(hasLabour: boolean, hasLogistics: boolean): string {
  const elsewhere: string[] = []
  const absent: string[] = []
  if (hasLabour) elsewhere.push('the gang’s time')
  else absent.push('labour')
  if (hasLogistics) elsewhere.push('the deliveries and the hook time')
  else absent.push('transport', 'craneage')
  absent.push('finance')
  const missing =
    absent.length === 1
      ? absent[0]
      : `${absent.slice(0, -1).join(', ')} or ${absent[absent.length - 1]}`
  const head = `Formwork held only. No ${missing}`
  if (elsewhere.length === 0) return `${head} — and labour is normally the largest of those.`
  return `${head} — and ${elsewhere.join(' and ')} ${elsewhere.length === 1 ? 'is a section' : 'are sections'} below rather than part of this total.`
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
  const labour = solution.labour
  const schedule = solution.schedule
  const occupancy = schedule === undefined ? undefined : scheduleOccupancyDays(schedule)
  const sets = solution.sets
  const acquisition = solution.acquisition
  const sequence = solution.sequence
  const resequence = solution.resequence
  const commitments = solution.commitments
  const lifts = solution.lifts
  const logistics = solution.logistics
  const cutList = solution.cutList
  // The bill rather than the parts, so a steel-panel job is owed no sentence about sheets: the
  // absent case below is only worth showing where there are boards nobody has stated a sheet for.
  const hasCutPly = solution.bom.some((line) => line.kind === 'ply-piece')
  // The programme rows below have to read differently for a booked pour than for a dated one,
  // and a drifted one differently again — a date on screen that a hire desk is holding a
  // different version of is the one state in this panel a reader cannot infer from anything.
  const booked = new Set(commitments?.committedPourIds ?? [])
  const driftByPour = new Map((commitments?.drifts ?? []).map((drift) => [drift.pourId, drift]))

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
            {/* Directly under the total weight, because that is the figure this section exists to
                be distinguished from: the total is what passes through the job and a pick is one
                hook load. Anywhere further down the panel a reader sizes a crane off the total. */}
            {lifts !== undefined && (
              <Section title="Lifting">
                <Readout
                  label="Picks"
                  value={String(lifts.pickCount)}
                  value2={
                    lifts.unweighedPicks > 0 ? `${lifts.unweighedPicks} unweighed` : undefined
                  }
                />
                {lifts.heaviestPickKg !== undefined && (
                  <Readout
                    label="Heaviest pick"
                    value={`${lifts.heaviestPickKg.toFixed(0)} kg`}
                    value2="the crane is sized on this"
                    warn={lifts.overChartPicks > 0}
                  />
                )}
                {lifts.crane !== undefined && (
                  <Readout
                    label="Chart"
                    value={`${lifts.crane.worstCapacityKg} kg at ${lifts.crane.reachToM} m`}
                    value2={`${lifts.crane.bestCapacityKg} kg near the mast`}
                  />
                )}
                {/* The three heaviest rather than every pick. A ganged floor is forty picks and
                    the panel is not the lifting plan — the CSV carries all of them, and the ones
                    that decide the crane are at the top of the same sorted list. */}
                {lifts.picks.slice(0, 3).map((pick) => (
                  <div
                    className="flex items-baseline justify-between gap-2 border-border/30 border-t pt-1 text-[10px]"
                    key={`${pick.elementId}-${pick.faceNumber}-${pick.gangNumber}`}
                  >
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">
                      {pick.elementId} face {pick.faceNumber} gang {pick.gangNumber}
                    </span>
                    <span className="shrink-0 font-mono text-muted-foreground">
                      {pick.pickWeightKg === undefined
                        ? 'weight not stated'
                        : `${pick.pickWeightKg.toFixed(0)} kg`}
                      {pick.liftsInsideM === undefined ? '' : ` · inside ${pick.liftsInsideM} m`}
                    </span>
                  </div>
                ))}
                {/* Over the chart is a WarningLine and a position is a Note, which is the
                    validator's own split of the same three verdicts: one is a layout to redo and
                    the other is where the crane stands, and nothing here knows that. */}
                {lifts.overChartPicks > 0 && (
                  <WarningLine
                    message={`${lifts.overChartPicks} ${lifts.overChartPicks === 1 ? 'pick is' : 'picks are'} over the chart everywhere — no radius on this jib lifts ${lifts.overChartPicks === 1 ? 'it' : 'them'}. Re-lay the face with narrower panels for more joints, or hand-set it.`}
                  />
                )}
                {lifts.overHookHeightPicks > 0 && (
                  <WarningLine
                    message={`${lifts.overHookHeightPicks} ${lifts.overHookHeightPicks === 1 ? 'pick wants' : 'picks want'} more height between the gang and the hook than the crane has. A lifting beam brings the sling legs vertical and removes the demand; a flatter sling does not.`}
                  />
                )}
                {lifts.positionPicks > 0 && (
                  <Note>
                    {lifts.positionPicks} {lifts.positionPicks === 1 ? 'pick lifts' : 'picks lift'}{' '}
                    nearer the mast but not at the jib tip. Nothing here says where the crane
                    stands, so they are measured against the chart's worst figure — a position for
                    the lifting plan rather than a layout to redo.
                  </Note>
                )}
                {lifts.crane === undefined && (
                  <Note>
                    No load chart recorded, so no pick has been checked against a lift and each face
                    is one gang — what the layout allows rather than what the site can lift. Record
                    capacity against radius in the project's formwork settings and the faces divide
                    at the joints already in them.
                  </Note>
                )}
                <Note>
                  Panels and make-up pieces only. Walers, ties, couplers and any working platform
                  travel with a ganged face, so the hook load is above these figures — on a
                  steel-framed gang the steelwork is about a fifth of it. Picks happen one at a time
                  and are never summed.
                </Note>
              </Section>
            )}
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
                <Note>{costBasis(labour !== undefined, logistics !== undefined)}</Note>
              </Section>
            )}
            {labour === undefined ? (
              <Note>
                No output norms recorded, so this takeoff carries no labour — which is the largest
                thing missing from the money above. Nothing is assumed for it: the published
                constants are per m² of a whole trade operation and cannot be spread over a bill of
                parts, and an output is a fact about a gang rather than about a product. Enter
                man-hours to erect and to strike per kind of part in the project's formwork
                settings.
              </Note>
            ) : (
              <Section title="Labour">
                <Readout label="Erect" value={`${labour.erectHours.toFixed(1)} h`} />
                <Readout label="Strike" value={`${labour.strikeHours.toFixed(1)} h`} />
                <Readout
                  label={labour.complete ? 'Man-hours' : 'Man-hours so far'}
                  value={`${labour.totalHours.toFixed(1)} h`}
                  value2={labour.complete ? undefined : 'a floor, not the work in the job'}
                />
                {labour.cost !== undefined && (
                  <Readout
                    label="At the gang rate"
                    value={formatMoney(labour.cost, labour.currency)}
                    value2="not in the cost total"
                  />
                )}
                {/* Per kind rather than per line, because that is how a norm is stated and it is
                    the readout that says where the time goes: a bill has two hundred lines and a
                    gang has five operations. */}
                {labour.byKind.map((kind) => (
                  <Readout
                    key={kind.kind}
                    label={PART_KIND_LABELS[kind.kind]}
                    value={`${kind.totalHours.toFixed(1)} h`}
                    value2={`${kind.fittings} fitted`}
                  />
                ))}
                {labour.unnormedFittings > 0 && (
                  <Note>
                    {labour.unnormedFittings} fittings carry no norm at all (
                    {labour.unnormedKinds.map((kind) => PART_KIND_LABELS[kind]).join(', ')}), so the
                    hours above are short by every one of them.
                  </Note>
                )}
                {labour.gaps
                  .filter((gap) => gap !== 'no-norm')
                  .map((gap) => (
                    <Note key={gap}>{LABOUR_GAP_LABELS[gap]}.</Note>
                  ))}
                <Note>
                  Man-hours, not a duration: nothing here knows the gang size. Erecting and striking
                  only — no cleaning, no moving the set between pours, no setting out, no waiting on
                  concrete, and no learning curve on the first use of a system.
                </Note>
              </Section>
            )}
            {logistics === undefined ? (
              cost !== undefined && (
                <Note>
                  No lorry payload and no cycle time recorded, so this takeoff carries no transport
                  and no craneage — the other two things the money above leaves out. Both are facts
                  about this job's own plant rather than about a product, so neither is assumed:
                  enter what one lorry carries and how long one pick takes, sling to hook back, in
                  the project's formwork settings.
                </Note>
              )
            ) : (
              <Section title="Logistics">
                {logistics.totalLoads !== undefined && (
                  <Readout
                    label="Loads"
                    value={String(logistics.totalLoads)}
                    value2={`${logistics.outboundLoads} out, ${logistics.returnLoads} back`}
                  />
                )}
                {logistics.payloadKg !== undefined && logistics.weighedKg !== undefined && (
                  <Readout
                    label="At"
                    value={`${logistics.payloadKg} kg a lorry`}
                    value2={`over ${logistics.weighedKg.toFixed(0)} kg`}
                  />
                )}
                {logistics.transportCost !== undefined && (
                  <Readout
                    label="Transport"
                    value={formatMoney(logistics.transportCost, logistics.currency)}
                  />
                )}
                {logistics.craneHours !== undefined && (
                  <Readout
                    label="Hook time"
                    value={`${logistics.craneHours.toFixed(1)} h`}
                    value2={`${logistics.pickCount} picks`}
                  />
                )}
                {logistics.craneCost !== undefined && (
                  <Readout
                    label="Craneage"
                    value={formatMoney(logistics.craneCost, logistics.currency)}
                  />
                )}
                {logistics.totalCost !== undefined && (
                  <Readout
                    label={logistics.complete ? 'Logistics' : 'Logistics so far'}
                    value={formatMoney(logistics.totalCost, logistics.currency)}
                    value2="not in the cost total"
                  />
                )}
                {logistics.gaps.map((gap) => (
                  <Note key={gap}>{LOGISTICS_GAP_LABELS[gap]}.</Note>
                ))}
                <Note>
                  The fewest trips a job of this weight takes, not a delivery schedule — a set that
                  goes back to the yard between two pours travels again, and nothing here knows
                  whether it stays on site. The hook time is this formwork's cycles alone, and it is
                  a charge only where the crane is hired by the hour: a tower crane over the pour is
                  a preliminary charged by the week whether it lifts this or not.
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
                {scheduleInPourOrder(schedule).map((pour) => {
                  const drift = driftByPour.get(pour.id)
                  return (
                    <div
                      className="flex items-baseline justify-between gap-2 border-border/30 border-t pt-1 text-[10px]"
                      key={pour.id}
                    >
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">
                        {pour.id}
                        {/* On the pour rather than in a section of its own, because this is where
                            a reader looks up a date and it is the date's own status. */}
                        {booked.has(pour.id) && (
                          <span className="text-foreground/70"> · booked</span>
                        )}
                      </span>
                      <span
                        className={
                          drift === undefined
                            ? 'shrink-0 font-mono text-muted-foreground'
                            : 'shrink-0 font-mono text-amber-400/90'
                        }
                      >
                        {drift === undefined
                          ? pour.pourAt === undefined
                            ? 'not dated'
                            : `${pour.pourAt} → ${pour.strikeAt ?? 'not struck'}`
                          : `booked ${drift.committedAt}${
                              drift.driftDays === undefined
                                ? ', now undated'
                                : `, ${Math.abs(drift.driftDays)} d ${drift.driftDays < 0 ? 'earlier' : 'later'}`
                            }`}
                      </span>
                    </div>
                  )
                })}
                {schedule.gaps.map((gap) => (
                  <Note key={gap}>{SCHEDULE_GAP_LABELS[gap]}.</Note>
                ))}
              </Section>
            )}
            {/* Directly under the programme, because it is the same dates read a second way:
                above is when each pour is, here is how much of that is a choice. Nothing is
                derived — the bounds are the neighbours' own stated dates. */}
            {sequence !== undefined && sequence.pours.length > 0 && (
              <Section title="What waits on what">
                <Readout
                  label="Pinned"
                  value={String(sequence.pinned.length)}
                  value2={
                    sequence.pinned.length === 0 ? 'every pour can move' : 'cannot move a day'
                  }
                />
                {sequence.unsequenced.length > 0 && (
                  <Readout
                    label="Unsequenced"
                    value={String(sequence.unsequenced.length)}
                    value2="nothing orders them"
                  />
                )}
                {sequence.pours.map((pour) => (
                  <div
                    className="flex items-baseline justify-between gap-2 border-border/30 border-t pt-1 text-[10px]"
                    key={pour.id}
                  >
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">
                      {pour.monolithic ? `${pour.id} (${pour.members.length} together)` : pour.id}
                    </span>
                    <span className="shrink-0 font-mono text-muted-foreground">
                      {/* A committed pour's allowance is real and unspendable, so the allowance
                          is not printed at all here: a "+7 d" beside a booked pour is an
                          invitation, and the float is what the proposals below already exclude
                          it from acting on. */}
                      {pour.members.some((member) => booked.has(member))
                        ? 'booked — not ours to move'
                        : pour.totalFloat === undefined
                          ? 'no allowance stated'
                          : pour.totalFloat < 0
                            ? `${-pour.totalFloat} d late already`
                            : pour.totalFloat === 0
                              ? 'pinned'
                              : `−${pour.moveEarlierDays ?? 0} / +${pour.moveLaterDays ?? 0} d`}
                    </span>
                  </div>
                ))}
                {/* The reasons rather than the edges. A panel this narrow cannot hold 39 rows
                    of "a → b", and what a reader argues with is the reason, which repeats. */}
                {[...new Set(sequence.edges.map((edge) => edge.reason))].map((reason) => (
                  <Note key={reason}>{PRECEDENCE_REASON_LABELS[reason]}.</Note>
                ))}
                {sequence.conflicts.map((conflict) => (
                  <WarningLine
                    key={`${conflict.edge.from}-${conflict.edge.to}`}
                    message={conflict.message}
                  />
                ))}
                {sequence.gaps.map((gap) => (
                  <Note key={gap}>{SEQUENCE_GAP_LABELS[gap]}.</Note>
                ))}
                <Note>
                  Not a critical path, and not slack a gang can spend: each allowance is measured
                  against the neighbours' stated dates, so two pours with a week each do not have
                  two weeks between them. Move one, then read this again.
                </Note>
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
            {/* After the shortfall it is an alternative to, because that is the order the
                decision is made in: a reader who has just seen "40 short by the 9th" is about
                to raise an order, and the cheapest answer is often that nothing is short on any
                other day. A refusal is shown as loudly as a move — "this one has to be bought"
                is the answer, not a missing row. */}
            {resequence !== undefined && resequence.answers.length > 0 && (
              <Section title="Move instead of buying">
                {resequence.answers.map((answer) => (
                  <div
                    className="space-y-0.5 border-border/30 border-t pt-1"
                    key={answer.catalogId}
                  >
                    <div className="flex items-baseline justify-between gap-2 text-[11px]">
                      <span className="min-w-0 flex-1 truncate text-foreground/90">
                        {answer.description}
                      </span>
                      <span className="shrink-0 font-mono text-muted-foreground">
                        {answer.shortfall} short by {answer.peakOn}
                      </span>
                    </div>
                    {answer.refusal === undefined ? (
                      answer.moves.map((move) => (
                        <div className="text-[10px] text-muted-foreground" key={move.pourId}>
                          {move.days > 0 ? 'Push' : 'Pull'} {move.pourId} {Math.abs(move.days)} d to{' '}
                          {move.toDate}: peak {move.peakBefore} → {move.peakAfter}
                          {move.clearsShortage
                            ? ', nothing short'
                            : `, still ${move.shortfallAfter} short`}
                          {move.raises.length === 0
                            ? ''
                            : ` · costs ${move.raises.map((rise) => `${rise.description} ${rise.from} → ${rise.to}`).join(', ')}`}
                        </div>
                      ))
                    ) : (
                      <div className="text-[10px] text-muted-foreground">
                        {/* "No move helps" is the wrong sentence for a booked overlap: nothing was
                            tried, because there was nothing anybody here is free to try. */}
                        {answer.refusal === 'overlap-committed'
                          ? 'No move to offer: '
                          : 'No move helps: '}
                        {RESEQUENCE_REFUSAL_LABELS[answer.refusal]}.
                      </div>
                    )}
                    {answer.refusal !== 'overlap-committed' &&
                      answer.committedPourIds.length > 0 && (
                        <div className="text-[10px] text-muted-foreground">
                          Booked and left out: {answer.committedPourIds.join(', ')}. They still hold
                          their plant, so the peak includes them.
                        </div>
                      )}
                  </div>
                ))}
                <Note>
                  A proposal, not a plan. This knows about formwork precedence and nothing else — no
                  gang, no crane, no concrete supply — and the moves cannot be taken together,
                  because each was measured against the other pours' stated dates.
                </Note>
              </Section>
            )}
            {/* Last of the programme sections, and after the proposals rather than beside the peak
                it will be compared against — every figure above is what the job needs, and this is
                the smaller number somebody has actually agreed to. Put beside the peak, a reader
                takes the difference for a shortfall. */}
            {commitments !== undefined && (
              <Section title="Committed">
                <Readout
                  label="Pours booked"
                  value={`${commitments.committedPours} of ${commitments.totalPours}`}
                  value2={
                    commitments.committedPours === commitments.totalPours
                      ? 'the whole programme'
                      : 'the rest can still move'
                  }
                />
                {commitments.firstCommittedDay !== undefined && (
                  <Readout
                    label="Spoken for"
                    value={`${commitments.firstCommittedDay} → ${commitments.lastCommittedDay ?? '—'}`}
                  />
                )}
                {commitments.kinds.map((kind) => (
                  <Readout
                    key={kind.kind}
                    label={kind.label}
                    value={String(kind.committedQuantity)}
                    value2="booked"
                  />
                ))}
                {commitments.windows.map((window) => (
                  <div
                    className="flex items-baseline justify-between gap-2 border-border/30 border-t pt-1 text-[10px]"
                    key={window.catalogId}
                  >
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">
                      {window.description}
                    </span>
                    <span className="shrink-0 font-mono text-muted-foreground">
                      {window.committedQuantity} · {window.from} → {window.to} ({window.days} d)
                    </span>
                  </div>
                ))}
                {/* A drift is a WarningLine rather than a Note: it is the one state in this panel
                    that costs money today, and the remedy is a phone call rather than an edit. */}
                {commitments.drifts.map((drift) => (
                  <WarningLine
                    key={drift.pourId}
                    message={
                      drift.pourAt === undefined
                        ? `${drift.pourId} is booked for ${drift.committedAt} and now carries no date at all, so the plant is reserved for a pour the programme no longer places.`
                        : `${drift.pourId} is booked for ${drift.committedAt} and now poured on ${drift.pourAt} — ${Math.abs(drift.driftDays ?? 0)} d ${(drift.driftDays ?? 0) < 0 ? 'earlier, so the pour is due before the plant is' : 'later, so a set arrives and stands idle at the booked rate'}. The hire desk is still holding the booked day.`
                    }
                  />
                ))}
                {commitments.gaps
                  .filter((gap) => gap !== 'drifted-off-booking')
                  .map((gap) => (
                    <Note key={gap}>{COMMITMENT_GAP_LABELS[gap]}.</Note>
                  ))}
                <Note>
                  What has been agreed, not what the job needs — swept over the committed pours
                  alone, so it is under the peak above wherever a pour is still uncommitted. A
                  commitment records that a date was agreed rather than that it cannot change: it
                  stops the proposals above offering to move the pour, and reports the drift if
                  somebody moves it anyway.
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
            {/* After the lines rather than above them, which is where the CSV puts it too. Every
                board in this nest is one of the ply lines listed above, so a sheet count read as
                part of the bill buys the job's plywood twice — and the only way to make that hard
                is to put the figure below the thing it is not part of. */}
            {cutList === undefined ? (
              hasCutPly && (
                <Note>
                  This job cuts ply, and no sheet size is recorded, so there is no cut list. A
                  sheathing grade is not a sheet: the grade carries the pressures it takes and no
                  width or length at all, and a merchant selling 1220 × 2440 and one selling 1250 ×
                  2500 give the same wall different sheet counts. Record the sheets the yard buys in
                  the project's formwork settings and the count follows.
                </Note>
              )
            ) : (
              <Section title="Cutting">
                {cutList.list.order.map((entry) => (
                  <Readout
                    key={entry.sheetId}
                    label={entry.sheetId}
                    value={`${entry.sheets} ${entry.sheets === 1 ? 'sheet' : 'sheets'}`}
                    value2="to buy"
                  />
                ))}
                {(cutList.list.orderWithAllowance ?? []).map((entry) => (
                  <Readout
                    key={entry.sheetId}
                    label="With handling allowance"
                    value={`${entry.sheets} ${entry.sheets === 1 ? 'sheet' : 'sheets'}`}
                    value2="booked in"
                  />
                ))}
                <Readout
                  label="Boards nested"
                  value={String(cutList.boardCount)}
                  value2={`${cutList.boardAreaM2} m²`}
                />
                <Readout
                  label="Cutting waste"
                  value={`${Math.round(cutList.list.cuttingWasteFraction * 100)}%`}
                  value2={`${cutList.list.kerfMm} mm kerf`}
                />
                {cutList.list.retainableAreaMm2 > 0 && (
                  <Readout
                    label="Worth racking"
                    value={`${(cutList.list.retainableAreaMm2 / 1_000_000).toFixed(2)} m²`}
                    value2="not deducted"
                  />
                )}
                {/* A board no sheet holds is a WarningLine rather than a Note: the sheets above
                        are not buying it, so the count is short by a board somebody has to source. */}
                {cutList.list.oversize.map((piece) => (
                  <WarningLine
                    key={piece.mark}
                    message={`${piece.mark} is ${piece.widthMm} × ${piece.heightMm} mm and larger than every stated sheet, so no sheet above is buying it. A formlining board spliced mid-span is a defect rather than a cut, so it is named instead of divided.`}
                  />
                ))}
                {cutList.unknownStockIds.map((id) => (
                  <WarningLine
                    key={id}
                    message={`${id} names no sheet in the catalog, so it is nesting nothing. A sheathing grade carries no width or length — only a sheet stock id has a size to nest against.`}
                  />
                ))}
                {cutList.list.gaps.map((gap) => (
                  <Note key={gap}>{CUT_GAP_LABELS[gap]}.</Note>
                ))}
                <Note>
                  What to buy, beside the bill rather than in it: the boards above are already
                  priced as consumed and weighed into the tonnage, so nothing here is in the cost,
                  the weight or the owned/hired split. Nested in one pass across the whole scope,
                  because a short board off one wall comes out of another's offcut — so this is not
                  a slice of a larger cut list, and two scopes' sheet counts do not add up. Nothing
                  is turned: every one of these is a form face and takes the pour against it, so a
                  board across the grain is a different product.
                </Note>
              </Section>
            )}
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
