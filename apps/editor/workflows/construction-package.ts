import type { AnyNode } from '@pascal-app/core/schema'
import { generateText, isStepCount } from 'ai'
import { FatalError } from 'workflow'
import { buildTools, type ChatResult, MODEL } from '@/lib/chat-ai'
import { getSceneStore } from '@/lib/scene-store-server'
import { constructionQuestionHook } from './hooks/construction-question'

async function loadScene(sceneId: string) {
  'use step'
  const store = await getSceneStore()
  const stored = await store.load(sceneId)
  if (!stored) throw new FatalError(`Scene ${sceneId} not found`)
  return stored
}

/**
 * Applies one free-text answer across every castable element still missing
 * formwork — the durable-workflow equivalent of a single `runChatTurn`, but
 * fanned out over N elements instead of one. Runs as its own step so a Bedrock
 * hiccup retries independently of the (already-answered) human question.
 */
async function applyConstructionAnswer(
  stored: Awaited<ReturnType<typeof loadScene>>,
  elements: Array<{ id: string; kind: string }>,
  answer: string,
) {
  'use step'
  const toolCalls: ChatResult['toolCalls'] = []
  let mutated = false

  await generateText({
    model: MODEL,
    system:
      'You are the construction AI inside the Pascal editor, running a scene-wide formwork ' +
      'planning pass. The user has answered one clarifying question covering every element ' +
      'listed below. Call set_element_construction then attach_formwork for EVERY id listed — do ' +
      'not skip any, and do not invent values the answer does not cover. The three kinds take ' +
      'different shutters, so apply the answer to each in the terms that kind uses.',
    prompt: `Elements needing formwork: ${elements
      .map((element) => `${element.id} (${element.kind})`)
      .join(', ')}\n\nUser answer: ${answer}`,
    tools: buildTools(stored.graph, toolCalls, () => {
      mutated = true
    }),
    stopWhen: isStepCount(elements.length * 2 + 2),
  })

  if (!mutated) {
    throw new Error('Bedrock did not apply construction properties to any element — retrying.')
  }

  const store = await getSceneStore()
  const meta = await store.save({
    id: stored.id,
    name: stored.name,
    projectId: stored.projectId,
    ownerId: stored.ownerId,
    thumbnailUrl: stored.thumbnailUrl,
    graph: stored.graph,
    expectedVersion: stored.version,
    saveMode: 'draft',
    publish: false,
    operation: 'ai_construction_plan',
  })
  if (store.appendSceneEvent) {
    await store.appendSceneEvent({
      sceneId: meta.id,
      version: meta.version,
      kind: 'ai_construction_plan',
      graph: stored.graph,
    })
  }

  return { elementsUpdated: elements.length, toolCalls }
}

/** The kinds that get cast and therefore shuttered — the same set `chat-ai`'s tools accept. */
const CASTABLE_TYPES = ['wall', 'column', 'slab'] as const
type CastableNode = AnyNode & { type: (typeof CASTABLE_TYPES)[number] }

/**
 * Durable, scene-wide construction planning pass: finds every wall, column and
 * slab still missing formwork, asks the user ONE consolidated clarifying
 * question, then generates the assembly for each of them once answered.
 *
 * Unlike `runChatTurn` (one request/response tool loop for one element), this
 * suspends — for minutes, hours, or days — while waiting on the human
 * answer, consuming no compute in between, and resumes exactly where it
 * left off. That suspend/resume durability is the actual reason this lives
 * in a workflow instead of a synchronous API route.
 */
export async function planConstructionPackage(sceneId: string) {
  'use workflow'
  const stored = await loadScene(sceneId)

  const elements = Object.values(stored.graph.nodes)
    .filter(
      (n): n is CastableNode =>
        (CASTABLE_TYPES as readonly string[]).includes(n.type) &&
        !(n as CastableNode).formworkType,
    )
    .map((n) => ({ id: n.id as string, kind: n.type as string }))

  if (elements.length === 0) {
    return {
      status: 'noop' as const,
      message: 'Every wall, column and slab already has formwork configured.',
    }
  }

  const hook = constructionQuestionHook.create({ token: sceneId })
  console.log(
    `planConstructionPackage(${sceneId}): waiting on user answer for ${elements.length} element(s): ${elements
      .map((element) => `${element.id} (${element.kind})`)
      .join(', ')}`,
  )
  const { answer } = await hook

  const result = await applyConstructionAnswer(stored, elements, answer)
  return { status: 'done' as const, ...result }
}
