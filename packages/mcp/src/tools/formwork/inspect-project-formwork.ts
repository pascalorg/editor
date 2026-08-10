import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  ACQUIRE_GAP_LABELS,
  COST_GAP_LABELS,
  SCHEDULE_GAP_LABELS,
  SET_COUNT_GAP_LABELS,
  scheduleInPourOrder,
  scheduleOccupancyDays,
} from '@pascal-app/core/formwork'
import {
  castableHostIds,
  projectFormworkCaveats,
  solveProjectFormwork,
} from '@pascal-app/nodes/formwork-assembly/headless'
import { z } from 'zod'
import type { SceneOperations } from '../../operations'
import { NodeIdSchema } from '../schemas'
import { formworkScopeInput, noSuchLevel, round, sceneNodes, textResult } from './shared'

export const inspectProjectFormworkOutput = {
  scope: z.string(),
  elementCount: z.number(),
  shutterCount: z.number(),
  elements: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      shutters: z.number(),
      pourUnits: z.number(),
      coversWholePour: z.boolean(),
    }),
  ),
  unshuttered: z.array(NodeIdSchema),
  bom: z.array(
    z.object({
      description: z.string(),
      catalogId: z.string().nullable(),
      provenance: z.string(),
      quantity: z.number(),
      unit: z.string(),
      totalWeightKg: z.number().nullable(),
      fromOwnStock: z.number().optional(),
      toHire: z.number().optional(),
      consumed: z.number().optional(),
      daysHeld: z.number().nullable(),
      struckAs: z.string().nullable(),
      mixedPeriods: z.array(z.string()).optional(),
      daysCharged: z.number().optional(),
      atMinimumHirePeriod: z.boolean().optional(),
      hireCost: z.number().optional(),
      rechargeCost: z.number().optional(),
      purchaseCost: z.number().optional(),
      lineCost: z.number().optional(),
      ownStockCost: z.number().optional(),
      costGaps: z.array(z.string()).optional(),
    }),
  ),
  totalWeightKg: z.number(),
  totalWeightComplete: z.boolean(),
  hire: z.object({
    standard: z.string(),
    basis: z.string(),
    longestDaysHeld: z.number(),
    periods: z.array(
      z.object({ struckAs: z.string(), days: z.number(), governingRule: z.string() }),
    ),
    assumed: z.array(z.string()),
    substitutedFromAnotherCodeFamily: z.boolean(),
  }),
  supply: z
    .object({
      fromOwnStock: z.number(),
      toHire: z.number(),
      consumed: z.number(),
      hiredAlteredHere: z.number(),
      hiredWeightKg: z.number().nullable(),
      ownedNotUsedHere: z.array(z.string()),
    })
    .optional(),
  cost: z
    .object({
      currency: z.string().nullable(),
      hire: z.number(),
      recharge: z.number(),
      purchase: z.number(),
      total: z.number(),
      /**
       * What the yard's own rack would earn over the days this job holds it, and
       * deliberately outside `total`: `total` is cash the job spends, and this is an
       * internal recharge.
       */
      ownStock: z.number(),
      complete: z.boolean(),
      linesAtMinimumHirePeriod: z.number(),
      ownedQuantityExcluded: z.number(),
      gaps: z.array(z.string()),
      excludes: z.array(z.string()),
    })
    .optional(),
  schedule: z
    .object({
      plantWantedOnSite: z.string().nullable(),
      firstPour: z.string().nullable(),
      lastPour: z.string().nullable(),
      lastStrike: z.string().nullable(),
      plantFreeAgain: z.string().nullable(),
      daysOnSite: z.number().nullable(),
      datedPours: z.number(),
      undatedPours: z.number(),
      earliestOnly: z.boolean(),
      complete: z.boolean(),
      gaps: z.array(z.string()),
      pours: z.array(
        z.object({
          assemblyId: z.string(),
          pourAt: z.string().nullable(),
          erectAt: z.string().nullable(),
          strikeAt: z.string().nullable(),
          releaseAt: z.string().nullable(),
          strikes: z.array(z.object({ struckAs: z.string(), date: z.string() })),
        }),
      ),
    })
    .optional(),
  sets: z
    .object({
      poursAtOnce: z.number(),
      poursAtOnceOn: z.string().nullable(),
      countedPours: z.number(),
      totalPours: z.number(),
      items: z.array(
        z.object({
          description: z.string(),
          catalogId: z.string(),
          mostAtOnce: z.number(),
          neededFrom: z.string(),
          fittedInTotal: z.number(),
          reuses: z.number(),
        }),
      ),
      rack: z.array(z.object({ kind: z.string(), mostAtOnce: z.number() })),
      gaps: z.array(z.string()),
    })
    .optional(),
  /**
   * The peak against what the yard owns — what has to be acquired, and whether to buy it.
   *
   * Absent unless there is both a set count and a recorded rack, and `noAcquisitionBecause`
   * says which of the two is missing.
   */
  acquire: z
    .object({
      currency: z.string().nullable(),
      shortfallQuantity: z.number(),
      hireTheShortfall: z.number(),
      buyTheShortfall: z.number(),
      complete: z.boolean(),
      items: z.array(
        z.object({
          description: z.string(),
          catalogId: z.string(),
          mostAtOnce: z.number(),
          neededBy: z.string(),
          owned: z.number(),
          shortBy: z.number(),
          spare: z.number(),
          daysCommitted: z.number(),
          inUseFraction: z.number(),
          poursCausingThePeak: z.array(z.string()),
          hireCost: z.number().optional(),
          purchaseCost: z.number().optional(),
          cheaperOverThisJob: z.string().optional(),
          paysBackOverJobs: z.number().optional(),
          gaps: z.array(z.string()).optional(),
        }),
      ),
      gaps: z.array(z.string()),
    })
    .optional(),
  noAcquisitionBecause: z.string().optional(),
  /**
   * Why there is no `sets` block, where there is a programme but too little of one.
   *
   * A field rather than only a caveat, because the absence of `sets` is the one absence in
   * this answer a caller cannot interpret: an absent `cost` means no rates and an absent
   * `schedule` means no dates, and both are visible in what else is missing. An absent
   * `sets` beside a present `schedule` looks like a bug.
   */
  noSetCountBecause: z.string().optional(),
  beyondCapacity: z.array(
    z.object({ elementId: z.string(), mark: z.string(), utilisation: z.number() }),
  ),
  caveats: z.array(z.string()),
}

export function registerInspectProjectFormwork(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'inspect_project_formwork',
    {
      title: 'Inspect project formwork',
      description:
        'The formwork the whole job needs, as one bill. This is the scope a yard actually orders at: the same panel type on two walls is one line on a delivery note, and two per-element bills of it cannot be added together afterwards — so use this for any question about what a floor or a project needs, what it weighs, or what to order. Scope it with levelId to bill one level, which is how a pour is planned, or leave it off for the whole scene. Elements with no shutter yet are not in the bill at all, and are listed separately as unshuttered — a wall nobody has formed is not a wall that needs nothing. Read caveats first and lead with them: each one means every figure below it is wrong in a way the figures themselves cannot show. Where the project has recorded what the yard owns, every line also splits into fromOwnStock, toHire and consumed, and supply totals them; supply being absent means nobody has recorded any stock, so say that rather than implying the bill is all on hire. Two things about the split worth carrying to the user: it is for this scope only, because the same owned panels serve the next pour once stripped, so two levels’ owned figures are not a total; and hiredAlteredHere is a recharge at list price rather than a hire charge, because a hire company’s panel drilled for this pour does not come back as stock. Every line also carries daysHeld, how long that line stays on the job under the striking table the project’s code family publishes, with struckAs saying what it is held as — a slab’s deck comes off in 4 days and the props under it stay 10, so never quote one period for an element. daysHeld null means the part is not struck at all: a tie is cut off inside the wall, a release agent is used up. Three things never to do with these figures: do not add them, because hire.longestDaysHeld is when the last of the set comes free and a sum is a duration longer than the job; do not call them calendar days when hire.basis is qualifying-time, because ACI counts only hours above 10 °C and in a cold spell the strike date is later than the number reads; and do not multiply them by a rate of your own — cost is either in the answer or it is not. Read hire.assumed and say which figures the job stated and which the code’s own default column supplied. Where the project has recorded rates, cost prices the bill and every line carries its own share: hire for the period charged, recharge for hired parts this pour altered, purchase for what is spent. Four rules about the money. Cost absent means no rate is recorded, so there is no price in this answer — say that rather than deriving one, because a rate is the only input in this whole model that no code publishes and no product carries, and a plausible figure is indistinguishable from a real one once you have said it. cost.complete false means some lines could not be priced, so the total is a floor and must be quoted as one — cost.gaps says what is missing. daysCharged rather than daysHeld is what reconciles with an invoice: a wall form struck in 12 hours against a 28-day minimum is charged for 28 days, atMinimumHirePeriod marks those lines, and the remedy is pouring more with the same set rather than striking sooner. And cost.excludes is not boilerplate — this is what the formwork costs to hold, not the cost of forming the job, so never present the total as a formwork price without saying that labour, transport and finance are all outside it. cost.ownStock is a fifth rule of its own: the yard’s own rack is charged at the project’s own hire rate for the days this job holds it, as a plant department recharges its own site, and it is deliberately not in cost.total. Never add the two — total is cash the job spends and ownStock is not cash at all, so quote them as two figures or quote the total alone. It is also not amortisation: there is no panel life or resale value anywhere in this model, so never present it as the cost of wearing the rack out. Where any pour carries a date, schedule turns those periods into a calendar: plantWantedOnSite is when the plant has to arrive, plantFreeAgain when the last of it is back, and daysOnSite is arrival to release across every pour — which is not hire.longestDaysHeld, because a set used on five pours a week apart is held two days each time and on site for five weeks, and it is the on-site figure a yard invoices. Five rules about the dates. Schedule absent means nobody has dated a pour, so there is no programme in this answer — never infer one from the order the elements or shutters appear in, because a date is the only input in this model with neither a code nor a product behind it, and a derived programme printed beside real geometry carries the same authority as the geometry. undatedPours above zero means the window covers only the dated ones: a window over 3 of 40 pours is a true statement about 3 pours and a wrong one about the job, so always say how many are covered. earliestOnly true means the strike dates are the earliest the forms could come off rather than the dates, because ACI counts qualifying hours above 10 °C and nothing here knows the weather — a cold spell pushes every one of them later. A pour’s strikeAt is the last of its strikes, not the first, because it is the day the set comes free: a slab’s deck comes off days before its props, and both are in that pour’s strikes if the caller needs the sequence. And where no return lead time is recorded, releaseAt is the strike date itself and gaps says so — cleaning and the trip back are not in it, while a hire normally runs to the return. Where the programme covers enough of the job, sets answers the question the rest of this bill cannot: how many to own or hire. Every quantity in bom is what passes through the job, and sets.items[].mostAtOnce is what stands at the same time — a job of 400 panels with a peak of 100 is an order for 100, so when a user asks what to buy or hire, quote sets and never bom. reuses is mostAtOnce against fittedInTotal — how hard the job works each set, which is worth quoting beside a peak and is not the buy-or-hire argument: hire is charged per unit per month, so a set fitted eight times inside one month costs exactly what a set fitted once inside it does. Use acquire for that question, never reuses. sets.rack is per kind and is a sum of that kind’s items rather than a sweep of them, because a 2.4 m panel does not cover for a 1.2 m one even if their peaks fall a fortnight apart. Four rules about these counts. Sets absent with schedule present is not a fault — read noSetCountBecause and pass it on, because a set count over part of a programme comes out low and a low order is one somebody places, so there is deliberately no figure rather than a small one; the remedy is dating the remaining pours. countedPours below totalPours means every figure is a floor: an undated pour cannot reduce an overlap, so the real peak is that or higher, never lower. Do not subtract a peak from a bill quantity, because the difference is not a quantity of anything — the same panels are counted again each time they are refitted. And a set is counted free from its release date, so back-to-back pours are shown sharing one set with no slack for striking, cleaning and refitting, which no gang does in a day — treat a peak with no margin as the minimum. Where the project has also recorded what the yard owns, acquire is the only block in this answer that says what to actually go and get: shortBy is the peak over the rack, so it is what has to be standing on site by neededBy. That is a smaller number than supply.toHire and neither is wrong — toHire splits the whole bill and this splits the moment, so on a job whose pours run in sequence the same owned panels serve every one of them and the difference is a factor rather than a rounding. Never quote toHire as an order and never quote the difference between them as anything. Five rules about the recommendation. Never present cheaperOverThisJob without paysBackOverJobs beside it: hire runs at a few per cent of new value a month, so hiring is cheaper on almost any single job, and "hire, pays back over 2.1 jobs like this" is a purchase for a yard with three more booked and a hire for one with none — the decision is about an order book this model cannot see, so give the number and let the user decide. There is no panel life, no resale value and no cost of capital in it, so a purchase that serves the next job as well is under-valued by exactly the part not visible from here — say so rather than presenting the verdict as final. spare is not a saving: stock the job never needs all at once is spare capacity for another job, and the money is already spent. inUseFraction below 0.5 means the hire is paying for plant standing idle, which is a programme with gaps rather than a fault in the design, and resequencing the pours is what shortens it. And where acquire is absent but sets is present, read noAcquisitionBecause and pass it on — nobody has recorded a rack, which is not a yard that owns nothing, and inventing a zero rack would report the whole peak as an order.',
      inputSchema: formworkScopeInput,
      outputSchema: inspectProjectFormworkOutput,
    },
    async ({ elementIds, levelId }) => {
      const nodes = sceneNodes(bridge)
      if (levelId !== undefined && nodes[levelId]?.type !== 'level') return noSuchLevel(levelId)

      const scope = { hostIds: elementIds, parentId: levelId }
      const solution = solveProjectFormwork(nodes, scope)
      const scoped = new Set(castableHostIds(nodes, scope))
      const shuttered = new Set(solution.elements.map((element) => element.host.id as string))

      return textResult({
        scope: levelId ?? (elementIds ? 'the elements named' : 'whole scene'),
        elementCount: solution.elements.length,
        shutterCount: solution.shutterCount,
        elements: solution.elements.map((element) => ({
          id: element.host.id as string,
          kind: element.host.type,
          shutters: element.shutters.length,
          pourUnits: element.pourUnitCount,
          coversWholePour: element.coversWholePour,
        })),
        // Named rather than omitted. An element in scope with no shutter is the most
        // likely reason a total is lower than the caller expects, and it is invisible
        // in a bill that only lists what exists.
        unshuttered: [...scoped].filter((id) => !shuttered.has(id as string)) as string[],
        bom: solution.bom.map((line, index) => {
          const split = solution.supply?.lines[index]
          const held = solution.hire.lines[index]
          const priced = solution.cost?.lines[index]
          return {
            description: line.description,
            catalogId: line.catalogId ?? null,
            provenance: line.provenance as string,
            quantity: line.quantity,
            unit: line.unit,
            totalWeightKg: line.totalWeightKg === undefined ? null : round(line.totalWeightKg),
            // Only where the project has recorded a rack, so an absent field is "nobody
            // said what this project owns" rather than "nothing to hire". Indexed
            // because `bomSupply` returns the bill's own order.
            ...(split
              ? {
                  fromOwnStock: split.ownedQuantity,
                  toHire: split.hiredQuantity,
                  consumed: split.consumedQuantity,
                }
              : {}),
            // Null rather than 0 for a part nothing strikes — a tie is cut off inside
            // the wall, a release agent is used up. A 0 reads as plant returned the
            // same day.
            daysHeld: held?.hours === undefined ? null : round(held.hours / 24),
            struckAs: held?.striking?.target ?? null,
            ...(held?.mixed ? { mixedPeriods: held.mixed.targets as string[] } : {}),
            // Only where the project has recorded rates, and each figure only where it
            // resolved. An absent cost is "no rate for this" and never "costs nothing":
            // a 0 here is the one number a model would repeat to a user as a price.
            // `daysCharged` differs from `daysHeld` whenever a minimum hire period bites,
            // and it is the charged figure that reconciles with an invoice.
            ...(priced
              ? {
                  ...(priced.chargedDays === undefined
                    ? {}
                    : { daysCharged: round(priced.chargedDays) }),
                  ...(priced.atMinimumPeriod ? { atMinimumHirePeriod: true } : {}),
                  ...(priced.hireCost === undefined ? {} : { hireCost: round(priced.hireCost) }),
                  ...(priced.rechargeCost === undefined
                    ? {}
                    : { rechargeCost: round(priced.rechargeCost) }),
                  ...(priced.consumedCost === undefined
                    ? {}
                    : { purchaseCost: round(priced.consumedCost) }),
                  ...(priced.totalCost === undefined ? {} : { lineCost: round(priced.totalCost) }),
                  // Outside `lineCost` on purpose, and named so a caller cannot add the two
                  // columns into a price: this is the yard recharging itself for its own rack.
                  ...(priced.ownedCost === undefined
                    ? {}
                    : { ownStockCost: round(priced.ownedCost) }),
                  ...(priced.gaps.length > 0
                    ? { costGaps: priced.gaps.map((gap) => COST_GAP_LABELS[gap]) }
                    : {}),
                }
              : {}),
          }
        }),
        totalWeightKg: round(solution.totalWeightKg),
        // False means some part has no published weight, so the total is the sum of
        // the ones that do. Do not quote it as the lifting weight of the set.
        totalWeightComplete: solution.totalWeightComplete,
        // Absent where the project has recorded no stock at all, which is not the same
        // claim as a yard that owns nothing — see the tool description.
        ...(solution.supply
          ? {
              supply: {
                fromOwnStock: solution.supply.ownedQuantity,
                toHire: solution.supply.hiredQuantity,
                consumed: solution.supply.consumedQuantity,
                hiredAlteredHere: solution.supply.hiredModifiedQuantity,
                hiredWeightKg:
                  solution.supply.hiredWeightKg === undefined
                    ? null
                    : round(solution.supply.hiredWeightKg),
                ownedNotUsedHere: solution.supply.unusedOwnedIds,
              },
            }
          : {}),
        // Absent where the project has recorded no rate, which means there is no money in
        // this answer at all — not a job that costs nothing. `excludes` is carried as data
        // rather than left to the description because it is the sentence a caller has to
        // repeat: this is what the formwork costs to hold, and labour is not in it.
        ...(solution.cost
          ? {
              cost: {
                currency: solution.cost.currency ?? null,
                hire: round(solution.cost.hireCost),
                recharge: round(solution.cost.rechargeCost),
                purchase: round(solution.cost.consumedCost),
                total: round(solution.cost.totalCost),
                ownStock: round(solution.cost.ownedCost),
                complete: solution.cost.complete,
                linesAtMinimumHirePeriod: solution.cost.linesAtMinimum.length,
                ownedQuantityExcluded: solution.cost.ownedQuantityExcluded,
                gaps: solution.cost.gaps.map((gap) => COST_GAP_LABELS[gap]),
                excludes: [
                  'labour, which is normally the largest cost of forming a job',
                  'transport and craneage',
                  'finance and preliminaries',
                  'the yard’s own rack, which is priced separately as ownStock at the project’s own hire rate — an internal recharge rather than cash this job spends',
                ],
              },
            }
          : {}),
        // Never a total. A set is tied up for its slowest release, and a caller handed a
        // column of days will otherwise add them and quote a hire longer than the job.
        hire: {
          standard: solution.hire.standard as string,
          basis: solution.hire.basis as string,
          longestDaysHeld: round(solution.hire.longestHours / 24),
          periods: solution.hire.periods.map((period) => ({
            struckAs: period.target as string,
            days: round(period.days),
            governingRule: period.governingRule,
          })),
          assumed: solution.hire.assumed.map((entry) => entry.message),
          substitutedFromAnotherCodeFamily: solution.strikingStandardSubstituted,
        },
        // Absent where no pour in scope carries a date, which means this answer has no
        // calendar in it — not a job with no programme. A date is the only input in the
        // whole feature with neither a code nor a product behind it, so there is nothing
        // to assume and nothing to derive from the order the shutters happen to be in.
        ...(solution.schedule
          ? {
              schedule: {
                plantWantedOnSite: solution.schedule.firstErectAt ?? null,
                firstPour: solution.schedule.firstPourAt ?? null,
                lastPour: solution.schedule.lastPourAt ?? null,
                lastStrike: solution.schedule.lastStrikeAt ?? null,
                plantFreeAgain: solution.schedule.lastReleaseAt ?? null,
                // Arrival to release across every pour, which is not `hire.longestDaysHeld`:
                // that is one pour's hold, and a set used on five pours a week apart is held
                // two days each time and on site five weeks. Only this one is invoiced.
                daysOnSite: scheduleOccupancyDays(solution.schedule) ?? null,
                datedPours: solution.schedule.scheduledCount,
                undatedPours: solution.schedule.unscheduled.length,
                earliestOnly: solution.schedule.earliestOnly,
                complete: solution.schedule.complete,
                gaps: solution.schedule.gaps.map((gap) => SCHEDULE_GAP_LABELS[gap]),
                pours: scheduleInPourOrder(solution.schedule).map((pour) => ({
                  assemblyId: pour.id,
                  pourAt: pour.pourAt ?? null,
                  erectAt: pour.erectAt ?? null,
                  strikeAt: pour.strikeAt ?? null,
                  releaseAt: pour.releaseAt ?? null,
                  strikes: pour.strikes.map((strike) => ({
                    struckAs: strike.target as string,
                    date: strike.date,
                  })),
                })),
              },
            }
          : {}),
        // What to own or hire, where the programme can carry the question. Absent for a
        // stronger reason than `cost` or `schedule` are absent: those are missing an input and
        // say so by having no figures, while a set count off a partial programme is a
        // *plausible small number*. `noSetCountBecause` is what stops the absence reading as
        // a fault in the tool.
        ...(solution.sets
          ? {
              sets: {
                poursAtOnce: solution.sets.peakConcurrentPours,
                poursAtOnceOn: solution.sets.peakConcurrentOn ?? null,
                countedPours: solution.sets.countedPours,
                totalPours: solution.sets.totalPours,
                items: solution.sets.peaks.map((peak) => ({
                  description: peak.description,
                  catalogId: peak.catalogId,
                  mostAtOnce: peak.peakQuantity,
                  neededFrom: peak.peakOn,
                  fittedInTotal: peak.totalFitted,
                  reuses: round(peak.reuseFactor),
                })),
                rack: solution.sets.kinds.map((kind) => ({
                  kind: kind.kind as string,
                  mostAtOnce: kind.peakQuantity,
                })),
                gaps: solution.sets.gaps.map((gap) => SET_COUNT_GAP_LABELS[gap]),
              },
            }
          : solution.schedule
            ? {
                noSetCountBecause: `${solution.schedule.scheduledCount} of ${solution.schedule.pours.length} pours are dated, which is too few to sweep. A set count over part of a programme comes out low, so there is none here rather than a small one.`,
              }
            : {}),
        // The peak against the rack. Both figures are the solution's own, so this cannot
        // disagree with `sets` above it or with `supply`'s split — and it is a different
        // question from either: `supply.toHire` splits the bill and this splits the peak.
        ...(solution.acquisition
          ? {
              acquire: {
                currency: solution.acquisition.currency ?? null,
                shortfallQuantity: solution.acquisition.shortfallQuantity,
                hireTheShortfall: round(solution.acquisition.hireCost),
                buyTheShortfall: round(solution.acquisition.purchaseCost),
                complete: solution.acquisition.complete,
                items: solution.acquisition.lines.map((line) => ({
                  description: line.description,
                  catalogId: line.catalogId,
                  mostAtOnce: line.peakQuantity,
                  neededBy: line.peakOn,
                  owned: line.ownedQuantity,
                  shortBy: line.shortfall,
                  spare: line.surplus,
                  daysCommitted: line.committedDays,
                  inUseFraction: round(line.utilisation),
                  poursCausingThePeak: line.peakPourIds,
                  ...(line.hireCost === undefined ? {} : { hireCost: round(line.hireCost) }),
                  ...(line.purchaseCost === undefined
                    ? {}
                    : { purchaseCost: round(line.purchaseCost) }),
                  ...(line.verdict === undefined ? {} : { cheaperOverThisJob: line.verdict }),
                  ...(line.paybackJobs === undefined
                    ? {}
                    : { paysBackOverJobs: round(line.paybackJobs) }),
                  ...(line.gaps.length > 0
                    ? { gaps: line.gaps.map((gap) => ACQUIRE_GAP_LABELS[gap]) }
                    : {}),
                })),
                gaps: solution.acquisition.gaps.map((gap) => ACQUIRE_GAP_LABELS[gap]),
              },
            }
          : solution.sets
            ? {
                noAcquisitionBecause:
                  'The job has a peak but no rack to compare it against — nobody has recorded what the yard owns. That is not a yard that owns nothing; ask the user and set it with set_formwork_settings ownedStock.',
              }
            : {}),
        beyondCapacity: solution.beyondCapacityMarks.map((part) => ({
          elementId: part.hostId,
          mark: part.mark,
          utilisation: round(part.utilisation),
        })),
        caveats: projectFormworkCaveats(solution),
      })
    },
  )
}
