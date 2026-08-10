import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock'
import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import {
  ATTACH_FORMWORK_DESCRIPTION,
  applyConstructionPatch,
  applyFormworkPartPatch,
  applyFormworkSettingsPatch,
  applyPourDatePatch,
  applyPourLimitsPatch,
  COST_GAP_LABELS,
  castableElementSummary,
  constructionPatchInput,
  describeFormworkReconciliation,
  describePourSplit,
  findFormworkSettingsNode,
  formworkPartPatchInput,
  formworkPartsQueryInput,
  formworkSettings,
  formworkSettingsPatchInput,
  formworkSettingsReport,
  INSPECT_FORMWORK_PARTS_DESCRIPTION,
  INSPECT_FORMWORK_SETTINGS_DESCRIPTION,
  INSPECT_POUR_UNITS_DESCRIPTION,
  LIST_CASTABLE_ELEMENTS_DESCRIPTION,
  noFormworkAssembly,
  noFormworkTypeSet,
  POUR_CUT_REASON_LABELS,
  partByMark,
  partLabel,
  pourDatePatchInput,
  pourLimitsPatchInput,
  SCHEDULE_GAP_LABELS,
  SET_COUNT_GAP_LABELS,
  SET_ELEMENT_CONSTRUCTION_DESCRIPTION,
  SET_FORMWORK_PART_DESCRIPTION,
  SET_FORMWORK_SETTINGS_DESCRIPTION,
  SET_POUR_DATE_DESCRIPTION,
  SET_POUR_LIMITS_DESCRIPTION,
  scheduleInPourOrder,
  scheduleOccupancyDays,
  unknownAssembly,
  unknownPartMark,
  validationSummary,
} from '@pascal-app/core/formwork'
import type { AnyNode, FormworkAssemblyNode } from '@pascal-app/core/schema'
import { buildSolverJointNodes } from '@pascal-app/nodes/construction-joint/headless'
import {
  castableHostIds,
  formworkCoverageCaveat,
  formworkPartsReport,
  pourUnitsForHost,
  projectFormworkCaveats,
  reconcileFormworkNodes,
  solveProjectFormwork,
  solveShuttersForHost,
  validateProjectFormwork,
} from '@pascal-app/nodes/formwork-assembly/headless'
import { generateText, isStepCount, type ModelMessage, tool } from 'ai'
import { z } from 'zod'

const MODEL_ID = process.env.BEDROCK_MODEL_ID ?? 'us.anthropic.claude-sonnet-5'

export const SYSTEM_PROMPT =
  'You are the construction AI inside the Pascal editor. You can inspect the walls, columns and ' +
  'slabs in the currently open scene and set their formwork/construction properties. Ask the user ' +
  'for any values you are missing before calling set_element_construction — do not guess ' +
  'load-bearing engineering values silently. ' +
  'Nothing is formed until formworkType names a system: a column or a slab with no formworkType ' +
  'is not shuttered on the user’s behalf. ' +
  'attach_formwork generates the assembly the kind actually needs, which is a different machine ' +
  'per kind. A wall gets shutter panels and walers on BOTH faces (concrete pushes outward on both ' +
  "sides — a single-face shutter isn't real) with through-ties clamping them together. A column " +
  'gets a self-reacting clamped box of four panels — or a wrapped shaft for a round or many-sided ' +
  'one — with no ties through the concrete at all. A slab gets a decked soffit on joists, propped ' +
  'off the floor below, plus edge forms around its rim; for a slab the soffit is the big number, ' +
  'not the sides. Faces that butt concrete already cast are not formed, so a wall between ' +
  'earlier-cast columns gets two sides and no stop-ends, and a column in the plane of a wall loses ' +
  'the faces embedded in it — that follows from castOrder, so ask about pour sequence rather than ' +
  'assuming everything is freestanding. ' +
  'Ask whether scaffold access is needed (tall pours) before deciding scaffoldRequired; set it via ' +
  'set_element_construction before calling attach_formwork. After setting formworkType to ' +
  'something other than none, call attach_formwork so the assembly actually appears in the scene. ' +
  'A tall or long wall or column is not cast in one go: set_pour_limits splits it into pour units, ' +
  'each of which is one shutter erected, poured and struck on its own, with a construction ' +
  'joint between them. A slab is one pour unit — bay-splitting it is a polygon partition, not a ' +
  'cut along a centreline, so the length and volume caps do not apply to it. inspect_pour_units ' +
  'explains that split and its concrete volumes. Do ' +
  'not invent lift heights or bay lengths — they come from tie capacity, the pressure ' +
  'envelope, and the batch-plant supply rate, so ask. ' +
  'One thing is set for the whole project rather than per element: the pour itself. The rate of ' +
  'rise, the concrete temperature, the mix, the binder, the pressure code and the parts catalog ' +
  'are decisions about a job, not about a wall — the concrete arrives from one plant at one ' +
  'temperature and the design code follows the contract. Read them with ' +
  'inspect_formwork_settings before quoting any pressure, tie spacing or prop spacing, because ' +
  'that tool also tells you which figures the project stated and which the engine assumed: a ' +
  'pressure derived from an assumed 7 m/h at 20 °C is not a number the job has agreed to, and you ' +
  'should say so rather than present it as one. Write them with set_formwork_settings, and ask for ' +
  'the rate of rise, the temperature and the code rather than guessing — the entire design hangs ' +
  'off those three. Changing them re-designs every shutter in the scene on its own, so do not ' +
  'offer to regenerate anything — just re-read the parts before repeating a figure you already ' +
  'quoted. What does need a follow-up is set_pour_limits: it changes how many shutters an element ' +
  'needs without building them, so call attach_formwork afterwards. Until you do, the element is ' +
  'cast in more pours than it is formed for and every quantity you read is short by the ' +
  'difference — inspect_formwork_parts reports this as coverageCaveat, and if it is set, lead with ' +
  'it rather than with the bill. ' +
  'A shutter is made of individual parts, and inspect_formwork_parts is the only figure that ' +
  'agrees with what the user can see: the parts come out of the same pass that draws the 3D ' +
  'shutter, so never count panels, ties or props from the spacings yourself. Every part has a mark ' +
  'derived from its own position, so a mark stays put when the scene is re-solved and you can ' +
  'quote one to the user. Say whether a weight total is complete — several catalog entries publish ' +
  'a range rather than a figure, and a total missing those is not the lifting weight of the set. ' +
  'A part beyond capacity is a stop, not a note: do not present a bill for a shutter that does not ' +
  'stand up. ' +
  'One element is rarely the question. A yard orders the formwork for a floor, not for a wall, and ' +
  'two per-element bills cannot be added together afterwards — the same panel type on two walls is ' +
  'one line on a delivery note. So for anything about a level, a project, a total weight or what to ' +
  'order, call inspect_project_formwork once rather than inspect_formwork_parts per element, and ' +
  'scope it with levelId when the user means a floor. It also names the elements in scope with no ' +
  'shutter at all, which is the usual reason a total is lower than expected and is invisible in a ' +
  'bill of what exists. Its caveats are the same warnings the user sees in the Takeoff panel: lead ' +
  'with them, because each one means every figure under it is short or long in a way none of the ' +
  'figures reveal. ' +
  'What a bill costs depends on whose formwork it is, and that is a question the scene cannot ' +
  'answer until somebody records the yard’s stock with set_formwork_settings ownedStock. Do that ' +
  'when the user talks about hire, and never assume either way in the meantime: a project that has ' +
  'recorded nothing has not said its formwork is all hired, so report the split as unavailable ' +
  'rather than as everything on hire. Once it is recorded, the answer per line is a split rather ' +
  'than a label, because ownership is a pool — owning 200 of a panel and needing 260 hires 60. Two ' +
  'things about it are counterintuitive and worth saying out loud: the split is per scope, since ' +
  'the same owned panels serve the next pour once stripped, so two levels’ owned figures must not ' +
  'be added; and a hired panel this pour drills is recharged at list rather than charged as hire, ' +
  'which is the one figure in a bill that costs money without appearing as a cost. ' +
  'Money works the same way and is stricter about it. A rate is the only input in this whole ' +
  'model that no code publishes and no product carries — the same panel is different money to two ' +
  'yards in the same city and different again next quarter — so nothing is ever assumed for one. ' +
  'Where the project has recorded rates with set_formwork_settings rates, inspect_project_formwork ' +
  'prices the bill and every line carries its share; where it has not, cost is simply absent and ' +
  'there is no price in the answer. Say that rather than deriving one, and never multiply a period ' +
  'by a rate of your own: a figure you invented is indistinguishable from a real one once you have ' +
  'said it, and it ends up in a tender. Ask for the list price and the hire terms rather than ' +
  'guessing them, the way you ask for the rate of rise. Three things to carry when there is a ' +
  'price: the total is a floor whenever cost.complete is false, because some line could not be ' +
  'priced; daysCharged rather than daysHeld is what reconciles with an invoice, since a wall form ' +
  'struck in 12 hours against a 28-day minimum is charged for 28 days and the remedy is pouring ' +
  'more with the same set rather than striking sooner; and cost.excludes is not boilerplate — this ' +
  'is what the formwork costs to hold, not the cost of forming the job, so labour, transport, ' +
  'finance and the project’s own owned stock are all outside it and labour is normally the largest ' +
  'of them. ' +
  'A period is not a date, and the gap between them is where a delivery is booked. A striking ' +
  'table says a wall form comes off in 12 hours; only a pour date says which morning the set has ' +
  'to be on site and which afternoon it is free for the next pour. So a pour date is recorded per ' +
  'shutter rather than per element — a 9 m wall in three lifts is three pours a week apart, and a ' +
  'date on the wall could only be one of them — and it is stated, never derived. Nothing in this ' +
  'model computes a programme from dependencies or float, so if the user has not dated a pour ' +
  'there is no schedule in the answer: say that and ask for the dates rather than reading the ' +
  'order the shutters happen to be in as a sequence. A programme you inferred sits beside geometry ' +
  'that really is derived and carries the same authority, which is how it ends up on a site notice ' +
  'board. Two lead times turn the dates into a delivery: how many days before a pour the plant is ' +
  'wanted, and how many after striking before it is back with the hire company — both on the ' +
  'project with set_formwork_settings schedule, both calendar days rather than working days ' +
  'because a hire is charged over a weekend. Ask for them the way you ask for a rate. ' +
  'A bill is not an order, and the difference is reuse. What a takeoff lists is everything that ' +
  'passes through the job; what somebody buys or hires is what stands at the same time, and the ' +
  'same panel struck and refitted eight times is one panel on a delivery note and eight lines of ' +
  'a bill. So when the user asks what to order, what to buy or what to hire, the answer is the ' +
  'set count in inspect_project_formwork rather than the bill — quoting the bill overstates it by ' +
  'the reuse factor, which on a repetitive frame is most of the number. The count needs the pour ' +
  'dates, because whether two pours share a set is a question about when they happen, so a ' +
  'project that has dated few of its pours gets no count at all rather than a low one: that is a ' +
  'deliberate refusal, not a gap to fill in, and the remedy is set_pour_date on the shutters that ' +
  'have no date. Nothing in this model says one pour follows another either — the dates are a ' +
  'calendar and not a sequence — so there is no float, no critical path and no answer to "can ' +
  'this be resequenced to need fewer sets". Say so rather than working one out. ' +
  'A bill being right does not make the shutter buildable, and the two have almost no ' +
  'overlap in what makes them wrong. validate_formwork answers the second question: cycles ' +
  'in the cast order, runs with a stretch no panel closes, walls no tie in the system reaches, ' +
  'piers beside an opening no drilled tie hole falls in, corners no hinged unit sweeps, ties ' +
  'drilled through a waterstop, pours over what one delivery can supply. Run it before you ' +
  'present a takeoff as something to order, and keep its two severities apart — an error is a ' +
  'thing the crew cannot do, a warning is an exception somebody has to sign, and one merged ' +
  'count of both tells the reader neither. Report its notChecked as well: several assertions ' +
  'need data this scene has no schema for, and a list of failures with the unchecked ones ' +
  'silently absent is how a user comes to believe the shutter was compared against rebar it ' +
  'was never compared to. ' +
  'set_formwork_part records the two decisions a yard actually makes about a solved ' +
  'layout — substitute this item, or leave it off the order because it is already on site. It ' +
  'cannot change a size or a spacing; those are outputs, and to change them you change the design ' +
  'inputs and re-solve. Ask before substituting, because a panel from another manufacturer will ' +
  'not line up with this system’s tie holes. Keep replies short.'

const bedrock = createAmazonBedrock({ region: process.env.AWS_REGION ?? 'us-east-1' })

/** Shared Bedrock model instance — used by the streaming chat route, `runChatTurn`, and the construction-plan workflow step. */
export const MODEL = bedrock(MODEL_ID)

export type ChatTurn = { role: 'user' | 'assistant'; text: string }

export type ChatResult = {
  reply: string
  toolCalls: Array<{ name: string; input: unknown }>
  mutated: boolean
}

/** The kinds that get cast and therefore shuttered. Everything else has no formwork to speak of. */
const CASTABLE_TYPES = ['wall', 'column', 'slab'] as const

type CastableType = (typeof CASTABLE_TYPES)[number]
type CastableGraphNode = AnyNode & { type: CastableType }

function isCastable(node: AnyNode | undefined): node is CastableGraphNode {
  return node !== undefined && (CASTABLE_TYPES as readonly string[]).includes(node.type)
}

/**
 * Runs tool calls directly against the plain JSON scene graph (the same
 * shape the store persists) instead of the live browser Zustand store —
 * `@pascal-app/core`'s store module is `'use client'`, which Next.js's
 * Route Handler bundler turns into a client-reference stub when bundled
 * for the server. Operating on plain objects sidesteps that entirely.
 *
 * Tool functions build fresh per call (closing over `graph`/`toolCalls`/
 * `mutated`) so each `runChatTurn` invocation is independent — no shared
 * module-level state across concurrent requests.
 *
 * Exported so `workflows/construction-package.ts` can reuse the same
 * tool set inside a durable workflow step instead of redefining it.
 */
export function buildTools(
  graph: SceneGraph,
  toolCalls: ChatResult['toolCalls'],
  onMutate: () => void,
) {
  /** The element, or the error string the model should read back. Kept in one place so every tool rejects the same way. */
  const castableOrError = (elementId: string): CastableGraphNode | string => {
    const node = graph.nodes[elementId as keyof typeof graph.nodes] as AnyNode | undefined
    if (!isCastable(node)) {
      return `Error: No wall, column or slab found with id ${elementId}`
    }
    return node
  }

  /**
   * The scene's settings node, created on first write and parented to the site.
   *
   * Parenting matters as much here as in the panel: the store's loader sweeps any
   * node whose parent is not in the scene, so an unparented settings node written by
   * the AI would survive the reply and vanish when the graph is next loaded — the
   * project's pour reverting to the defaults with nothing to show it ever changed.
   *
   * Returns the error string rather than throwing when there is no site, which is a
   * scene the model can still be told about.
   */
  const settingsNodeOrError = (): Record<string, unknown> | string => {
    const nodes = Object.values(graph.nodes) as AnyNode[]
    const existing = findFormworkSettingsNode(nodes)
    if (existing) return existing as unknown as Record<string, unknown>
    const site = nodes.find((node) => node.type === 'site')
    if (!site) return 'Error: this scene has no site, so there is nowhere to store project settings'
    const created = {
      object: 'node',
      // Not `generateId`: that reads a browser-side counter, and these tools run on
      // the server against a plain graph. The kind prefix is what the schema checks.
      id: `formwork-settings_${Object.keys(graph.nodes).length}_${site.id}`,
      type: 'formwork-settings',
      parentId: site.id,
      visible: true,
      metadata: {},
      children: [],
    }
    graph.nodes[created.id as keyof typeof graph.nodes] = created as unknown as AnyNode
    ;(site as unknown as { children?: string[] }).children = [
      ...((site as unknown as { children?: string[] }).children ?? []),
      created.id,
    ]
    return created as unknown as Record<string, unknown>
  }

  /**
   * How many shutters a settings change re-designs.
   *
   * Counted so the reply can say what the change reached, not so anything is
   * rebuilt: a shutter's parts and its design report are both solved from the
   * settings at the moment they are read, so the new pour is already in every
   * figure. The number is there because a settings change that reports nothing
   * reads as a settings change that did nothing.
   */
  const scenewideShutterCount = (): number =>
    (Object.values(graph.nodes) as AnyNode[]).filter((n) => n.type === 'formwork-assembly').length

  /** This host's shutters, by `parentId` — the relation, not the child list. */
  const shuttersOnHost = (hostId: string): FormworkAssemblyNode[] =>
    (Object.values(graph.nodes) as AnyNode[])
      .filter((n) => n.type === 'formwork-assembly' && n.parentId === hostId)
      .map((n) => n as unknown as FormworkAssemblyNode)

  /**
   * Whether this element's shutters still match how it is cast, in words the
   * model can pass on.
   *
   * The sentence is shared with the MCP surface, because a pour limit changed there
   * and read back here has to be reported as the same fault: two phrasings of one
   * short takeoff is how a user comes to believe there are two.
   */
  const shutterMismatch = (elementId: string, unitCount: number): string | undefined =>
    formworkCoverageCaveat(elementId, shuttersOnHost(elementId).length, unitCount)

  return {
    list_castable_elements: tool({
      description: LIST_CASTABLE_ELEMENTS_DESCRIPTION,
      inputSchema: z.object({}),
      execute: async () => {
        toolCalls.push({ name: 'list_castable_elements', input: {} })
        // Core's summary, shared with the MCP surface: a field visible to one AI and
        // hidden from the other is a decision the second one asks the user to restate.
        const elements = (Object.values(graph.nodes) as AnyNode[])
          .filter(isCastable)
          .map((node) => castableElementSummary(node))
        return JSON.stringify(elements)
      },
    }),
    set_element_construction: tool({
      description: SET_ELEMENT_CONSTRUCTION_DESCRIPTION,
      inputSchema: z.object(constructionPatchInput),
      execute: async ({ elementId, ...fields }) => {
        toolCalls.push({ name: 'set_element_construction', input: { elementId, ...fields } })
        const element = castableOrError(elementId)
        if (typeof element === 'string') return element
        const result = applyConstructionPatch(element.type, element.formworkType, fields, elementId)
        if (result.error !== undefined) return result.error
        for (const [key, value] of Object.entries(result.writes)) {
          // An explicit `undefined` deletes rather than stores: an unstated spacing is
          // what encodes "solve this from the pour", so a key holding undefined would
          // serialise as a stated null.
          if (value === undefined) delete (element as Record<string, unknown>)[key]
          else (element as Record<string, unknown>)[key] = value
        }
        onMutate()
        // Naming a system builds nothing, so the reply names the call that does. Without
        // it the project believes it specified a steel-panel wall and holds no shutter.
        return result.formingTurnedOn && shuttersOnHost(elementId).length === 0
          ? `ok — ${result.changed.join(', ')}. Nothing is built yet: call attach_formwork on ${elementId} to raise the shutter.`
          : `ok — ${result.changed.join(', ')}`
      },
    }),
    attach_formwork: tool({
      description: ATTACH_FORMWORK_DESCRIPTION,
      inputSchema: z.object({ elementId: z.string() }),
      execute: async ({ elementId }) => {
        toolCalls.push({ name: 'attach_formwork', input: { elementId } })
        const element = castableOrError(elementId)
        if (typeof element === 'string') return element
        if (element.formworkType === undefined || element.formworkType === 'none') {
          return noFormworkTypeSet(elementId)
        }
        const levelNodes = Object.values(graph.nodes) as AnyNode[]
        const host = element as unknown as Parameters<typeof reconcileFormworkNodes>[0]
        // Reconciled, not appended. Called twice this used to leave two copies of
        // every shutter — a doubled bill, duplicate marks, and a part somebody had
        // marked "already on site" quietly re-ordered on the copy. And a settings
        // change tells the model to call it again, so the second call is the
        // expected case rather than the mistake.
        const existing = shuttersOnHost(elementId)
        const { create, keep, orphan } = reconcileFormworkNodes(host, existing, levelNodes)
        const discarded = orphan.reduce(
          (total, assembly) => total + Object.keys(assembly.partOverrides ?? {}).length,
          0,
        )
        for (const assembly of orphan) {
          delete graph.nodes[assembly.id as keyof typeof graph.nodes]
          element.children = (element.children ?? []).filter((id) => id !== assembly.id)
        }
        for (const assembly of create) {
          graph.nodes[assembly.id as keyof typeof graph.nodes] = assembly as unknown as AnyNode
          element.children = [...(element.children ?? []), assembly.id]
        }
        // Each cut between pour units is a real construction joint carrying
        // roughening and starter bars, so it has to exist as a node or the work
        // is invisible to the takeoff.
        const joints = buildSolverJointNodes(host, levelNodes)
        for (const joint of joints) {
          graph.nodes[joint.id as keyof typeof graph.nodes] = joint as unknown as AnyNode
          const level = joint.parentId
            ? (graph.nodes[joint.parentId as keyof typeof graph.nodes] as
                | { children?: string[] }
                | undefined)
            : undefined
          if (level) level.children = [...(level.children ?? []), joint.id]
        }
        onMutate()

        // Core's sentence, shared with the MCP surface: a rebuild reported there and
        // re-read here has to describe the same rebuild the same way, and a
        // discarded-decision count phrased two ways is a user believing two different
        // things were lost.
        return describeFormworkReconciliation({
          existing: existing.length,
          keep: keep.length,
          create: create.length,
          orphan: orphan.length,
          discardedPartDecisions: discarded,
          joints: joints.length,
        })
      },
    }),
    set_pour_limits: tool({
      description: SET_POUR_LIMITS_DESCRIPTION,
      inputSchema: z.object(pourLimitsPatchInput),
      execute: async ({ elementId, ...limits }) => {
        toolCalls.push({ name: 'set_pour_limits', input: { elementId, ...limits } })
        const element = castableOrError(elementId)
        if (typeof element === 'string') return element
        const result = applyPourLimitsPatch(element.type, limits)
        if (result.error !== undefined) return result.error
        for (const [key, value] of Object.entries(result.writes)) {
          // An explicit `undefined` deletes rather than stores: an absent cap is what
          // encodes "this element has no limit", so a key holding undefined would
          // serialise as a stated null.
          if (value === undefined) delete (element as Record<string, unknown>)[key]
          else (element as Record<string, unknown>)[key] = value
        }
        onMutate()
        const units = pourUnitsForHost(
          element as unknown as Parameters<typeof pourUnitsForHost>[0],
          Object.values(graph.nodes) as AnyNode[],
        )
        const mismatch = shutterMismatch(elementId, Math.max(1, units.length))
        return [`ok — ${describePourSplit(units)}`, result.caveat, mismatch]
          .filter(Boolean)
          .join('. ')
      },
    }),
    set_pour_date: tool({
      description: SET_POUR_DATE_DESCRIPTION,
      inputSchema: z.object(pourDatePatchInput),
      execute: async ({ assemblyId, pourAt }) => {
        toolCalls.push({ name: 'set_pour_date', input: { assemblyId, pourAt } })
        const nodes = graph.nodes as unknown as Record<string, AnyNode>
        const assembly = nodes[assemblyId]
        // The likeliest mistake this tool invites is a real id of the wrong kind — a wall's
        // where a shutter's belongs — so the refusal names the read that lists pours rather
        // than reporting a missing node.
        if (assembly === undefined || assembly.type !== 'formwork-assembly') {
          return unknownAssembly(assemblyId)
        }
        const result = applyPourDatePatch({ pourAt })
        if (result.error !== undefined) return result.error
        const target = assembly as unknown as Record<string, unknown>
        // An explicit `undefined` deletes rather than stores: an absent `pourAt` is what
        // encodes an unprogrammed pour, so a key holding undefined would serialise as a
        // stated null and the pour would look dated with no date.
        if (result.writes.pourAt === undefined) delete target.pourAt
        else target.pourAt = result.writes.pourAt
        onMutate()
        return `ok — ${result.recorded} on ${assembly.parentId ?? assemblyId}. Read inspect_project_formwork for the delivery and strike dates it produces.`
      },
    }),
    inspect_formwork_settings: tool({
      description: INSPECT_FORMWORK_SETTINGS_DESCRIPTION,
      inputSchema: z.object({}),
      execute: async () => {
        toolCalls.push({ name: 'inspect_formwork_settings', input: {} })
        const node = findFormworkSettingsNode(Object.values(graph.nodes) as AnyNode[])
        return JSON.stringify({
          ...formworkSettingsReport(node),
          shuttersAffectedByAChange: scenewideShutterCount(),
        })
      },
    }),
    set_formwork_settings: tool({
      description: SET_FORMWORK_SETTINGS_DESCRIPTION,
      inputSchema: z.object(formworkSettingsPatchInput),
      execute: async (patch) => {
        toolCalls.push({ name: 'set_formwork_settings', input: patch })
        const existing = findFormworkSettingsNode(Object.values(graph.nodes) as AnyNode[])
        // Validated before the node is created, so a refused call leaves a project that
        // has stated nothing still stating nothing.
        const result = applyFormworkSettingsPatch(existing, patch)
        if (result.error !== undefined) return result.error

        const node = settingsNodeOrError()
        if (typeof node === 'string') return node

        for (const [key, value] of Object.entries(result.writes)) {
          // An explicit `undefined` deletes rather than stores, the same contract the
          // store's `updateNode` honours: an optional field's absence is what encodes
          // "unstated", and a key holding undefined would serialise as a stated null.
          if (value === undefined) delete node[key]
          else node[key] = value
        }
        onMutate()

        const stale = scenewideShutterCount()
        const resolved = formworkSettings(node as never)
        const summary = `ok — ${result.changed.join(', ')} set; the scene now designs to ${resolved.riseRateMH} m/h at ${resolved.concreteTemperatureC} °C under ${resolved.pressureStandard}`
        // Re-solved on read, not on write: the parts and the design report both
        // solve from the settings each time they are asked, so there is nothing to
        // regenerate. This used to tell the model to call attach_formwork again,
        // which was unnecessary *and* destructive once shutters carried per-part
        // decisions — the re-attach discarded them to rebuild what had not changed.
        return stale === 0
          ? summary
          : `${summary}, and ${stale === 1 ? 'the existing shutter is' : `all ${stale} existing shutters are`} re-designed to it — nothing to regenerate. Re-read inspect_formwork_parts if you have already quoted a spacing or a count.`
      },
    }),
    inspect_formwork_parts: tool({
      description: INSPECT_FORMWORK_PARTS_DESCRIPTION,
      inputSchema: z.object(formworkPartsQueryInput),
      execute: async ({ elementId, kind }) => {
        toolCalls.push({ name: 'inspect_formwork_parts', input: { elementId, kind } })
        const element = castableOrError(elementId)
        if (typeof element === 'string') return element
        const report = formworkPartsReport(
          element as unknown as Parameters<typeof formworkPartsReport>[0],
          graph.nodes as unknown as Record<string, AnyNode>,
          { kind },
        )
        // Refused rather than answered with an empty bill: a bill of nothing reads as
        // an element that needs nothing, which is the opposite of one awaiting a shutter.
        if (!report) return noFormworkAssembly(elementId)
        return JSON.stringify(report)
      },
    }),
    inspect_project_formwork: tool({
      description:
        'The formwork the whole job needs, as one bill. This is the scope a yard actually orders at: the same panel type on two walls is one line on a delivery note, and two per-element bills of it cannot be added together afterwards — so use this, not a series of inspect_formwork_parts calls, for any question about what a floor or a project needs, what it weighs, or what to order. Scope it with levelId to bill one level, which is how a pour is planned, or leave it off for the whole scene. Elements with no shutter yet are not in the bill at all, and are listed separately as unshuttered — a wall nobody has formed is not a wall that needs nothing. Read caveats first and lead with them: each one means every figure below it is wrong in a way the figures themselves cannot show. Where the project has recorded what the yard owns, every line also splits into fromOwnStock, toHire and consumed, and supply totals them; supply being absent means nobody has recorded any stock, so say that rather than implying the bill is all on hire — record it with set_formwork_settings ownedStock. Two things about the split worth carrying to the user: it is for this scope only, because the same owned panels serve the next pour once stripped, so two levels’ owned figures are not a total; and hiredAlteredHere is a recharge at list price rather than a hire charge, because a hire company’s panel drilled for this pour does not come back as stock. Every line also carries daysHeld, how long that line stays on the job under the striking table the project’s code family publishes, with struckAs saying what it is held as — a slab’s deck comes off in 4 days and the props under it stay 10, so never quote one period for an element. daysHeld null means the part is not struck at all: a tie is cut off inside the wall, a release agent is used up. Three things never to do with these figures: do not add them, because hire.longestDaysHeld is when the last of the set comes free and a sum is a duration longer than the job; do not call them calendar days when hire.basis is qualifying-time, because ACI counts only hours above 10 °C and in a cold spell the strike date is later than the number reads; and do not multiply them by a rate of your own — cost is either in the answer or it is not. Read hire.assumed and say which figures the job stated and which the code’s own default column supplied — record the real ones with set_formwork_settings curing. Where the project has recorded rates, cost prices the bill and every line carries its own share: hire for the period charged, recharge for hired parts this pour altered, purchase for what is spent. Four rules about the money. Cost absent means no rate is recorded, so there is no price in this answer — say that and ask for the figures rather than deriving one, because a rate is the only input in this whole model that no code publishes and no product carries, and a plausible figure is indistinguishable from a real one once you have said it. cost.complete false means some lines could not be priced, so the total is a floor and must be quoted as one — cost.gaps says what is missing, and set_formwork_settings rates is what fixes it. daysCharged rather than daysHeld is what reconciles with an invoice: a wall form struck in 12 hours against a 28-day minimum is charged for 28 days, atMinimumHirePeriod marks those lines, and the remedy is pouring more with the same set rather than striking sooner. And cost.excludes is not boilerplate — this is what the formwork costs to hold, not the cost of forming the job, so never present the total as a formwork price without saying that labour, transport, finance and the project’s own owned stock are all outside it. Where any pour carries a date, schedule turns those periods into a calendar: plantWantedOnSite is when the plant has to arrive, plantFreeAgain when the last of it is back, and daysOnSite is arrival to release across every pour — which is not hire.longestDaysHeld, because a set used on five pours a week apart is held two days each time and on site for five weeks, and it is the on-site figure a yard invoices. Five rules about the dates. Schedule absent means nobody has dated a pour, so there is no programme in this answer — say so and ask for the dates rather than inferring one from the order the elements or shutters appear in, because a date is the only input in this model with neither a code nor a product behind it, and a derived programme printed beside real geometry carries the same authority as the geometry. undatedPours above zero means the window covers only the dated ones: a window over 3 of 40 pours is a true statement about 3 pours and a wrong one about the job, so always say how many are covered. earliestOnly true means the strike dates are the earliest the forms could come off rather than the dates, because ACI counts qualifying hours above 10 °C and nothing here knows the weather — a cold spell pushes every one of them later. A pour’s strikeAt is the last of its strikes, not the first, because it is the day the set comes free: a slab’s deck comes off days before its props, and both are in that pour’s strikes if the user needs the sequence. And where no return lead time is recorded, releaseAt is the strike date itself and gaps says so — cleaning and the trip back are not in it, while a hire normally runs to the return. Where the programme covers enough of the job, sets answers what the bill cannot: how many to own or hire. Every bom quantity is what passes through the job, and sets.items[].mostAtOnce is what stands at the same time — a job of 400 panels with a peak of 100 is an order for 100, so when the user asks what to buy or hire, quote sets and never bom. reuses is mostAtOnce against fittedInTotal, and it is what decides owning against hiring: eight uses of a panel amortises a purchase and one use is a hire. sets.rack is per kind and is a sum of that kind’s items rather than a sweep of them, because a 2.4 m panel does not cover for a 1.2 m one even if their peaks fall a fortnight apart. Four rules about these counts. Sets absent with schedule present is not a fault — read noSetCountBecause and pass it on, then offer to date the remaining pours with set_pour_date, because a count over part of a programme comes out low and a low order is one somebody places. countedPours below totalPours means every figure is a floor: an undated pour cannot reduce an overlap, so the real peak is that or higher, never lower. Do not subtract a peak from a bill quantity, because the difference is not a quantity of anything — the same panels are counted again each time they are refitted. And a set is counted free from its release date, so back-to-back pours are shown sharing one set with no slack for striking, cleaning and refitting, which no gang does in a day.',
      inputSchema: z.object({
        levelId: z
          .string()
          .optional()
          .describe('a level id to bill one level; omit for the whole scene'),
        elementIds: z
          .array(z.string())
          .max(500)
          .optional()
          .describe('bill only these elements — for a selection the user named'),
      }),
      execute: async ({ elementIds, levelId }) => {
        toolCalls.push({ name: 'inspect_project_formwork', input: { elementIds, levelId } })
        const nodes = graph.nodes as unknown as Record<string, AnyNode>
        if (levelId !== undefined && nodes[levelId]?.type !== 'level') {
          return `Error: no level with id ${levelId}. Call list_castable_elements and read the parentId of the elements you mean.`
        }
        const solution = solveProjectFormwork(nodes, { hostIds: elementIds, parentId: levelId })
        const scoped = new Set(castableHostIds(nodes, { hostIds: elementIds, parentId: levelId }))
        const shuttered = new Set(solution.elements.map((element) => element.host.id as string))
        return JSON.stringify({
          scope: levelId ?? (elementIds ? 'the elements named' : 'whole scene'),
          elementCount: solution.elements.length,
          shutterCount: solution.shutterCount,
          elements: solution.elements.map((element) => ({
            id: element.host.id,
            kind: element.host.type,
            shutters: element.shutters.length,
            pourUnits: element.pourUnitCount,
            coversWholePour: element.coversWholePour,
          })),
          // Named rather than omitted. An element in scope with no shutter is the
          // most likely reason a total is lower than the user expects, and it is
          // invisible in a bill that only lists what exists.
          unshuttered: [...scoped].filter((id) => !shuttered.has(id as string)),
          bom: solution.bom.map((line, index) => {
            const split = solution.supply?.lines[index]
            const held = solution.hire.lines[index]
            const priced = solution.cost?.lines[index]
            return {
              description: line.description,
              catalogId: line.catalogId ?? null,
              provenance: line.provenance,
              quantity: line.quantity,
              unit: line.unit,
              totalWeightKg: line.totalWeightKg === undefined ? null : round(line.totalWeightKg),
              // Per line and only where there is a rack, so an absent field is "nobody
              // said what this project owns" rather than "nothing to hire". Indexed
              // because `bomSupply` returns the bill's own order.
              ...(split
                ? {
                    fromOwnStock: split.ownedQuantity,
                    toHire: split.hiredQuantity,
                    consumed: split.consumedQuantity,
                  }
                : {}),
              // Null rather than 0 for a part nothing strikes: a tie is cut off inside
              // the wall and a drum of release agent is gone, and a 0 invites the model
              // to report it as plant returned the same day.
              daysHeld: held?.hours === undefined ? null : round(held.hours / 24),
              struckAs: held?.striking === undefined ? null : held.striking.target,
              ...(held?.mixed ? { mixedPeriods: held.mixed.targets } : {}),
              // Only where the project has recorded rates, and each figure only where it
              // resolved. An absent cost is "no rate for this" and never "costs nothing":
              // a 0 here is the one number a model would repeat to a user as a price.
              // `daysCharged` differs from `daysHeld` whenever a minimum hire period
              // bites, and it is the charged figure that reconciles with an invoice.
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
                    ...(priced.totalCost === undefined
                      ? {}
                      : { lineCost: round(priced.totalCost) }),
                    ...(priced.gaps.length > 0
                      ? { costGaps: priced.gaps.map((gap) => COST_GAP_LABELS[gap]) }
                      : {}),
                  }
                : {}),
            }
          }),
          totalWeightKg: round(solution.totalWeightKg),
          totalWeightComplete: solution.totalWeightComplete,
          // Absent where the project has recorded no stock, and the model is told in the
          // tool description to say so rather than to treat the bill as all on hire.
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
          // rather than left to the description because it is the sentence the model has to
          // repeat: this is what the formwork costs to hold, and labour is not in it.
          ...(solution.cost
            ? {
                cost: {
                  currency: solution.cost.currency ?? null,
                  hire: round(solution.cost.hireCost),
                  recharge: round(solution.cost.rechargeCost),
                  purchase: round(solution.cost.consumedCost),
                  total: round(solution.cost.totalCost),
                  complete: solution.cost.complete,
                  linesAtMinimumHirePeriod: solution.cost.linesAtMinimum.length,
                  ownedQuantityExcluded: solution.cost.ownedQuantityExcluded,
                  gaps: solution.cost.gaps.map((gap) => COST_GAP_LABELS[gap]),
                  excludes: [
                    'labour, which is normally the largest cost of forming a job',
                    'transport and craneage',
                    'finance and preliminaries',
                    'owned formwork, a sunk asset amortising over reuses this model does not record',
                  ],
                },
              }
            : {}),
          // Never a total. A set is tied up for its slowest release, and a model handed a
          // column of days will otherwise add them and quote a hire longer than the job.
          hire: {
            standard: solution.hire.standard,
            basis: solution.hire.basis,
            longestDaysHeld: round(solution.hire.longestHours / 24),
            periods: solution.hire.periods.map((period) => ({
              struckAs: period.target,
              days: round(period.days),
              governingRule: period.governingRule,
            })),
            assumed: solution.hire.assumed.map((entry) => entry.message),
            substitutedFromAnotherCodeFamily: solution.strikingStandardSubstituted,
          },
          // Absent where no pour in scope carries a date, which means there is no calendar in
          // this answer at all — not a job with no programme. A date is the only input in the
          // whole feature with neither a code nor a product behind it, so there is nothing to
          // assume and nothing to derive from the order the shutters happen to be in.
          ...(solution.schedule
            ? {
                schedule: {
                  plantWantedOnSite: solution.schedule.firstErectAt ?? null,
                  firstPour: solution.schedule.firstPourAt ?? null,
                  lastPour: solution.schedule.lastPourAt ?? null,
                  lastStrike: solution.schedule.lastStrikeAt ?? null,
                  plantFreeAgain: solution.schedule.lastReleaseAt ?? null,
                  // Arrival to release across every pour, and deliberately not
                  // `hire.longestDaysHeld`: that is one pour's hold, and a set used on five
                  // pours a week apart is held two days each time and on site five weeks.
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
                      struckAs: strike.target,
                      date: strike.date,
                    })),
                  })),
                },
              }
            : {}),
          // What to own or hire, where the programme covers enough of the job. Absent for a
          // stronger reason than `cost` or `schedule` are: those show their missing input by
          // having no figures, and a set count off a partial programme is a plausible small
          // number instead. `noSetCountBecause` is what stops the absence reading as a fault.
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
                    kind: kind.kind,
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
          beyondCapacity: solution.beyondCapacityMarks.map((part) => ({
            elementId: part.hostId,
            mark: part.mark,
            utilisation: round(part.utilisation),
          })),
          // The same words the takeoff panel and the CSV use, so a user comparing
          // the three is not left working out whether they are one fault or three.
          caveats: projectFormworkCaveats(solution),
        })
      },
    }),
    validate_formwork: tool({
      description:
        'Whether the formwork in scope can actually be built. This is a different question from what it costs: a bill can total correctly for a shutter nobody can erect, and almost nothing that makes a bill wrong is what makes a shutter unbuildable. It checks cast-order cycles, single-sided pours with no earlier anchor, formed areas that do not sum to the wrapped area, runs with a stretch no panel or filler closes, make-up pieces too narrow to fix, walls no tie in the system reaches, piers and head bands beside an opening that no drilled tie hole falls in, asymmetric tie grids on architectural faces, openings crossing a lift joint, junction angles no hinged unit sweeps, bridged expansion joints, waterstop runs that do not close, drilled tie holes falling inside the width of a waterstop, lift joints off a permitted elevation, pours over the supply limit, and designs outside the code envelope. Scope it with levelId for a floor, or leave it off for the whole scene. Two things to do with the result rather than summarise it away: errors are things the crew cannot do and warnings are exceptions somebody has to sign, so never merge the two counts; and notChecked lists assertions that could not run here — say so, because a report of failures alone reads as a clean bill of health for everything it never examined. Run this before presenting a takeoff as an order.',
      inputSchema: z.object({
        levelId: z
          .string()
          .optional()
          .describe('a level id to check one level; omit for the whole scene'),
        elementIds: z
          .array(z.string())
          .max(500)
          .optional()
          .describe('check only these elements — for a selection the user named'),
      }),
      execute: async ({ elementIds, levelId }) => {
        toolCalls.push({ name: 'validate_formwork', input: { elementIds, levelId } })
        const nodes = graph.nodes as unknown as Record<string, AnyNode>
        // Refused rather than reported as an empty floor, for the reason
        // inspect_project_formwork refuses one: "nothing wrong on level_9" is a
        // sentence the model will happily produce about a level that does not exist.
        if (levelId !== undefined && nodes[levelId]?.type !== 'level') {
          return `Error: no level with id ${levelId}. Call list_castable_elements and read the parentId of the elements you mean.`
        }
        const { report, shutteredIds } = validateProjectFormwork(nodes, {
          hostIds: elementIds,
          parentId: levelId,
        })
        return JSON.stringify({
          scope: levelId ?? (elementIds ? 'the elements named' : 'whole scene'),
          elementCount: report.elementIds.length,
          errorCount: report.errorCount,
          warningCount: report.warningCount,
          findings: report.findings.map((finding) => ({
            invariant: finding.invariant,
            severity: finding.severity,
            elementIds: finding.elementIds,
            message: finding.message,
            locus: finding.locus ?? null,
          })),
          // The same sentences the Buildability panel prints, so a user comparing the
          // two is not left working out whether they are one fault or two.
          summary: validationSummary(report),
          // Which elements had a layout to check at all. Three of the assertions are
          // about a packed run and a pressure solve, and an element nobody has formed
          // has neither — a pass over it is not a pass.
          shutteredIds,
          notChecked: report.notChecked,
        })
      },
    }),
    set_formwork_part: tool({
      description: SET_FORMWORK_PART_DESCRIPTION,
      inputSchema: z.object(formworkPartPatchInput),
      execute: async ({ catalogId, elementId, mark, note, omitted }) => {
        toolCalls.push({
          name: 'set_formwork_part',
          input: { catalogId, elementId, mark, note, omitted },
        })
        const element = castableOrError(elementId)
        if (typeof element === 'string') return element
        const nodes = graph.nodes as unknown as Record<string, AnyNode>
        const shutters = solveShuttersForHost(
          element as unknown as Parameters<typeof solveShuttersForHost>[0],
          nodes,
        )
        // Resolved against the live solve rather than written blind, so a mark the
        // model misremembered is refused instead of becoming a stale edit nobody
        // asked for.
        const target = shutters.find((shutter) => partByMark(shutter.parts, mark) !== undefined)
        if (!target) {
          const known = shutters.reduce((total, shutter) => total + shutter.parts.length, 0)
          return known === 0
            ? noFormworkAssembly(elementId, mark)
            : unknownPartMark(elementId, mark, known)
        }
        const result = applyFormworkPartPatch(target.assembly.partOverrides, {
          catalogId,
          mark,
          note,
          omitted,
        })
        if (result.error !== undefined) return result.error
        const assembly = nodes[target.assembly.id as string] as unknown as Record<string, unknown>
        assembly.partOverrides = result.overrides
        onMutate()
        const part = partByMark(target.parts, mark)
        return `ok — ${partLabel(part as never)} ${mark}: ${result.recorded.join(', ')}`
      },
    }),
    inspect_pour_units: tool({
      description: INSPECT_POUR_UNITS_DESCRIPTION,
      inputSchema: z.object({ elementId: z.string() }),
      execute: async ({ elementId }) => {
        toolCalls.push({ name: 'inspect_pour_units', input: { elementId } })
        const element = castableOrError(elementId)
        if (typeof element === 'string') return element
        const units = pourUnitsForHost(
          element as unknown as Parameters<typeof pourUnitsForHost>[0],
          Object.values(graph.nodes) as AnyNode[],
        )
        return JSON.stringify({
          kind: element.type,
          limits: {
            maxLiftHeight: element.maxLiftHeight ?? null,
            maxPourLength: element.maxPourLength ?? null,
            maxPourVolume: element.maxPourVolume ?? null,
          },
          pourUnitCount: Math.max(1, units.length),
          shutterCount: shuttersOnHost(elementId).length,
          // Per unit is the constraint — that is what one delivery has to supply before
          // the first concrete placed sets. The total is separate so neither has to be
          // derived by adding figures that must not be added.
          totalVolumeCuM: round(units.reduce((sum, unit) => sum + unit.volumeCuM, 0)),
          units: units.map((unit) => ({
            segment: unit.segmentIndex,
            lift: unit.liftIndex,
            startAlong: round(unit.startAlong),
            endAlong: round(unit.endAlong),
            baseElevation: round(unit.baseElevation),
            topElevation: round(unit.topElevation),
            volumeCuM: round(unit.volumeCuM),
            bearsOnLiftBelow: unit.hasJointBelow,
            // Core's labels rather than the enum names, so the two AI surfaces explain
            // one joint in one sentence.
            startCut:
              unit.startCutReason === undefined
                ? null
                : POUR_CUT_REASON_LABELS[unit.startCutReason],
            endCut:
              unit.endCutReason === undefined ? null : POUR_CUT_REASON_LABELS[unit.endCutReason],
          })),
          coverageCaveat: shutterMismatch(elementId, Math.max(1, units.length)) ?? null,
        })
      },
    }),
  }
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

/** Runs one user turn through Bedrock with tool access to the given scene graph. Mutates `graph` in place. */
export async function runChatTurn(graph: SceneGraph, history: ChatTurn[]): Promise<ChatResult> {
  const messages: ModelMessage[] = history.map((turn) => ({
    role: turn.role,
    content: turn.text,
  }))

  const toolCalls: ChatResult['toolCalls'] = []
  let mutated = false

  const result = await generateText({
    model: MODEL,
    system: SYSTEM_PROMPT,
    messages,
    tools: buildTools(graph, toolCalls, () => {
      mutated = true
    }),
    stopWhen: isStepCount(6),
  })

  return { reply: result.text, toolCalls, mutated }
}
