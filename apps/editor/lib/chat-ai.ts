import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock'
import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
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
  'envelope, and the batch-plant supply rate, so ask. Keep replies short.'

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
