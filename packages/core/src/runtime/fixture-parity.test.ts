import { afterAll, describe, expect, test } from 'bun:test'
import { z } from 'zod'
import {
  AGENT_OPERATIONS,
  type AgentContext,
  type AgentOperation,
  addObject,
  applyAgentOutcome,
} from '../agent-operations'
import { ADD_OBJECT_CASES } from '../agent-operations/__fixtures__/add-object-cases'
import { AGENT_TOOL_CASES, type SceneGraph } from '../agent-operations/__fixtures__/cases'
import { AGENT_TOOL_CONTRACTS, addObjectTool } from '../agent-tools'
import { isAgentRefusal } from '../agent-tools/refusal'
import { subscribeSceneCommits } from '../store/history-control'
import { applySceneOperationPatch, getSceneDocument } from '../store/use-scene'
import { closeLiveScene, openLiveScene, settle, snapshotOf } from './__fixtures__/live-scene'
import {
  captureRegistryVersions,
  createAgentHost,
  diffSceneDocuments,
  effectIds,
  isEmptyScenePatch,
  liveSceneRuntime,
  openDetachedScene,
  type SceneCommit,
  type SceneOperationPatch,
  type SceneSnapshot,
  withIdAllocator,
} from './index'

/**
 * The comparison contract. From the same canonical snapshot, context, id seed and registry, an
 * operation computed on a detached scene and on the editor's store (its document systems mounted)
 * yields the same complete patch and the same result, and nothing writes after the live call
 * returns. Applying the detached patch to the editor then lands on the same document, with no
 * further write from its systems.
 */

type ParityCase = {
  label: string
  scene: () => SceneGraph
  operation: AgentOperation
  input: unknown
  context: AgentContext
}

const CASES: ParityCase[] = [
  ...AGENT_TOOL_CASES.map((c) => ({
    label: `${c.tool}: ${c.name}`,
    scene: c.scene,
    operation: AGENT_OPERATIONS[c.tool as keyof typeof AGENT_OPERATIONS] as AgentOperation,
    // As on both surfaces, the operation gets the input its contract parsed.
    input: z
      .object(AGENT_TOOL_CONTRACTS.find((contract) => contract.name === c.tool)!.input)
      .parse(c.input),
    context: { activeLevelId: c.context?.activeLevelId ?? null, catalog: c.context?.catalog },
  })),
  // The surfaces compile `add_object`'s code first; a case carries that compile.
  ...ADD_OBJECT_CASES.map((c) => ({
    label: `add_object: ${c.name}`,
    scene: c.scene,
    operation: addObject as AgentOperation,
    input: { ...z.object(addObjectTool.input).parse(c.input), compiled: c.compiled },
    context: { activeLevelId: c.context?.activeLevelId ?? null },
  })),
]

/** Fixtures the contract does not cover today, and why. */
const MALFORMED =
  'stores geometry its schema rejects, which the editor systems the live side mounts cannot load'
const EXCEPTIONS: Record<string, string> = {
  "verify_scene: validate_scene {} with malformed geometry (a zone's polygon, a wall's start null): every error, the other checks reading around those nodes":
    MALFORMED,
  'get_node: describe_node on a wall stored without its start (its properties as stored): the node as stored, unresolved says why':
    MALFORMED,
  'get_node: describe_node on a wall beside a slab stored without its polygon: the wall as stored, unresolved names what does not read':
    MALFORMED,
}

type Outcome = { refusal: string } | { result: Record<string, unknown>; patch: SceneOperationPatch }

function attempt(run: () => Outcome): Outcome {
  try {
    return run()
  } catch (error) {
    if (!isAgentRefusal(error)) throw error
    return { refusal: error.code }
  }
}

function runDetached(c: ParityCase, snapshot: SceneSnapshot): Outcome {
  const scene = openDetachedScene(snapshot, {
    base: { kind: 'draft', id: 'fixture', updatedAt: '2026-10-10T00:00:00.000Z' },
    context: {
      activeLevelId: c.context.activeLevelId,
      selection: [],
      units: 'metric',
      catalogVersion: 'fixture',
      registryVersions: captureRegistryVersions(),
    },
    ids: effectIds(`effect:${c.label}`),
  })
  try {
    return attempt(() => ({
      result: scene.execute(c.operation, c.input as never, c.context),
      patch: scene.patch(),
    }))
  } finally {
    scene.dispose()
  }
}

/** On the editor's store, its document systems mounted. */
async function runLive(c: ParityCase, snapshot: SceneSnapshot) {
  const commits: SceneCommit[] = []
  const stop = subscribeSceneCommits((commit) => commits.push(commit))
  try {
    const outcome = attempt(() => {
      const result = withIdAllocator(effectIds(`effect:${c.label}`), () =>
        applyAgentOutcome(
          c.operation(liveSceneRuntime.reader().nodes, c.input as never, c.context),
          createAgentHost(liveSceneRuntime),
        ),
      )
      return { result, patch: diffSceneDocuments(snapshot, getSceneDocument()) }
    })
    const returned = commits.length
    const document = getSceneDocument()
    await settle()
    return { outcome, document, deferredCommits: commits.length - returned }
  } finally {
    stop()
  }
}

/** A canonical snapshot is one the editor's load-time normalisation leaves as it is. */
async function canonicalSnapshot(graph: SceneGraph): Promise<SceneSnapshot> {
  let snapshot = snapshotOf(graph)
  for (let opened = 0; opened < 3; opened++) {
    const settled = await openLiveScene(snapshot)
    if (Bun.deepEquals(settled, snapshot)) break
    snapshot = settled
  }
  return snapshot
}

describe('detached and live give the same complete patch', () => {
  afterAll(closeLiveScene)

  for (const c of CASES) {
    test.skipIf(c.label in EXCEPTIONS)(c.label, async () => {
      const snapshot = await canonicalSnapshot(c.scene())
      expect(await openLiveScene(snapshot)).toEqual(snapshot)
      const detached = runDetached(c, snapshot)
      const live = await runLive(c, snapshot)
      expect(live.deferredCommits).toBe(0)
      expect(getSceneDocument()).toEqual(live.document)
      expect(live.outcome).toEqual(detached)
      if ('refusal' in detached) return

      await openLiveScene(snapshot)
      const commits: SceneCommit[] = []
      const stop = subscribeSceneCommits((commit) => commits.push(commit))
      try {
        applySceneOperationPatch(detached.patch, { undoable: true })
        const applied = getSceneDocument()
        await settle()
        expect(commits).toHaveLength(isEmptyScenePatch(detached.patch) ? 0 : 1)
        expect(getSceneDocument()).toEqual(applied)
        expect(applied).toEqual(live.document)
      } finally {
        stop()
      }
    })
  }
})
