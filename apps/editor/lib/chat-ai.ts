import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock'
import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import {
  DEFAULT_FORMWORK_SETTINGS,
  FALSEWORK_BEAMS,
  FORMWORK_SYSTEMS,
  type FormworkSettingsGroup,
  findFormworkSettingsNode,
  formworkSettings,
  mergeFormworkCement,
  mergeFormworkSettingsGroup,
  PROP_TYPES,
  SHEATHING_TYPES,
} from '@pascal-app/core/formwork'
import type { AnyNode } from '@pascal-app/core/schema'
import { buildSolverJointNodes } from '@pascal-app/nodes/construction-joint'
import { buildFormworkNodes, pourUnitsForHost } from '@pascal-app/nodes/formwork-assembly'
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
  'off those three. Changing them invalidates every assembly already in the scene, so say how many ' +
  'and offer to re-run attach_formwork on those elements. Keep replies short.'

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

/**
 * Schemas for the project settings groups, mirroring the node's own bounds.
 *
 * `.nullable()` throughout, and null means "hand this field back to the shipped
 * default" — the same three-state contract the panel's controls carry. A model that
 * could only set values would be able to state a figure and never retract it, and the
 * design report's "assumed" versus "project" distinction would decay to "project"
 * across a conversation.
 */
const CONCRETE_SETTINGS_SCHEMA = z.object({
  densityKgM3: z.number().positive().max(5000).nullable().optional().describe("ACI's w, kg/m³"),
  unitWeightKnM3: z
    .number()
    .positive()
    .max(50)
    .nullable()
    .optional()
    .describe("DIN's and CIRIA's γc, kN/m³"),
  consistencyClass: z
    .enum(['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'SCC'])
    .nullable()
    .optional()
    .describe(
      "DIN's consistency class. Sets both the constant and the slope on the rise rate. Use SCC here for self-compacting concrete rather than setting a separate flag",
    ),
  slumpMm: z
    .number()
    .min(0)
    .max(300)
    .nullable()
    .optional()
    .describe("over 175 mm ACI's special-case formulas do not apply and the fluid head governs"),
  endOfSettingH: z
    .number()
    .positive()
    .max(48)
    .nullable()
    .optional()
    .describe("DIN's tE. A later set raises the pressure, it does not lower it"),
  referenceTemperatureC: z.number().min(-20).max(60).nullable().optional().describe("DIN's TRef"),
  ciriaC2: z
    .number()
    .positive()
    .max(10)
    .nullable()
    .optional()
    .describe("CIRIA's C2, overriding what the binder implies"),
})

const CEMENT_SETTINGS_SCHEMA = z.object({
  slagFraction: z
    .number()
    .min(0)
    .max(1)
    .nullable()
    .optional()
    .describe("fraction of binder replaced by ggbs; over 0.70 is ACI's high blend"),
  flyAshFraction: z
    .number()
    .min(0)
    .max(1)
    .nullable()
    .optional()
    .describe('fraction replaced by fly ash; over 0.40 is the high blend'),
  retarder: z.boolean().nullable().optional(),
  superplasticizer: z
    .boolean()
    .nullable()
    .optional()
    .describe(
      "asked separately from retarder because ACI's Table 2.2 footnote counts a high-range water reducer that delays setting as one — worth 20 % of the pressure",
    ),
})

const PLACEMENT_SETTINGS_SCHEMA = z.object({
  riseRateMH: z
    .number()
    .positive()
    .max(50)
    .nullable()
    .optional()
    .describe('rate of rise, m/h — the pump rate over the plan area, not the truck rate'),
  concreteTemperatureC: z
    .number()
    .min(-10)
    .max(50)
    .nullable()
    .optional()
    .describe("the concrete's temperature at placing, not the air's"),
  vibration: z
    .enum(['internal', 'external', 'none'])
    .nullable()
    .optional()
    .describe(
      'external vibration falls outside both codes and the pressure jumps to the fluid head',
    ),
  vibratorImmersionDepthM: z
    .number()
    .positive()
    .max(10)
    .nullable()
    .optional()
    .describe("poker depth, m; past 1.2 m ACI's special cases are void"),
  pumpedFromBase: z
    .boolean()
    .nullable()
    .optional()
    .describe(
      'base-pumped is the full fluid head plus 25 % surge — roughly double a top-placed pour',
    ),
})

const FALSEWORK_LOAD_SETTINGS_SCHEMA = z.object({
  formworkSelfWeightKpa: z.number().min(0).max(10).nullable().optional(),
  rebarKnM3: z.number().min(0).max(10).nullable().optional(),
  liveLoadKpa: z
    .number()
    .min(0)
    .max(50)
    .nullable()
    .optional()
    .describe(
      "raised to ACI §2.2.1's floor if stated lower, so a small figure cannot design below the code",
    ),
  motorizedCarts: z
    .boolean()
    .nullable()
    .optional()
    .describe('powered buggies raise both the live-load floor and the combined minimum'),
})

const BRACING_SETTINGS_SCHEMA = z.object({
  windPressureKpa: z.number().min(0).max(10).nullable().optional(),
  formDeadLoadKnM: z
    .number()
    .min(0)
    .max(100)
    .nullable()
    .optional()
    .describe("weight of the form the bracing holds, per metre of wall — ACI's 2 % term"),
  rakerSpacingM: z.number().positive().max(20).nullable().optional(),
  rakerAngleDeg: z.number().min(5).max(85).nullable().optional(),
  guyWires: z
    .boolean()
    .nullable()
    .optional()
    .describe('a guy takes tension only and needs a partner opposite; a raker takes both'),
})

/**
 * The catalog ids each part field accepts, listed in the schema so the model picks
 * from the shipped catalog rather than inventing a plausible product code.
 *
 * Validated again on the way in even so. An id that resolves to nothing does not
 * fail loudly — the design chain falls back to its default part — so a hallucinated
 * `peri-h20` would leave the project believing it had specified a beam while every
 * span was solved against another one.
 */
const SYSTEM_IDS = Object.keys(FORMWORK_SYSTEMS)
const SHEATHING_IDS = SHEATHING_TYPES.map((entry) => entry.id)
const BEAM_IDS = FALSEWORK_BEAMS.map((entry) => entry.id)
const PROP_IDS = PROP_TYPES.map((entry) => entry.id)

const PART_SETTINGS_SCHEMA = z.object({
  systemId: z
    .string()
    .max(120)
    .nullable()
    .optional()
    .describe(`panel system for wall and column forms; one of: ${SYSTEM_IDS.join(', ')}`),
  sheathingId: z
    .string()
    .max(120)
    .nullable()
    .optional()
    .describe(`face material — ply or panel formlining; one of: ${SHEATHING_IDS.join(', ')}`),
  beamId: z
    .string()
    .max(120)
    .nullable()
    .optional()
    .describe(
      `the section used for studs, walers, joists and bearers alike; one of: ${BEAM_IDS.join(', ')}`,
    ),
  propId: z
    .string()
    .max(120)
    .nullable()
    .optional()
    .describe(`one of: ${PROP_IDS.join(', ')}`),
  doubledWalers: z
    .boolean()
    .nullable()
    .optional()
    .describe('walers paired either side of the tie, which usually opens the tie spacing'),
})

/** The first part id that names nothing in the catalog, as the error the model reads back. */
function unknownPartId(patch: z.infer<typeof PART_SETTINGS_SCHEMA>): string | undefined {
  const checks: Array<[keyof typeof patch, readonly string[]]> = [
    ['systemId', SYSTEM_IDS],
    ['sheathingId', SHEATHING_IDS],
    ['beamId', BEAM_IDS],
    ['propId', PROP_IDS],
  ]
  for (const [key, ids] of checks) {
    const value = patch[key]
    if (typeof value === 'string' && !ids.includes(value)) {
      return `Error: no ${key} "${value}" in the catalog. Pick one of: ${ids.join(', ')}`
    }
  }
  return undefined
}

/**
 * `null` from the model means "unstate this", which the merge helpers spell as
 * `undefined`. An absent key means "leave it alone", so the two cannot be collapsed.
 */
function toPatch<T extends object>(input: T): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue
    out[key] = value === null ? undefined : value
  }
  return out
}
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
   * How many shutters this settings change re-sizes.
   *
   * Reported rather than acted on: the assemblies in the graph were built against the
   * old pour and are now stale, and the model has to be told so it offers to
   * regenerate them. Silently leaving them is how a project ends up with a report
   * quoting one rate of rise and 3D shutters built to another.
   */
  const staleAssemblyCount = (): number =>
    (Object.values(graph.nodes) as AnyNode[]).filter((n) => n.type === 'formwork-assembly').length

  return {
    list_castable_elements: tool({
      description:
        'List every wall, column and slab in the current scene with its dimensions, pour sequence and current construction properties. An element with no formworkType is not shuttered yet.',
      inputSchema: z.object({}),
      execute: async () => {
        toolCalls.push({ name: 'list_castable_elements', input: {} })
        const elements = (Object.values(graph.nodes) as AnyNode[]).filter(isCastable).map((n) => ({
          id: n.id,
          kind: n.type,
          // Only the fields that describe the element's extent — a wall runs
          // between two points, a column stands at one, a slab is a polygon.
          ...(n.type === 'wall'
            ? { start: n.start, end: n.end, thickness: n.thickness, height: n.height }
            : n.type === 'column'
              ? {
                  position: n.position,
                  crossSection: n.crossSection,
                  width: n.width,
                  depth: n.depth,
                  radius: n.radius,
                  height: n.height,
                }
              : {
                  polygon: n.polygon,
                  holes: n.holes,
                  elevation: n.elevation,
                  thickness: n.thickness,
                  edgeFaceCount: n.edgeFaceCount,
                  soffitHeightAboveSupport: n.soffitHeightAboveSupport,
                }),
          formworkType: n.formworkType,
          shutterMaterial: n.shutterMaterial,
          tieSpacing: n.tieSpacing,
          walerSpacing: n.walerSpacing,
          scaffoldRequired: n.scaffoldRequired,
          castOrder: n.castOrder,
          formworkMode: n.formworkMode,
        }))
        return JSON.stringify(elements)
      },
    }),
    set_element_construction: tool({
      description:
        'Set formwork/construction properties on one wall, column or slab in the current scene. tieSpacing and walerSpacing are read per kind: on a wall they are the through-tie and waler centres, on a column the clamp/yoke spacing, and on a slab the bearer/prop and joist centres. Nothing is formed until formworkType names a system.',
      inputSchema: z.object({
        elementId: z.string(),
        formworkType: z.enum(['plywood', 'aluminium', 'steel-panel', 'none']).optional(),
        shutterMaterial: z.string().optional(),
        tieSpacing: z.number().describe('meters').optional(),
        walerSpacing: z.number().describe('meters').optional(),
        scaffoldRequired: z.boolean().optional(),
        castOrder: z
          .number()
          .int()
          .optional()
          .describe(
            'pour sequence rank — a face butting an element cast earlier is not formed, so this changes the shutter',
          ),
        edgeFaceCount: z
          .number()
          .int()
          .min(1)
          .max(2)
          .optional()
          .describe('slabs only: 2 for an upstand or downstand edge beam'),
        soffitHeightAboveSupport: z
          .number()
          .nonnegative()
          .optional()
          .describe('slabs only: soffit height above the floor the props stand on, meters'),
      }),
      execute: async ({ elementId, ...rest }) => {
        toolCalls.push({ name: 'set_element_construction', input: { elementId, ...rest } })
        const element = castableOrError(elementId)
        if (typeof element === 'string') return element
        const slabOnly = ['edgeFaceCount', 'soffitHeightAboveSupport']
        const rejected = slabOnly.filter(
          (key) => rest[key as keyof typeof rest] !== undefined && element.type !== 'slab',
        )
        if (rejected.length > 0) {
          return `Error: ${rejected.join(' and ')} ${rejected.length === 1 ? 'applies' : 'apply'} to slabs only, and ${elementId} is a ${element.type}`
        }
        Object.assign(element, rest)
        onMutate()
        return 'ok'
      },
    }),
    attach_formwork: tool({
      description:
        "Generate the full formwork assembly for a wall, column or slab, built for that kind: two tied faces for a wall, a clamped box or wrapped shaft for a column, a propped soffit deck plus edge forms for a slab. Only the faces the pour sequence actually leaves exposed are formed. An element with a lift cap or an expansion joint gets one assembly per pour unit, since each is erected, poured and struck separately. Call this after set_element_construction once formworkType is not 'none' — the user wants to see the formwork, not just set the properties.",
      inputSchema: z.object({ elementId: z.string() }),
      execute: async ({ elementId }) => {
        toolCalls.push({ name: 'attach_formwork', input: { elementId } })
        const element = castableOrError(elementId)
        if (typeof element === 'string') return element
        const levelNodes = Object.values(graph.nodes) as AnyNode[]
        const host = element as unknown as Parameters<typeof buildFormworkNodes>[0]
        const assemblies = buildFormworkNodes(host, levelNodes)
        if (assemblies.length === 0) {
          return `Error: ${elementId} has no formworkType set, so nothing is formed. Call set_element_construction first.`
        }
        for (const assembly of assemblies) {
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
        if (assemblies.length === 1) return 'ok'
        return `ok — ${assemblies.length} assemblies, one per pour unit, and ${joints.length} construction ${joints.length === 1 ? 'joint' : 'joints'} between them`
      },
    }),
    set_pour_limits: tool({
      description:
        'Set the pour limits that split a wall or column into separately cast units. maxLiftHeight splits it vertically (a 9 m wall capped at 3 m is poured in three lifts); maxPourLength splits it along its length for shrinkage control (water-retaining practice caps a bay at about 7.5 m); maxPourVolume splits it by what the batch plant can deliver before the first concrete reaches initial set. A slab is one pour unit, so only maxLiftHeight is meaningful on it and it cannot slice a slab through its thickness. Each split unit needs its own shutter, so call attach_formwork after changing these. Pass null to clear a limit. Ask the engineer for these values rather than guessing — they come from tie capacity, the pressure envelope, and the supply rate.',
      inputSchema: z.object({
        elementId: z.string(),
        maxLiftHeight: z.number().positive().nullable().optional().describe('meters'),
        maxPourLength: z.number().positive().nullable().optional().describe('meters'),
        maxPourVolume: z.number().positive().nullable().optional().describe('cubic meters'),
      }),
      execute: async ({ elementId, ...limits }) => {
        toolCalls.push({ name: 'set_pour_limits', input: { elementId, ...limits } })
        const element = castableOrError(elementId)
        if (typeof element === 'string') return element
        for (const [key, value] of Object.entries(limits)) {
          if (value === undefined) continue
          if (value === null) delete (element as Record<string, unknown>)[key]
          else (element as Record<string, unknown>)[key] = value
        }
        onMutate()
        const units = pourUnitsForHost(
          element as unknown as Parameters<typeof pourUnitsForHost>[0],
          Object.values(graph.nodes) as AnyNode[],
        )
        return units.length <= 1
          ? 'ok — cast in one pour'
          : `ok — cast in ${units.length} pours: ${describeUnits(units)}`
      },
    }),
    inspect_formwork_settings: tool({
      description:
        'The project pour settings every shutter in the scene is designed against, and — for each figure — whether the project stated it or the engine assumed it. Read this before quoting any pressure or spacing: a design report figure derived from an assumed 7 m/h rate of rise at 20 °C is not the same claim as one the job actually stated. One settings record per scene, so this takes no arguments.',
      inputSchema: z.object({}),
      execute: async () => {
        toolCalls.push({ name: 'inspect_formwork_settings', input: {} })
        const node = findFormworkSettingsNode(Object.values(graph.nodes) as AnyNode[])
        const resolved = formworkSettings(node)
        return JSON.stringify({
          anythingStated: node !== undefined,
          resolved: {
            pressureStandard: resolved.pressureStandard,
            measurementStandard: resolved.measurementStandard,
            riseRateMH: resolved.riseRateMH,
            concreteTemperatureC: resolved.concreteTemperatureC,
            concrete: resolved.concrete,
            placement: resolved.placement,
            falseworkLoads: resolved.falseworkLoads,
            bracing: resolved.bracing,
            parts: resolved.parts,
          },
          // Only what the project actually said. Anything absent here but present
          // above is the shipped conservative default, not a decision.
          stated: node
            ? {
                pressureStandard: node.pressureStandard ?? null,
                measurementStandard: node.measurementStandard ?? null,
                concrete: node.concrete ?? null,
                placement: node.placement ?? null,
                falseworkLoads: node.falseworkLoads ?? null,
                bracing: node.bracing ?? null,
                parts: node.parts ?? null,
              }
            : null,
          assumedDefaults: {
            riseRateMH: DEFAULT_FORMWORK_SETTINGS.riseRateMH,
            concreteTemperatureC: DEFAULT_FORMWORK_SETTINGS.concreteTemperatureC,
            pressureStandard: DEFAULT_FORMWORK_SETTINGS.pressureStandard,
            measurementStandard: DEFAULT_FORMWORK_SETTINGS.measurementStandard,
          },
          shuttersAffectedByAChange: staleAssemblyCount(),
        })
      },
    }),
    set_formwork_settings: tool({
      description:
        'Set the project pour settings — the inputs every shutter in the scene is designed against. These are project decisions, not per-element ones: the concrete arrives from one plant at one temperature and rises at a rate the pump sets, and the design code follows the contract. Pass only the groups you are changing, and only the fields within them. Pass null for a field to hand it back to the conservative shipped default. Every existing formwork assembly was built against the old pour, so after changing these call attach_formwork again on the affected elements or the 3D shutters and the design report will disagree. Ask the engineer for these figures rather than guessing — the rate of rise, the concrete temperature and the pressure code are the three inputs the whole design hangs off.',
      inputSchema: z.object({
        pressureStandard: z
          .enum(['ACI_347', 'DIN_18218', 'CIRIA_108', 'BS_5975_SHORTCUT'])
          .nullable()
          .optional()
          .describe(
            'which code derives the fresh-concrete pressure. Follows the contract and the engineer of record — the catalog panels publish their permissible pressures against DIN, and a rating certified under one standard is not a check against another',
          ),
        measurementStandard: z
          .enum(['IS_1200_5', 'NRM2', 'HKSMM4', 'CESMM4', 'POMI'])
          .nullable()
          .optional()
          .describe("the contract's quantity rules — what the client actually pays for"),
        concrete: CONCRETE_SETTINGS_SCHEMA.optional(),
        cement: CEMENT_SETTINGS_SCHEMA.optional().describe(
          'the binder, asked as what it is rather than as the coefficient it implies',
        ),
        placement: PLACEMENT_SETTINGS_SCHEMA.optional(),
        falseworkLoads: FALSEWORK_LOAD_SETTINGS_SCHEMA.optional().describe(
          "what a soffit carries beyond the concrete itself; each is raised to ACI §2.2.1's floor",
        ),
        bracing: BRACING_SETTINGS_SCHEMA.optional().describe(
          'wall forms are braced against wind and impact, not against the concrete — the ties do that',
        ),
        parts: PART_SETTINGS_SCHEMA.optional().describe(
          'the catalog parts the design resolves against, which decide what every solved spacing is a spacing of',
        ),
      }),
      execute: async ({ cement, ...groups }) => {
        toolCalls.push({ name: 'set_formwork_settings', input: { cement, ...groups } })
        const stated = Object.entries(groups).filter(([, value]) => value !== undefined)
        if (stated.length === 0 && cement === undefined) {
          return 'Error: nothing to set — pass at least one field'
        }
        if (groups.parts) {
          const bad = unknownPartId(groups.parts)
          if (bad) return bad
        }
        const node = settingsNodeOrError()
        if (typeof node === 'string') return node

        const changed: string[] = []
        for (const [key, value] of stated) {
          if (key === 'pressureStandard' || key === 'measurementStandard') {
            // A top-level enum: null unstates it the same way a group field's does.
            if (value === null) delete node[key]
            else node[key] = value
            changed.push(key)
            continue
          }
          const group = key as FormworkSettingsGroup
          const patch = toPatch(value as object)
          if (group === 'concrete' && 'consistencyClass' in patch) {
            // `consistencyClassOf` reports SCC whenever `selfCompacting` is set, so the
            // two are one fact and the schema asks for it once. The flag is what the
            // codes actually branch on — ACI has no SCC provisions and reads only this
            // — so an F class left beside a stale flag would be ignored entirely.
            patch.selfCompacting = patch.consistencyClass === 'SCC' ? true : undefined
          }
          const merged = mergeFormworkSettingsGroup(node[group] as never, patch as never)
          if (merged === undefined) delete node[group]
          else node[group] = merged
          changed.push(group)
        }
        if (cement !== undefined) {
          const merged = mergeFormworkCement(node.concrete as never, toPatch(cement) as never)
          if (merged === undefined) delete node.concrete
          else node.concrete = merged
          changed.push('cement')
        }
        onMutate()

        const stale = staleAssemblyCount()
        const resolved = formworkSettings(node as never)
        const summary = `ok — ${changed.join(', ')} set; the scene now designs to ${resolved.riseRateMH} m/h at ${resolved.concreteTemperatureC} °C under ${resolved.pressureStandard}`
        return stale === 0
          ? summary
          : `${summary}. ${stale} existing ${stale === 1 ? 'assembly was' : 'assemblies were'} built against the old pour — call attach_formwork again on those elements or the shutters and the report will disagree.`
      },
    }),
    inspect_pour_units: tool({
      description:
        "How a wall, column or slab will be split into separately cast pour units, and why each cut exists. Use this to explain a formwork layout: each unit is one shutter erected, poured and struck on its own, so the unit count is the shutter count and each cut between them is a construction joint. Also reports each unit's concrete volume.",
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
          units: units.map((unit) => ({
            segment: unit.segmentIndex,
            lift: unit.liftIndex,
            startAlong: round(unit.startAlong),
            endAlong: round(unit.endAlong),
            baseElevation: round(unit.baseElevation),
            topElevation: round(unit.topElevation),
            volumeCuM: round(unit.volumeCuM),
            bearsOnLiftBelow: unit.hasJointBelow,
            startCutReason: unit.startCutReason ?? null,
            endCutReason: unit.endCutReason ?? null,
          })),
        })
      },
    }),
  }
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

/** A one-line summary an LLM can read back to the user without re-deriving it. */
function describeUnits(units: ReturnType<typeof pourUnitsForHost>): string {
  const segments = new Set(units.map((unit) => unit.segmentIndex)).size
  const lifts = new Set(units.map((unit) => unit.liftIndex)).size
  const parts: string[] = []
  if (segments > 1) parts.push(`${segments} bays along it`)
  if (lifts > 1) parts.push(`${lifts} lifts up it`)
  const volume = units.reduce((sum, unit) => sum + unit.volumeCuM, 0)
  return `${parts.join(' × ')}, ${round(volume)} m³ total`
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
