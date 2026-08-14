import type {
  BomCost,
  BomHire,
  BomLabour,
  BomLine,
  BomSupply,
  CommittablePour,
  ElementCoverage,
  ElementGangs,
  FormworkAcquisition,
  FormworkCommitments,
  FormworkCutList,
  FormworkCutListOptions,
  FormworkLifts,
  FormworkLogistics,
  FormworkPart,
  FormworkPours,
  FormworkResequence,
  FormworkSchedule,
  FormworkSequence,
  FormworkSetCount,
  FormworkSettings,
  PourQuantities,
  SchedulablePour,
  SequenceablePour,
  StrikeTarget,
  StrikingTime,
  Unformable,
} from '@pascal-app/core/formwork'
import {
  acquireCaveats,
  bomCost,
  bomCostCaveats,
  bomHire,
  bomLabour,
  bomLabourCaveats,
  bomLines,
  bomSupply,
  bomWeightKg,
  classifyElementFaces,
  collectCastableElements,
  committedPourIds,
  DEFAULT_FORMWORK_SYSTEM_ID,
  findAbutments,
  findJunctions,
  formworkAcquisition,
  formworkCommitmentCaveats,
  formworkCommitments,
  formworkCutList,
  formworkCutListCaveats,
  formworkLiftCaveats,
  formworkLifts,
  formworkLogistics,
  formworkLogisticsCaveats,
  formworkPours,
  formworkPoursCaveats,
  formworkResequence,
  formworkSchedule,
  formworkScheduleCaveats,
  formworkSequence,
  formworkSequenceCaveats,
  formworkSetCaveats,
  formworkSetCount,
  formworkSettingsFor,
  formworkSystem,
  isReturnableLine,
  isSubstitutedStrikingStandard,
  overUtilisedParts,
  pourLimitsFromSettings,
  resequenceCaveats,
  strikeTargetForPartKind,
  strikingInputFor,
  strikingStandardFor,
  systemSupportsKind,
  toCastableElement,
  unformable,
  unformableCaveats,
  type Verification,
  weakestVerification,
} from '@pascal-app/core/formwork'
import type { AnyNode, AnyNodeId } from '@pascal-app/core/schema'
import { type CastableHostNode, pourUnitsForHost } from './attach'
import { formworkAssembliesOnHost } from './dirty-scope'
import { type SolvedShutter, solveShuttersForHost } from './solve'

/**
 * The whole job's formwork, in one answer.
 *
 * Every formwork consumer before this was per-host: a panel showing one wall's
 * parts, a chat tool billing one element. That is the wrong scope for the question
 * anybody actually asks. A yard does not order the formwork for a wall, it orders
 * the formwork for a floor, and a bill split element by element cannot be added up
 * afterwards — the same panel type on two walls is one line on a delivery note and
 * two lines in two separate takeoffs.
 *
 * This is the simplest useful form of the plan's project-wide `FormworkSolution`
 * (§6 phase 12). It is not that type: there is no clash pass, no schedule, no
 * serialisable cache. What it is, is the aggregation the export and the AI both
 * needed, built on the per-host solve rather than beside it — a second enumeration
 * at project scope would reintroduce exactly the divergence `solve.ts` exists to
 * prevent, one level up.
 */

const CASTABLE_TYPES = ['wall', 'column', 'slab'] as const

/** One element's contribution to the job, and whether it is fully formed. */
export interface SolvedElement {
  host: CastableHostNode
  /** Face topology and area classification shared by drawings, validation and totals. */
  topology: ElementCoverage
  shutters: SolvedShutter[]
  /** How many pours the element is cast in, which is how many shutters it needs. */
  pourUnitCount: number
  /**
   * True where the shutters match the pour.
   *
   * False is the case that matters and the reason this is on the element rather
   * than computed by each caller: an element cast in three pours and formed for
   * one bills a third of its own formwork, and every figure in that third is
   * individually correct. A project total over such an element is short by an
   * amount nothing else in the numbers reveals.
   */
  coversWholePour: boolean
}

export interface ProjectFormwork {
  elements: SolvedElement[]
  /** One bill across every shutter in scope, because it is one order. */
  bom: BomLine[]
  totalWeightKg: number
  /** False where any line has no published weight — do not quote the total as a lifting weight. */
  totalWeightComplete: boolean
  /**
   * The bill split into what the yard owns and what it hires, or absent.
   *
   * Absent means nobody has recorded a rack, and that is the whole reason it is
   * optional rather than a split with zeros in it: a project that has said nothing
   * about what it owns has not said its formwork is all on hire, and a takeoff that
   * fills the answer in makes a claim on the project's behalf.
   */
  supply?: BomSupply
  /**
   * How long each line is held, under the striking table the project's own code
   * family publishes — the other factor a hire charge needs.
   *
   * Always present, unlike `supply`, and the asymmetry is deliberate: ownership is a
   * fact about the yard that silence says nothing about, while a strike period is a
   * consequence of the code the project is already designed under. Unstated curing
   * inputs are named in `hire.assumed` rather than withholding the answer.
   */
  hire: BomHire
  /**
   * What the scope costs to hold, or absent where the project has recorded no rates.
   *
   * Optional like `supply` rather than always present like `hire`, and for the strongest
   * version of that reason in the whole feature: a strike period is a consequence of a
   * published code, so silence about it has a conservative answer. A price has no code
   * behind it at all. There is nothing to assume, so a project that has stated no rate
   * gets no money — not a zero, and not a figure derived from a plausible market rate.
   */
  cost?: BomCost
  /**
   * The work in the job — hours to erect and to strike — or absent where the project has
   * stated no output norms.
   *
   * Reported apart from `cost` rather than folded into it, and that is the decision worth
   * knowing about this field. `cost` is money paid to a supplier for plant: a hire invoice,
   * a recharge, a purchase. This is the gang's time. They are negotiated with different
   * people, they move for different reasons — a hire falls with a shorter programme and
   * labour does not — and a single total would hide the one comparison the pair exists to
   * make, which is that the labour is usually the larger of the two.
   *
   * Absent for the reason `cost` is, one degree further. A price has no code behind it; an
   * output norm has no code and no *product* behind it either, because it is a fact about a
   * crew. Nothing is assumed, and until a project states its norms every surface says the
   * labour is outside the figures — which is what they have all said since the money
   * arrived.
   */
  labour?: BomLabour
  /**
   * When each pour happens and when its plant arrives and comes free, or absent where no
   * pour in scope carries a date.
   *
   * Optional like `cost` rather than always present like `hire`, and the reason is the
   * same shape: a period is a consequence of a published code, and a *date* has no code
   * behind it at all. A project that has not programmed its pours has not said when it
   * pours, and deriving a date from the solve order would be a programme nobody agreed to
   * printed beside geometry that is actually derived.
   */
  schedule?: FormworkSchedule
  /**
   * How many of each thing the job needs to own or hire, or absent where the programme
   * cannot support the question.
   *
   * The figure the whole commercial chain has been working towards, and the last one to
   * arrive because it is the only one that needs *two* answers at once: the bill says what a
   * pour needs standing, and the programme says which pours stand at the same time. Neither
   * alone is a set count.
   *
   * Absent for a stronger reason than `cost` or `schedule` are. Those are absent because an
   * input is missing and their own output shows it — an unpriced bill has no money in it. A
   * set count off a partial programme is a *plausible small number*, so below the coverage
   * threshold there is no count rather than a low one. See `sets.ts`.
   */
  sets?: FormworkSetCount
  /**
   * What the yard has to go out and get, and whether to buy it or hire it.
   *
   * Present only where `sets` and `supply` both are, which makes it the *second* field
   * derived from other fields of this same solution rather than from the scene — and the
   * first whose absence has two unrelated causes. No count means no peak to compare; no
   * rack recorded means nothing to compare against, and neither is a yard that owns
   * nothing. Both silences are carried to the surfaces as reasons rather than gaps.
   */
  acquisition?: FormworkAcquisition
  /**
   * What has to happen before what, and how far each pour can move.
   *
   * Present wherever there is a programme at all, unlike `sets` and `acquisition`, because
   * precedence is a fact about the scene rather than about the commercial inputs: an element
   * cast in three lifts states two dependencies whether or not anybody has priced anything.
   * The float inside it is per pour and absent where that pour is undated, which is the same
   * rule the schedule follows.
   *
   * No new field on any node produces this. The scene has always stated order three ways —
   * `liftIndex`, `castOrder` and `pourId` — and this is the first reader to use them together.
   */
  sequence?: FormworkSequence
  /**
   * Which pour to move, to stop being short — or why nothing can move.
   *
   * The first output in this feature that proposes a change to the project rather than
   * describing one, and the only one derived from three other fields of this same solution: it
   * needs the shortfall to know what is short, the sequence to know what can move, and the
   * programme to re-sweep the peak after a candidate move. Absent where any of the three is.
   */
  resequence?: FormworkResequence
  /**
   * What is spoken for — how much of each item is booked, from when to when, and which
   * bookings the programme has since moved off. Absent where no pour is committed.
   *
   * The only field here derived from a schema field nothing else reads. Every other
   * programme answer is a consequence of dates the project already stated; this one needs
   * `committedPourAt`, because the scene recorded what the project *intends* and had nowhere
   * to record what anybody has *agreed*.
   *
   * Absent rather than empty for the reason `sets` is absent below its threshold: a job with
   * no bookings and a job whose bookings came to nothing read identically on a panel, and only
   * one of them is a state to act on.
   */
  commitments?: FormworkCommitments
  /**
   * Every pick on the job, heaviest first — or absent where nothing in scope is ganged.
   *
   * The one commercial answer here that comes off the *geometry* rather than off the bill or
   * the programme, and the only reason it can exist at project scope: a gang is a grouping of
   * the layout each shutter already produced, carried out as `ShutterEvidence.gangs` for the
   * same reason the packs and the envelopes are. Re-grouping the faces here would be a second
   * gang division of every wall, and a schedule disagreeing with the drawing about where a
   * gang breaks sends a rigger to a joint that is not on the panel.
   *
   * Absent rather than empty for `commitments`' reason: a conventional job is struck panel by
   * panel and has no assembly to lift at all, and a schedule of zero picks reads as a crane
   * with nothing to do rather than as a job with no craning in it.
   */
  lifts?: FormworkLifts
  /**
   * What it costs to deliver this bill and to lift it in — or absent where the project has
   * recorded no payload and no cycle time.
   *
   * The only field here derived from two of the others rather than from the bill or the
   * programme: the loads come off `totalWeightKg` and the hook time off `lifts`. That is why
   * it is last to arrive despite being named in `cost.excludes` from the day there was a
   * cost — a delivery is priced per load and a crane per lift, and until a gang existed the
   * bill was 2,400 parts and neither.
   *
   * Absent for `cost`'s reason rather than `lifts`'. A payload is the lorry the yard sends and
   * a cycle time is this crew on this crane; neither has a code or a product behind it, so
   * silence gets no figure. The two halves are independent — a project that states a payload
   * and no cycle time gets loads and no crane hours, which is a real state and not a gap.
   */
  logistics?: FormworkLogistics
  /**
   * The sheets the scope's cut ply nests out of — or absent where the job has no cut ply, or
   * where the project has not said which sheet it buys.
   *
   * The only field here that is not a quantity the bill already implies. Every other answer
   * on this solution counts, prices or dates what the parts say; this one asks what the parts
   * were *made from*, which the bill cannot answer because a bill line is a board and a board
   * is a rectangle out of something larger. So the boards come off the parts and the sheet
   * comes off the settings, and the nest is the join.
   *
   * Deliberately not in `bom`, `supply`, `cost` or the weight, and this is the one field here
   * where that separation is load-bearing rather than tidy: the boards are already billed as
   * cut ply, so a sheet count added to the bill would count the same ply twice. It is a
   * purchasing figure beside the takeoff, and every surface repeats that.
   *
   * Two unrelated silences, like `acquisition`'s. No cut ply in scope — a steel-panel job —
   * means there is nothing to cut, and no stated sheet means nobody has said what the yard
   * buys. The caveats distinguish them, because only the second is a state to act on.
   */
  cutList?: FormworkCutList
  /**
   * True where the striking table came from a different code family than the pressure
   * standard, because the project's own family publishes none.
   *
   * Only DIN, whose family answers removal in EN 13670 §5.5 rather than in DIN 18218.
   * Falling to BS 8110's formulas is the right answer and it is a substitution across
   * families rather than a match, which is a thing to say out loud.
   */
  strikingStandardSubstituted: boolean
  /** Elements formed for fewer or more pours than they are cast in. */
  incomplete: SolvedElement[]
  /** Parts working beyond capacity anywhere in scope. A bill for these is not an order. */
  beyondCapacityMarks: Array<{ hostId: string; mark: string; utilisation: number }>
  shutterCount: number
  /**
   * Elements in scope this engine will not design formwork for, with the reason.
   *
   * Separate from `incomplete`, which is an element formed for the wrong number of pours — a
   * real shutter counted wrongly. These carry no shutter at all and never could: the geometry
   * is degenerate. They were already excluded before this field existed, silently, which made a
   * short bill indistinguishable from a cheap one.
   */
  rejected: Unformable[]
  /**
   * The pour plan the solution was designed against — every split element's lifts with
   * how each joint was decided, and the boundaries a stated permitted set could not
   * satisfy. Present wherever anything was split into more than one lift; absent only
   * when every element forms one pour, in which case there is nothing to label.
   */
  pours?: FormworkPours
}

/**
 * Which elements a takeoff covers.
 *
 * `hostIds` scopes it to a selection; `parentId` to a level, which is the scope a
 * pour is actually planned at. Neither given means the whole scene.
 */
export interface ProjectFormworkScope {
  hostIds?: readonly string[]
  /** Elements whose `parentId` is this — a level, normally. */
  parentId?: string
}

function isCastable(node: AnyNode | undefined): node is CastableHostNode {
  return node !== undefined && (CASTABLE_TYPES as readonly string[]).includes(node.type)
}

/**
 * The repeated-floor detection for the cut list (OpenSpec 6.4): whether the scope's
 * board-bearing levels carry identical cut-piece sets, and one cycle's boards when they do.
 *
 * A level's fingerprint is its boards' rectangles, sorted — identical geometry is the only
 * signal the model has that a pour repeats. Two identical walls on one level sit inside the
 * same fingerprint by design: they are simultaneous, not reusable against each other, and
 * the *levels* are what must match. Only where every board-bearing level shares one
 * fingerprint is reuse claimed, so a scope with one bespoke floor among repeated ones stays
 * conservative — a reuse claim over part of the scope would need per-fingerprint purchase
 * counts, and the cut list is a purchasing figure a reader is likelier to argue with than
 * accept. The reuse itself is a claim the surfaces state, not one they bury.
 */
function repeatedFloorCycle(elements: readonly SolvedElement[]): {
  cycles: number
  parts?: FormworkPart[]
} {
  const byLevel = new Map<string, { parts: FormworkPart[]; rectangles: string[] }>()
  for (const element of elements) {
    const levelId = (element.host.parentId as string | undefined) ?? ''
    let bucket = byLevel.get(levelId)
    if (!bucket) {
      bucket = { parts: [], rectangles: [] }
      byLevel.set(levelId, bucket)
    }
    for (const shutter of element.shutters) {
      for (const part of shutter.parts) {
        if (part.kind !== 'ply-piece' || part.omitted) continue
        bucket.parts.push(part)
        bucket.rectangles.push(`${part.widthMm}x${part.heightMm}`)
      }
    }
  }
  const fingerprints = new Map<string, { parts: FormworkPart[]; count: number }>()
  for (const bucket of byLevel.values()) {
    if (bucket.rectangles.length === 0) continue
    const fingerprint = bucket.rectangles.sort().join(';')
    const existing = fingerprints.get(fingerprint)
    if (existing) existing.count++
    else fingerprints.set(fingerprint, { parts: bucket.parts, count: 1 })
  }
  if (fingerprints.size !== 1) return { cycles: 1 }
  const entry = [...fingerprints.values()][0]
  if (!entry || entry.count <= 1) return { cycles: 1 }
  return { cycles: entry.count, parts: entry.parts }
}

/**
 * The first system a host's assemblies resolve to that cannot form it, or `undefined`
 * where every assembly resolves to a seeded system that can.
 *
 * The resolution is the same chain the layout uses — the assembly's own `systemId`, then
 * the project's, then the shipped default — so a refusal here names the same system the
 * design would have laid out. A host with no assemblies is refused on the project default,
 * because that is the system its shutters would have been raised in.
 *
 * Two faults share the channel: a registered system with no data (`unseeded`), and a
 * seeded system that does not form this element's kind (`system-kind`) — a wall under a
 * column-only system would be laid out from panels that do not exist for walls, the same
 * invented layout the unseeded refusal blocks, reached through the back door once a column
 * system is seeded. Slabs are deliberately not kind-checked: a soffit is ply and props and
 * no system's data is used to form one, so a stated system on a slab is a configuration
 * the slab ignores rather than a refusal.
 */
function systemRefusalOnHost(
  host: CastableHostNode,
  nodes: Record<string, AnyNode>,
  settings: FormworkSettings,
): { systemId: string; unseeded: boolean } | undefined {
  const assemblyIds = formworkAssembliesOnHost(host.id as string, nodes)
  const resolve = (systemId: string | undefined) =>
    formworkSystem(systemId ?? settings.parts.systemId ?? DEFAULT_FORMWORK_SYSTEM_ID)
  const ids =
    assemblyIds.length > 0
      ? assemblyIds.map((id) => (nodes[id] as { systemId?: string } | undefined)?.systemId)
      : [undefined]
  for (const id of ids) {
    const entry = resolve(id)
    if (!entry) continue
    if (!entry.seeded) return { systemId: entry.id, unseeded: true }
    if (host.type !== 'slab' && !systemSupportsKind(entry, host.type)) {
      return { systemId: entry.id, unseeded: false }
    }
  }
  return undefined
}

/**
 * Elements in scope, in a stable order.
 *
 * Sorted by id rather than left in node-map order because the node map's order is
 * insertion order, which an undo reshuffles — and a CSV whose rows move between two
 * downloads of an unchanged scene is a CSV nobody can diff.
 */
function hostsInScope(
  nodes: Record<string, AnyNode>,
  scope: ProjectFormworkScope,
): CastableHostNode[] {
  const wanted = scope.hostIds ? new Set(scope.hostIds) : undefined
  const out: CastableHostNode[] = []
  for (const node of Object.values(nodes)) {
    if (!isCastable(node)) continue
    if (wanted && !wanted.has(node.id as string)) continue
    if (scope.parentId !== undefined && node.parentId !== scope.parentId) continue
    out.push(node)
  }
  return out.sort((a, b) => (a.id as string).localeCompare(b.id as string))
}

/**
 * Every shuttered element in scope, solved, plus the one bill across them.
 *
 * Elements with no shutter are left out entirely rather than carried as empty rows:
 * a wall nobody has formed yet is not a wall that needs nothing, and an empty row in
 * a bill reads as the latter. `incomplete` is where the under-formed ones are named.
 */
export function solveProjectFormwork(
  nodes: Record<string, AnyNode>,
  scope: ProjectFormworkScope = {},
): ProjectFormwork {
  const allNodes = Object.values(nodes)
  const castables = collectCastableElements(allNodes)
  const settings = formworkSettingsFor(allNodes)
  // The part of the settings the split reads, resolved once and passed to every count
  // that must agree: the pour-unit counts below, the layout's `resolveFormworkScope`,
  // and the pours report. Two derivations of one settings group is how a split comes to
  // snap against one copy while the validator checks another.
  const pourLimits = pourLimitsFromSettings(settings)
  const abutments = findAbutments(castables)
  const junctions = findJunctions(castables)
  const topologyById = new Map(
    castables.map((element) => [
      element.id,
      classifyElementFaces(element, abutments, { neighbours: castables, junctions }),
    ]),
  )
  const elements: SolvedElement[] = []
  const rejected: Unformable[] = []
  for (const host of hostsInScope(nodes, scope)) {
    // Before anything is designed, and before the shutter solve is asked: a degenerate element
    // produces no layout anyway, and asking first is what turns the empty answer into a stated
    // one. The same `unformable` the coverage conversion uses, so the two cannot disagree.
    const refusal = unformable(host)
    if (refusal) {
      rejected.push(refusal)
      continue
    }
    // The other refusal before the shutter solve: a configured panel system that is registered
    // but carries no design data, or that is seeded and does not form this element's kind.
    // `formworkSystem` resolves an unseeded id instead of returning `undefined`, so this is
    // the one place that difference is read — an unregistered id still falls back to the
    // conventional shutter, while a registered one with nothing to build from must be refused
    // rather than laid out in invented panels. Naming the id is the whole sentence: the remedy
    // is seeding that datasheet or choosing a system that forms this element, and neither is
    // guessable from a count.
    const systemRefusal = systemRefusalOnHost(host, nodes, settings)
    if (systemRefusal !== undefined) {
      rejected.push({
        elementId: host.id as AnyNodeId,
        kind: host.type,
        reason: systemRefusal.unseeded ? 'system-unseeded' : 'system-kind',
        systemId: systemRefusal.systemId,
      })
      continue
    }
    const shutters = solveShuttersForHost(host, nodes)
    if (shutters.length === 0) continue
    const pourUnitCount = Math.max(1, pourUnitsForHost(host, allNodes, pourLimits).length)
    const topology = topologyById.get(host.id as AnyNodeId)
    if (!topology) continue
    elements.push({
      host,
      topology,
      shutters,
      pourUnitCount,
      coversWholePour: shutters.length === pourUnitCount,
    })
  }

  const everyPart = elements.flatMap((element) =>
    element.shutters.flatMap((shutter) => shutter.parts),
  )
  const bom = bomLines(everyPart)
  const weight = bomWeightKg(bom)

  // The pour plan, off the same limits the counts above used. Over the solved elements
  // rather than every castable, because an element nobody has formed yet has no split
  // to report — and off the elements' hosts so a conflict names the element the takeoff
  // actually carries. The hosts were all `unformable`-checked above, so every one
  // converts to a castable element.
  const pourPlan = formworkPours(
    elements.flatMap((element) => {
      const castable = toCastableElement(element.host as never)
      return castable ? [castable] : []
    }),
    allNodes,
    pourLimits,
  )

  // Mark → what that mark is struck as, which is the only join between a striking
  // table and a bill. Built here because this is the layer that knows a part's host:
  // core's `strikeTargetForPartKind` can say a prop under a slab is a shore and a prop
  // against a wall is a raker, and it cannot tell them apart on its own.
  //
  // A list per mark rather than one target, because `bomLines` groups across hosts and
  // a mark is unique within a shutter rather than across a project — `duplicateMarks`
  // exists for that. Collapsing to one would silently keep whichever element sorted
  // last; accumulating makes the line `mixed`, which is the honest answer.
  const targetsByMark = new Map<string, Set<StrikeTarget>>()
  for (const element of elements) {
    const hostKind = element.host.type as 'wall' | 'column' | 'slab' | 'beam' | 'beam'
    for (const shutter of element.shutters) {
      for (const part of shutter.parts) {
        if (part.omitted) continue
        const target = strikeTargetForPartKind(part.kind, hostKind, (part as { use?: string }).use)
        if (target === undefined) continue
        const existing = targetsByMark.get(part.mark)
        if (existing) existing.add(target)
        else targetsByMark.set(part.mark, new Set([target]))
      }
    }
  }
  const hire = bomHire(
    bom,
    (mark) => [...(targetsByMark.get(mark) ?? [])],
    strikingStandardFor(settings.pressureStandard),
    strikingInputFor(settings),
  )

  const beyondCapacityMarks = elements.flatMap((element) =>
    overUtilisedParts(element.shutters.flatMap((shutter) => shutter.parts)).map((part) => ({
      hostId: element.host.id as string,
      mark: part.mark,
      utilisation: part.structure?.utilisation ?? 0,
    })),
  )

  const supply = settings.ownedStock ? bomSupply(bom, settings.ownedStock) : undefined

  // Every shutter's gangs rather than the first's, and not deduped across lifts — the same two
  // rules `validate-project` states about the identical input. A 9 m wall in three lifts is
  // three sets of picks, the heavy one may be in any of them, and two lifts of identical panels
  // are two assemblies lifted in on two different days.
  const elementGangs: ElementGangs[] = []
  for (const element of elements) {
    const faces = element.shutters.flatMap((shutter) => shutter.evidence.gangs ?? [])
    if (faces.length > 0) elementGangs.push({ elementId: element.host.id as string, faces })
  }
  const lifts = formworkLifts(elementGangs, settings.crane)

  // A pour per shutter, because a shutter *is* a pour unit — and the periods per shutter
  // rather than per bill line, which is the difference from `bomHire`. A line spans hosts
  // and a date does not: the same panel type on a wall poured in March and one poured in
  // May is one line and two pours, so the calendar has to be built off the assemblies.
  //
  // The periods come off the hire rather than being solved again. They are the same call
  // with the same inputs, so a second solve could not produce a different figure today —
  // it could the day either path gained a case, and a strike date that disagreed with the
  // hire duration behind it is the one inconsistency this scope cannot explain.
  const periods = new Map<StrikeTarget, StrikingTime>(
    hire.periods.map((time) => [time.target, time]),
  )
  const pours: SchedulablePour[] = []
  // The same walk builds the per-pour quantities the set count needs. Per shutter rather
  // than off `bom`, and that is the whole reason this cannot be done from the project bill:
  // a bill line is one catalog id across every pour in scope, so it has no pour to belong to
  // and a sweep over it would find one interval covering the job.
  const pourQuantities: PourQuantities[] = []
  // And the precedence, off the same walk and for the same layer reason `targetsByMark` is built
  // here: `castOrder` and `pourId` are stated on the *element* and a pour is a shutter, so only
  // the layer holding both can join them. Core's sequencer never sees a node.
  const sequenceable: SequenceablePour[] = []
  // And what has been agreed, off the same walk. `pourAt` is carried alongside rather than read
  // back off the schedule, because the pair is the whole question: a commitment matters only
  // against the date the project now states, and the schedule's row has already had the leads
  // applied to it.
  const committable: CommittablePour[] = []
  for (const element of elements) {
    const hostKind = element.host.type as 'wall' | 'column' | 'slab' | 'beam'
    const host = element.host as CastableHostNode & {
      castOrder?: number
      pourId?: string
      alternateBays?: boolean
    }
    for (const shutter of element.shutters) {
      const targets = new Set<StrikeTarget>()
      for (const part of shutter.parts) {
        if (part.omitted) continue
        const target = strikeTargetForPartKind(part.kind, hostKind, (part as { use?: string }).use)
        if (target !== undefined) targets.add(target)
      }
      const striking = [...targets]
        .map((target) => periods.get(target))
        .filter((time): time is StrikingTime => time !== undefined)
      const id = shutter.assembly.id as string
      pours.push({
        id,
        ...(shutter.assembly.pourAt === undefined ? {} : { pourAt: shutter.assembly.pourAt }),
        striking,
      })
      sequenceable.push({
        id,
        elementId: element.host.id as string,
        // Defaulted to the bottom lift of the only segment where the assembly says nothing, which
        // is what an unsplit element is: one pour at the base. A missing index left absent would
        // put every shutter on the element in one chain and invent a bearing between them.
        segmentIndex: shutter.assembly.segmentIndex ?? 0,
        liftIndex: shutter.assembly.liftIndex ?? 0,
        ...(host.castOrder === undefined ? {} : { castOrder: host.castOrder }),
        ...(host.pourId === undefined ? {} : { pourId: host.pourId }),
        // The element's own statement overrides the project's, so an element can be the
        // one alternate-bay wall on a job that is not, or opt out on a job that is.
        ...(host.alternateBays === undefined && settings.pours?.alternateBays === undefined
          ? {}
          : { alternateBays: host.alternateBays ?? settings.pours?.alternateBays === true }),
      })
      committable.push({
        id,
        ...(shutter.assembly.pourAt === undefined ? {} : { pourAt: shutter.assembly.pourAt }),
        ...(shutter.assembly.committedPourAt === undefined
          ? {}
          : { committedPourAt: shutter.assembly.committedPourAt }),
      })
      // Through `bomLines` rather than counting parts directly, so a shutter's quantities are
      // the same arithmetic as the bill's — a consumable is measured in its own unit and a
      // part can stand for more than one item, and `partQuantity` is where that lives.
      //
      // Only returnable lines: a cut board is made for this pour and a drum of release agent
      // is used up in it, and neither is stock a set is counted out of. Reported as reused
      // they would say a board serves five pours.
      pourQuantities.push({
        id,
        quantities: bomLines(shutter.parts)
          .filter(isReturnableLine)
          .map((line) => {
            const target = strikeTargetForPartKind(line.kind, hostKind)
            return {
              catalogId: line.catalogId as string,
              kind: line.kind,
              description: line.description,
              quantity: line.quantity,
              ...(target === undefined ? {} : { target }),
            }
          }),
      })
    }
  }
  // Absent where nothing is dated, rather than a programme of empty rows: a takeoff for a
  // project nobody has programmed should carry no calendar at all, the same way it carries
  // no money until a rate exists.
  const schedule = formworkSchedule(pours, settings.schedule)
  const anyDated = schedule.scheduledCount > 0
  // Off the schedule rather than beside it, so a peak cannot fall on a day the programme
  // above it does not have. Absent where the programme is too partial to sweep, which is the
  // module's own refusal rather than a condition tested here.
  const sets = anyDated ? formworkSetCount(schedule, pourQuantities) : undefined
  // Both inputs are the solution's own, so this cannot disagree with the peak printed above
  // it — and `ownedStock` rather than `supply` because the acquisition compares against the
  // rack itself, while the split has already spent it line by line.
  const acquisition =
    sets && settings.ownedStock
      ? formworkAcquisition(sets, settings.ownedStock, settings.rates)
      : undefined
  // Off the same schedule, so a float cannot be measured against a date the programme above it
  // does not have. Only where something is dated: precedence without dates is a graph with no
  // float in it, and reporting the edges alone would put a dependency list on a panel whose every
  // allowance column is blank.
  const sequence = anyDated ? formworkSequence(sequenceable, schedule) : undefined
  // Off the same schedule and the same walk, so a window cannot be swept over a date the
  // programme above it does not have. Unlike `sets` this has no coverage threshold: one pour
  // somebody has booked is a real booking, and there is no peak here to be plausibly small.
  //
  // Not gated on `anyDated` either, which every other block here is. A booking outlives the date
  // it was made against — clear the last date on the job and the plant is still reserved, which
  // is the one state in this whole feature nothing else would report. The module's own "nobody
  // has committed" refusal is the only condition.
  const commitments = formworkCommitments(schedule, pourQuantities, committable)
  // The one output derived from three others — four now. Every input is this solution's own, so
  // a proposed move cannot be compared against a peak the reader is not looking at, and cannot
  // offer to move a pour the windows above it report as booked.
  // Off `everyPart` rather than off `bom`, because a nest needs the pieces and the bill has
  // grouped them: four boards of one size are one line with a quantity of four, and nesting the
  // line would place one board and buy a sheet for it. Not a second sweep of the scene — the same
  // array the bill was built from.
  //
  // Where the scope is one repeated floor, the nest covers one cycle's boards and the counts
  // are the purchase for the whole repetition — see `repeatedFloorCycle` and 6.4.
  const repeatedFloor = repeatedFloorCycle(elements)
  const sheetLives: Record<string, number> = {}
  for (const id of settings.sheets?.stockIds ?? []) {
    const uses = settings.rates?.byCatalogId[id]?.expectedUses
    if (uses !== undefined) sheetLives[id] = uses
  }
  const cutList = settings.sheets
    ? formworkCutList(
        repeatedFloor.cycles > 1 && repeatedFloor.parts ? repeatedFloor.parts : everyPart,
        settings.sheets,
        {
          ...(repeatedFloor.cycles > 1 ? { cycles: repeatedFloor.cycles } : {}),
          ...(Object.keys(sheetLives).length > 0 ? { sheetLives } : {}),
        } satisfies FormworkCutListOptions,
      )
    : undefined
  const resequence =
    sequence && acquisition && acquisition.shortfalls.length > 0
      ? formworkResequence(
          acquisition,
          schedule,
          pourQuantities,
          sequence,
          committedPourIds(committable),
        )
      : undefined

  return {
    elements,
    bom,
    totalWeightKg: weight.totalKg,
    totalWeightComplete: weight.complete,
    ...(supply ? { supply } : {}),
    hire,
    // Priced from the split and the periods above rather than from a second pass over the
    // parts, so a cost and the quantity it prices cannot disagree. `supply` is passed
    // through as it stands, including absent: a project with rates and no stock list has
    // said it owns none of this, which is a different claim from having said nothing.
    // The schedule goes in for the finance figure only: the spend-to-recovery period is
    // the programme's own span, and a cost that is outside the cash total still has to
    // say what it was computed over.
    ...(settings.rates
      ? { cost: bomCost(bom, settings.rates, hire, supply, anyDated ? schedule : undefined) }
      : {}),
    // Off the same bill as the money, so the hours and the price are counted over the same
    // quantities. The bill is the right multiplicand for a reason worth stating where it is
    // used: a project bill is built from every shutter's parts, so a panel type fitted on
    // three pours is already three in the quantity — total fittings rather than panels
    // owned, which is what a gang is paid for.
    ...(settings.labour ? { labour: bomLabour(bom, settings.labour) } : {}),
    ...(anyDated ? { schedule } : {}),
    ...(sets ? { sets } : {}),
    ...(acquisition ? { acquisition } : {}),
    ...(sequence ? { sequence } : {}),
    ...(resequence ? { resequence } : {}),
    ...(commitments ? { commitments } : {}),
    ...(lifts ? { lifts } : {}),
    // Off the weight and the picks above rather than a second sweep of either, so the lorries
    // are counted from the same tonnage the takeoff prints and the hook time from the same
    // schedule the crane was checked against. `lifts` is passed through as it stands,
    // including absent: a conventional shutter has nothing to lift as an assembly, which does
    // not touch the delivery half of the answer.
    ...(settings.logistics
      ? {
          logistics: formworkLogistics(
            { totalKg: weight.totalKg, complete: weight.complete },
            lifts,
            settings.logistics,
            settings.rates,
          ),
        }
      : {}),
    ...(cutList ? { cutList } : {}),
    strikingStandardSubstituted: isSubstitutedStrikingStandard(settings.pressureStandard),
    incomplete: elements.filter((element) => !element.coversWholePour),
    beyondCapacityMarks,
    shutterCount: elements.reduce((total, element) => total + element.shutters.length, 0),
    rejected,
    ...(pourPlan.elements.length > 0 || pourPlan.conflicts.length > 0 ? { pours: pourPlan } : {}),
  }
}

/**
 * What makes this takeoff wrong, in words, or nothing.
 *
 * Shared by the panel, the CSV and the chat tool so all three warn identically —
 * three phrasings of one fault is how a user comes to believe two of them are
 * different problems. Each line names its element, because "the takeoff is short"
 * without saying where is not actionable.
 */
export function projectFormworkCaveats(solution: ProjectFormwork): string[] {
  const out: string[] = []
  for (const element of solution.incomplete) {
    const shutters = element.shutters.length
    const units = element.pourUnitCount
    out.push(
      shutters < units
        ? `${element.host.id} is cast in ${units} pours and formed for ${shutters} — this bill is short by the difference.`
        : `${element.host.id} has ${shutters} shutters for ${units} ${units === 1 ? 'pour' : 'pours'} — this bill counts formwork for a pour it no longer has.`,
    )
  }
  out.push(...unformableCaveats(solution.rejected))
  if (solution.beyondCapacityMarks.length > 0) {
    const count = solution.beyondCapacityMarks.length
    out.push(
      `${count} ${count === 1 ? 'part is' : 'parts are'} beyond capacity — a bill for a shutter that does not stand up is not an order to place.`,
    )
  }
  if (!solution.totalWeightComplete && solution.bom.length > 0) {
    out.push(
      'Some parts have no published weight, so the total is the sum of those that do — not the lifting weight of the set.',
    )
  }
  // Straight after the weight, because that is the sentence these are most often read against:
  // the bill's tonnage is what passes through the job and a pick is one hook load, and a reader
  // who has just been told the total is incomplete is the reader about to size a crane on it.
  if (solution.lifts) out.push(...formworkLiftCaveats(solution.lifts))
  // The weakest verification across the bill, reported as one sentence naming the lines at
  // that level (8.3). This is the takeoff's own fold: every line carries the level its catalog
  // values were built from, and a total resting on a secondary or unverified number is a number
  // a reader must not sign. Beside the weight and the lifting sentences, because it is the same
  // kind of claim — a figure that is a floor rather than an answer. Absent where every line is
  // certified: a fully certified takeoff is told nothing, which is the point of the fold.
  const note = takeoffVerificationNote(solution)
  if (note !== undefined) out.push(note)
  if (solution.supply && solution.supply.ownedQuantity > 0) {
    out.push(
      'The owned/hired split is for this scope alone. The same owned stock serves the next pour once it is stripped, so two scopes’ owned figures are not a total.',
    )
  }
  if (solution.supply && solution.supply.hiredModifiedQuantity > 0) {
    const count = solution.supply.hiredModifiedQuantity
    out.push(
      `${count} hired ${count === 1 ? 'part is' : 'parts are'} drilled or cut for this pour — expect a recharge at list price, not a hire charge.`,
    )
  }
  if (solution.strikingStandardSubstituted) {
    out.push(
      'DIN 18218 publishes no striking periods, so the hire durations below are BS 8110 Table 6.2’s — a substitution across code families, not this project’s own code.',
    )
  }
  // Verbatim from the striking solve rather than rephrased here, so a figure and the
  // reason it may be wrong travel together. The accumulator warning is the one that
  // matters most: under ACI these are qualifying hours above 10 °C, so a reader who
  // takes "4 days" off a cold-spring programme strikes early.
  for (const warning of solution.hire.warnings) out.push(warning.message)
  for (const entry of solution.hire.mixedLines) {
    out.push(`${entry.line.description}: ${entry.mixed?.message}`)
  }
  // Verbatim from the cost pass for the same reason the striking warnings are. Every one
  // of these makes the total a floor rather than a price, and a money figure is the one
  // number in this whole takeoff a reader will quote without reading anything beside it.
  if (solution.cost) out.push(...bomCostCaveats(solution.cost))
  // Straight after the money, because the pair is the point: the cost caveat says labour is
  // outside it and is normally the largest thing that is, and this is that thing.
  if (solution.labour) out.push(...bomLabourCaveats(solution.labour))
  // And where there are no norms, the absence said out loud rather than left as a missing
  // block — but only where the project has priced something, because a takeoff with no money
  // in it at all is already telling the reader that, and two silences about one job read as
  // two problems.
  else if (solution.cost) {
    out.push(
      'There is no labour in this takeoff at all, because the project has stated no output norms. That is the largest thing missing from the figures above, and it is deliberately not estimated: published constants are per m² of a whole trade operation and cannot be spread over a bill of parts, and an output is a fact about a gang rather than about a product. Record man-hours to erect and to strike per kind of part, and a rate per man-hour, to get it.',
    )
  }
  // Third in the same run, because the cost caveat names three things outside it and this is
  // two of them: labour above, transport and craneage here. Finance is what is left.
  if (solution.logistics) out.push(...formworkLogisticsCaveats(solution.logistics))
  else if (solution.cost) {
    out.push(
      'There is no transport and no craneage in this takeoff, because the project has recorded neither what one lorry carries nor how long a pick takes. Both are facts about the job’s own plant rather than about a product, so nothing is assumed. Record a lorry payload and the minutes one pick takes, with a charge per load and an hourly crane rate, to get them.',
    )
  }
  // Last of the run that says what is outside the money, and the only one of them that is not a
  // cost at all: the sheets the ply came out of. It goes here rather than beside the bill because
  // a reader who has just been told what is *in* the total is the reader about to add a ply order
  // to it, and the first sentence of these caveats is that the boards are already billed.
  if (solution.cutList) out.push(...formworkCutListCaveats(solution.cutList))
  // Only where there is cut ply to nest and no sheet stated. A steel-panel job has nothing to cut
  // and is owed no sentence about sheets, which is why this reads the bill rather than the
  // settings: `cutList` absent means either, and only one of the two is a state to act on.
  else if (solution.bom.some((line) => line.kind === 'ply-piece')) {
    out.push(
      'There is no cut list in this takeoff, because the project has not said which sheet its ply is bought in. The cut boards are billed above as areas, and how many sheets they come out of depends entirely on the sheet: 1220 × 2440 and 1250 × 2500 give the same wall different counts. Record the sheet stock the yard buys with set_formwork_settings sheets to get it.',
    )
  }
  // Verbatim again, and the qualifying-time line is the one that earns its place: under
  // ACI the strike dates are the earliest the forms could come off rather than the dates,
  // and a reader who takes a cold-spring programme off a summer calculation strikes early.
  if (solution.schedule) out.push(...formworkScheduleCaveats(solution.schedule))
  if (solution.sets) out.push(...formworkSetCaveats(solution.sets))
  // The refusal said out loud, because a reader who has seen a set count on one takeoff and
  // sees none on this one is owed the reason. Only where there is a programme at all: a
  // project that has dated nothing is already told that by the schedule's own absence, and
  // repeating it here would make one missing input read as two problems.
  else if (solution.schedule) {
    const dated = solution.schedule.scheduledCount
    const total = solution.schedule.pours.length
    out.push(
      `No set count: ${dated} of ${total} pours are dated, which is too few to sweep. Counting sets over part of a programme reports a peak the job never has, and it comes out low — so there is no figure here rather than a small one. Date the remaining pours to get it.`,
    )
  }
  if (solution.acquisition) out.push(...acquireCaveats(solution.acquisition))
  // The other half of the same refusal, and it needs its own sentence because the remedy is
  // different: a set count with nothing to compare it against is a rack nobody has recorded,
  // not a programme nobody has dated. Only where there *is* a count, so a project missing
  // both inputs is told about the dates once rather than about two separate absences.
  else if (solution.sets) {
    out.push(
      'Nothing here says what to buy or hire: the peak above is what the job needs at once, and no rack is recorded to compare it against. That is not a yard that owns nothing — record what it owns with set_formwork_settings ownedStock and the shortfall follows.',
    )
  }
  // After the acquisition, because a move is the alternative to acquiring and reads as one only
  // once the reader knows what is short. Both sets of caveats, and the sequence's first: "this is
  // not a critical path" has to arrive before any figure that was derived from the float.
  if (solution.sequence) out.push(...formworkSequenceCaveats(solution.sequence))
  if (solution.resequence) out.push(...resequenceCaveats(solution.resequence))
  // Last, because every figure above it is what the job needs and this is the smaller number
  // that has actually been agreed — read the other way round, a reader takes the committed
  // quantity for the requirement and orders short by every uncommitted pour.
  if (solution.commitments) out.push(...formworkCommitmentCaveats(solution.commitments))
  // The pour plan's conflicts, where a stated permitted set could not satisfy a split —
  // a boundary the solver had to place where none was permitted. Late, because it
  // contradicts a design figure the reader has just been walked through, and it needs
  // the whole plan behind it to read as the conflict it is rather than as a complaint.
  if (solution.pours) out.push(...formworkPoursCaveats(solution.pours))
  return out
}

/**
 * The takeoff's weakest verification level as one sentence, or `undefined` where
 * every line is certified.
 *
 * The one wording for the takeoff's verification claim, so the caveats list, the CSV,
 * and every printed document state it in the same terms (8.5). A document carries its
 * figures' level on its own face rather than only in the application that made it,
 * because the printed sheet is what gets emailed on.
 */
export function takeoffVerificationNote(solution: ProjectFormwork): string | undefined {
  const levels = solution.bom
    .map((line) => line.verification)
    .filter((level) => level !== undefined)
  const weakest = weakestVerification(levels as Verification[])
  if (weakest === undefined || weakest === 'certified') return undefined
  const atLevel = solution.bom.filter((line) => line.verification === weakest)
  const names = atLevel.map((line) => line.catalogId ?? line.description).slice(0, 5)
  const label: Record<Exclude<Verification, 'certified'>, string> = {
    derived: 'derived by a stated method from cited values',
    secondary: "read off a dealer or secondary listing rather than the manufacturer's own table",
    unverified:
      'unverified — arrived at by stated reasoning with nothing published to check it against',
  }
  return `The ${names.length === 1 ? 'line' : 'lines'} ${names.join(', ')} ${names.length === 1 ? 'is built from values that are' : 'are built from values that are'} ${label[weakest]}. The takeoff as a whole is ${weakest}, so its figures carry that level until the cited document is transcribed.`
}

/** The elements a scope names, for a caller that only needs the count. */
export function castableHostIds(
  nodes: Record<string, AnyNode>,
  scope: ProjectFormworkScope = {},
): AnyNodeId[] {
  return hostsInScope(nodes, scope).map((host) => host.id as AnyNodeId)
}
