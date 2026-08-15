import { describe, expect, test } from 'bun:test'
import { BuildingNode } from '../schema/nodes/building'
import { LevelNode } from '../schema/nodes/level'
import type { AnyNode, AnyNodeId } from '../schema/types'
import type { SceneCommit } from '../store/history-control'
import useScene, { clearSceneHistory } from '../store/use-scene'
import {
  ActorCollaborationHistory,
  applyCollaborationBatch,
  collaborationSnapshot,
  createCollaborationBatch,
  SceneCollaborationDocument,
  subscribeCollaborationCommits,
} from './scene-collaboration'

type RafFn = (callback: (time: number) => void) => number
;(globalThis as unknown as { requestAnimationFrame?: RafFn }).requestAnimationFrame ??= (
  callback,
) => {
  callback(0)
  return 0
}
;(globalThis as unknown as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame ??=
  () => {}

const BUILDING_ID = 'building_collaboration' as AnyNodeId
const LEVEL_A_ID = 'level_collaboration_a' as AnyNodeId
const LEVEL_B_ID = 'level_collaboration_b' as AnyNodeId

function baseSnapshot() {
  const levelA = LevelNode.parse({
    id: LEVEL_A_ID,
    parentId: BUILDING_ID,
    children: [],
    level: 0,
    name: 'Ground',
  })
  const levelB = LevelNode.parse({
    id: LEVEL_B_ID,
    parentId: BUILDING_ID,
    children: [],
    level: 1,
    name: 'First',
  })
  const building = BuildingNode.parse({
    id: BUILDING_ID,
    parentId: null,
    children: [LEVEL_A_ID, LEVEL_B_ID],
  })
  return collaborationSnapshot(
    { [BUILDING_ID]: building, [LEVEL_A_ID]: levelA, [LEVEL_B_ID]: levelB },
    [BUILDING_ID],
  )
}

function changedNode(snapshot: ReturnType<typeof baseSnapshot>, id: AnyNodeId, data: object) {
  return {
    ...snapshot,
    nodes: { ...snapshot.nodes, [id]: { ...snapshot.nodes[id], ...data } as AnyNode },
  }
}

describe('scene collaboration', () => {
  test('converges when independent property batches arrive in opposite orders', () => {
    const baseline = baseSnapshot()
    const renamed = changedNode(baseline, LEVEL_A_ID, { name: 'Lobby' })
    const raised = changedNode(baseline, LEVEL_A_ID, { level: 4 })
    const renameBatch = createCollaborationBatch(baseline, renamed, {
      actorId: 'alice',
      clock: 1,
      operationId: 'rename',
    })
    const raiseBatch = createCollaborationBatch(baseline, raised, {
      actorId: 'bob',
      clock: 1,
      operationId: 'raise',
    })
    const first = new SceneCollaborationDocument(baseline)
    const second = new SceneCollaborationDocument(baseline)

    first.merge(renameBatch)
    const firstResult = first.merge(raiseBatch)
    second.merge(raiseBatch)
    const secondResult = second.merge(renameBatch)

    expect(firstResult.snapshot).toEqual(secondResult.snapshot)
    expect(firstResult.snapshot.nodes[LEVEL_A_ID]).toMatchObject({ name: 'Lobby', level: 4 })
  })

  test('resolves concurrent reciprocal moves without producing a cycle', () => {
    const baseline = collaborationSnapshot(
      {
        [LEVEL_A_ID]: LevelNode.parse({ id: LEVEL_A_ID, parentId: null, children: [] }),
        [LEVEL_B_ID]: LevelNode.parse({ id: LEVEL_B_ID, parentId: null, children: [] }),
      },
      [LEVEL_A_ID, LEVEL_B_ID],
    )
    const aUnderB = structuredClone(baseline)
    aUnderB.nodes[LEVEL_A_ID] = { ...aUnderB.nodes[LEVEL_A_ID], parentId: LEVEL_B_ID } as AnyNode
    aUnderB.nodes[LEVEL_B_ID] = { ...aUnderB.nodes[LEVEL_B_ID], children: [LEVEL_A_ID] } as AnyNode
    aUnderB.rootNodeIds = [LEVEL_B_ID]
    const bUnderA = structuredClone(baseline)
    bUnderA.nodes[LEVEL_B_ID] = { ...bUnderA.nodes[LEVEL_B_ID], parentId: LEVEL_A_ID } as AnyNode
    bUnderA.nodes[LEVEL_A_ID] = { ...bUnderA.nodes[LEVEL_A_ID], children: [LEVEL_B_ID] } as AnyNode
    bUnderA.rootNodeIds = [LEVEL_A_ID]

    const document = new SceneCollaborationDocument(baseline)
    document.merge(
      createCollaborationBatch(baseline, aUnderB, {
        actorId: 'alice',
        clock: 2,
        operationId: 'move-a',
      }),
    )
    const result = document.merge(
      createCollaborationBatch(baseline, bUnderA, {
        actorId: 'bob',
        clock: 2,
        operationId: 'move-b',
      }),
    )

    const aParent = result.snapshot.nodes[LEVEL_A_ID]?.parentId
    const bParent = result.snapshot.nodes[LEVEL_B_ID]?.parentId
    expect(aParent === LEVEL_B_ID && bParent === LEVEL_A_ID).toBe(false)
    expect(result.conflicts.some((conflict) => conflict.code === 'parent-cycle')).toBe(true)
  })

  test('rescues a child added below a deleted node to the root', () => {
    const baseline = baseSnapshot()
    const deleted = structuredClone(baseline)
    delete deleted.nodes[LEVEL_A_ID]
    deleted.nodes[BUILDING_ID] = {
      ...deleted.nodes[BUILDING_ID],
      children: [LEVEL_B_ID],
    } as AnyNode
    const childId = 'level_collaboration_child' as AnyNodeId
    const withChild = structuredClone(baseline)
    withChild.nodes[childId] = LevelNode.parse({
      id: childId,
      parentId: LEVEL_A_ID,
      children: [],
      level: 2,
    })
    withChild.nodes[LEVEL_A_ID] = {
      ...withChild.nodes[LEVEL_A_ID],
      children: [childId],
    } as AnyNode

    const document = new SceneCollaborationDocument(baseline)
    document.merge(
      createCollaborationBatch(baseline, deleted, {
        actorId: 'alice',
        clock: 1,
        operationId: 'delete',
      }),
    )
    const result = document.merge(
      createCollaborationBatch(baseline, withChild, {
        actorId: 'bob',
        clock: 2,
        operationId: 'add-child',
      }),
    )

    expect(result.snapshot.nodes[childId]?.parentId).toBeNull()
    expect(result.snapshot.rootNodeIds).toContain(childId)
  })

  test("undoes only the actor's fields and preserves a newer remote field", () => {
    const baseline = baseSnapshot()
    const local = changedNode(baseline, LEVEL_A_ID, { level: 2, name: 'Local name' })
    const remote = changedNode(local, LEVEL_A_ID, { name: 'Remote name' })
    const history = new ActorCollaborationHistory('alice')
    history.record({ before: baseline, current: local })

    const undone = history.undo(remote, { clock: 4, operationId: 'undo-local' })

    expect(undone).not.toBeNull()
    expect(undone?.snapshot.nodes[LEVEL_A_ID]).toMatchObject({
      level: 0,
      name: 'Remote name',
    })
    expect(undone?.batch.actorId).toBe('alice')

    const redone = history.redo(undone!.snapshot, { clock: 5, operationId: 'redo-local' })
    expect(redone?.snapshot.nodes[LEVEL_A_ID]).toMatchObject({
      level: 2,
      name: 'Remote name',
    })
  })

  test('coalesces reconciliation writes into the transmitted commit', async () => {
    const baseline = baseSnapshot()
    useScene.setState({
      ...baseline,
      dirtyNodes: new Set<AnyNodeId>(),
      comments: {},
      readOnly: false,
    } as never)
    clearSceneHistory()
    const derivedId = 'level_collaboration_derived' as AnyNodeId
    let reconciling = false
    const stopReconciler = useScene.subscribe((state, previous) => {
      if (reconciling || state.nodes[LEVEL_A_ID] === previous.nodes[LEVEL_A_ID]) return
      reconciling = true
      useScene.getState().createNode(
        LevelNode.parse({
          id: derivedId,
          parentId: BUILDING_ID,
          children: [],
          level: 8,
        }),
        BUILDING_ID,
      )
      reconciling = false
    })
    const commits: SceneCommit[] = []
    const stopCollaboration = subscribeCollaborationCommits(
      () => {
        const state = useScene.getState()
        return collaborationSnapshot(state.nodes, state.rootNodeIds, state)
      },
      (commit) => commits.push(commit),
    )

    useScene.getState().updateNode(LEVEL_A_ID, { name: 'Triggers reconciliation' })
    await Promise.resolve()

    stopCollaboration()
    stopReconciler()
    expect(commits).toHaveLength(1)
    expect(commits[0]?.current.nodes[derivedId]).toBeDefined()
    const batch = createCollaborationBatch(commits[0]!.before, commits[0]!.current, {
      actorId: 'alice',
      clock: 1,
      operationId: 'reconciled',
    })
    expect(
      batch.changes.some((change) => change.type === 'node-create' && change.node.id === derivedId),
    ).toBe(true)
  })

  test('applies a batch idempotently through a collaboration document', () => {
    const baseline = baseSnapshot()
    const current = changedNode(baseline, LEVEL_A_ID, { name: 'Idempotent' })
    const batch = createCollaborationBatch(baseline, current, {
      actorId: 'alice',
      clock: 1,
      operationId: 'same-operation',
    })
    const document = new SceneCollaborationDocument(baseline)
    const once = document.merge(batch)
    const twice = document.merge(batch)

    expect(twice.snapshot).toEqual(once.snapshot)
    expect(applyCollaborationBatch(baseline, batch).snapshot.nodes[LEVEL_A_ID]?.name).toBe(
      'Idempotent',
    )

    const reusedId = createCollaborationBatch(
      baseline,
      changedNode(baseline, LEVEL_A_ID, { name: 'Must be ignored' }),
      { actorId: 'alice', clock: 2, operationId: 'same-operation' },
    )
    expect(document.merge(reusedId).snapshot.nodes[LEVEL_A_ID]?.name).toBe('Idempotent')
  })

  test('does not let field patches rewrite node identity or structure', () => {
    const baseline = baseSnapshot()
    const result = applyCollaborationBatch(baseline, {
      protocol: 1,
      actorId: 'hostile',
      clock: 1,
      operationId: 'reserved-fields',
      changes: [
        {
          type: 'node-fields',
          nodeId: LEVEL_A_ID,
          removed: [],
          values: {
            id: 'level_rekeyed',
            parentId: null,
            children: [BUILDING_ID],
            name: 'Allowed field',
          },
        },
      ],
    })

    expect(result.snapshot.nodes[LEVEL_A_ID]).toMatchObject({
      children: [],
      id: LEVEL_A_ID,
      parentId: BUILDING_ID,
      name: 'Allowed field',
    })
  })
})
