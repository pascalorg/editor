import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import { SqliteSceneStore } from './sqlite-scene-store'
import { SceneNotFoundError } from './types'

function makeGraph(): SceneGraph {
  return {
    nodes: {
      site_abc: {
        object: 'node',
        id: 'site_abc',
        type: 'site',
        parentId: null,
        visible: true,
        metadata: {},
      },
    } as SceneGraph['nodes'],
    rootNodeIds: ['site_abc'] as SceneGraph['rootNodeIds'],
  }
}

describe('agent request queue', () => {
  let root: string
  let store: SqliteSceneStore
  let sceneId: string
  let otherSceneId: string

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'pascal-agent-req-'))
    store = new SqliteSceneStore({ databasePath: path.join(root, 'pascal.db') })
    sceneId = (await store.save({ name: 'Plan', graph: makeGraph() })).id
    otherSceneId = (await store.save({ name: 'Other', graph: makeGraph() })).id
  })

  afterEach(async () => {
    store.close()
    await fs.rm(root, { recursive: true, force: true })
  })

  test('a queued prompt comes back to the agent that claims it', async () => {
    await store.createAgentRequest({ sceneId, prompt: 'thin the interior walls to 10cm' })

    const claimed = await store.claimNextAgentRequest(sceneId)

    expect(claimed?.prompt).toBe('thin the interior walls to 10cm')
    expect(claimed?.status).toBe('claimed')
    expect(claimed?.claimedAt).toBeTruthy()
  })

  // The whole reason claiming is a transaction: two agents polling at once must
  // not both act on one prompt.
  test('a request is claimed exactly once', async () => {
    await store.createAgentRequest({ sceneId, prompt: 'only me' })

    const first = await store.claimNextAgentRequest(sceneId)
    const second = await store.claimNextAgentRequest(sceneId)

    expect(first?.prompt).toBe('only me')
    expect(second).toBeNull()
  })

  test('claims oldest first so the user gets answered in order', async () => {
    await store.createAgentRequest({ sceneId, prompt: 'first' })
    await store.createAgentRequest({ sceneId, prompt: 'second' })

    expect((await store.claimNextAgentRequest(sceneId))?.prompt).toBe('first')
    expect((await store.claimNextAgentRequest(sceneId))?.prompt).toBe('second')
  })

  // An agent watching one drawing must not pick up a prompt meant for another.
  test('scoping to a scene leaves another scene queue alone', async () => {
    await store.createAgentRequest({ sceneId: otherSceneId, prompt: 'for the other plan' })

    expect(await store.claimNextAgentRequest(sceneId)).toBeNull()
    expect((await store.claimNextAgentRequest(otherSceneId))?.prompt).toBe('for the other plan')
  })

  test('an unscoped claim takes from any scene and says which', async () => {
    await store.createAgentRequest({ sceneId: otherSceneId, prompt: 'anywhere' })

    const claimed = await store.claimNextAgentRequest()

    expect(claimed?.sceneId).toBe(otherSceneId)
  })

  test('an answer lands on the request so the editor can show it', async () => {
    const created = await store.createAgentRequest({ sceneId, prompt: 'how many walls?' })
    await store.claimNextAgentRequest(sceneId)

    const answered = await store.answerAgentRequest(created.requestId, 'Twelve.')

    expect(answered?.status).toBe('answered')
    expect(answered?.answer).toBe('Twelve.')
    expect(answered?.answeredAt).toBeTruthy()
  })

  test('lists a scene queue in order, with status', async () => {
    await store.createAgentRequest({ sceneId, prompt: 'one' })
    const two = await store.createAgentRequest({ sceneId, prompt: 'two' })
    await store.claimNextAgentRequest(sceneId)
    await store.answerAgentRequest(two.requestId, 'done')

    const listed = await store.listAgentRequests(sceneId)

    expect(listed.map((r) => r.prompt)).toEqual(['one', 'two'])
    expect(listed.map((r) => r.status)).toEqual(['claimed', 'answered'])
  })

  test('refuses a prompt for a scene that does not exist', async () => {
    await expect(
      store.createAgentRequest({ sceneId: 'nope', prompt: 'anything' }),
    ).rejects.toBeInstanceOf(SceneNotFoundError)
  })

  test('refuses an empty prompt rather than queueing a no-op', async () => {
    await expect(store.createAgentRequest({ sceneId, prompt: '   ' })).rejects.toThrow()
  })

  test('nothing to claim is null, not an error', async () => {
    expect(await store.claimNextAgentRequest(sceneId)).toBeNull()
  })
})
