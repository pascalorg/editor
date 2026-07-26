import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock'
import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import type { AnyNode } from '@pascal-app/core/schema'
import { buildFormworkNode } from '@pascal-app/nodes/formwork-system'
import { generateText, isStepCount, type ModelMessage, tool } from 'ai'
import { z } from 'zod'

const MODEL_ID = process.env.BEDROCK_MODEL_ID ?? 'us.anthropic.claude-sonnet-5'

export const SYSTEM_PROMPT =
  'You are the construction AI inside the Pascal editor. You can inspect walls in the ' +
  'currently open scene and set their formwork/construction properties. Ask the user for ' +
  'any values you are missing before calling set_wall_construction — do not guess load-bearing ' +
  'engineering values silently. After setting formworkType to something other than none, call ' +
  'attach_formwork so the shutter panels/ties/walers actually appear in the scene. Keep replies short.'

const bedrock = createAmazonBedrock({ region: process.env.AWS_REGION ?? 'us-east-1' })

/** Shared Bedrock model instance — used by the streaming chat route, `runChatTurn`, and the construction-plan workflow step. */
export const MODEL = bedrock(MODEL_ID)

export type ChatTurn = { role: 'user' | 'assistant'; text: string }

export type ChatResult = {
  reply: string
  toolCalls: Array<{ name: string; input: unknown }>
  mutated: boolean
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
export function buildTools(graph: SceneGraph, toolCalls: ChatResult['toolCalls'], onMutate: () => void) {
  return {
    list_walls: tool({
      description:
        'List every wall in the current scene with its dimensions and current construction properties.',
      inputSchema: z.object({}),
      execute: async () => {
        toolCalls.push({ name: 'list_walls', input: {} })
        const walls = Object.values(graph.nodes)
          .filter((n): n is AnyNode & { type: 'wall' } => n.type === 'wall')
          .map((w) => ({
            id: w.id,
            start: w.start,
            end: w.end,
            thickness: w.thickness,
            height: w.height,
            formworkType: w.formworkType,
            shutterMaterial: w.shutterMaterial,
            tieSpacing: w.tieSpacing,
            walerSpacing: w.walerSpacing,
            scaffoldRequired: w.scaffoldRequired,
          }))
        return JSON.stringify(walls)
      },
    }),
    set_wall_construction: tool({
      description: 'Set formwork/construction properties on one wall in the current scene.',
      inputSchema: z.object({
        wallId: z.string(),
        formworkType: z.enum(['plywood', 'aluminium', 'steel-panel', 'none']).optional(),
        shutterMaterial: z.string().optional(),
        tieSpacing: z.number().describe('meters').optional(),
        walerSpacing: z.number().describe('meters').optional(),
        scaffoldRequired: z.boolean().optional(),
      }),
      execute: async ({ wallId, ...rest }) => {
        toolCalls.push({ name: 'set_wall_construction', input: { wallId, ...rest } })
        const node = graph.nodes[wallId as keyof typeof graph.nodes]
        if (!node || node.type !== 'wall') {
          return `Error: No wall found with id ${wallId}`
        }
        Object.assign(node, rest)
        onMutate()
        return 'ok'
      },
    }),
    attach_formwork: tool({
      description:
        "Generate formwork geometry (shutter panels, ties, walers) for a wall. Call this after set_wall_construction once formworkType is not 'none' — the user wants to see the formwork, not just set the properties.",
      inputSchema: z.object({ wallId: z.string() }),
      execute: async ({ wallId }) => {
        toolCalls.push({ name: 'attach_formwork', input: { wallId } })
        const wall = graph.nodes[wallId as keyof typeof graph.nodes]
        if (!wall || wall.type !== 'wall') {
          return `Error: No wall found with id ${wallId}`
        }
        const formworkNode = buildFormworkNode(
          wall as unknown as Parameters<typeof buildFormworkNode>[0],
        )
        graph.nodes[formworkNode.id as keyof typeof graph.nodes] = formworkNode as unknown as AnyNode
        wall.children = [...(wall.children ?? []), formworkNode.id]
        onMutate()
        return 'ok'
      },
    }),
  }
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
