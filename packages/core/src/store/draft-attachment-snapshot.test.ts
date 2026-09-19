import { expect, test } from 'bun:test'
import type { ProceduralItemNode } from '../procedural-items'
import { LevelNode } from '../schema/nodes/level'
import type { AnyNode, AnyNodeId } from '../schema/types'
import { subscribeSceneCommits } from './history-control'
import useScene from './use-scene'

test('draft snapshots do not enumerate unaffected procedural attachment maps', () => {
  const saved = useScene.getState()
  const level = LevelNode.parse({})
  const draft = LevelNode.parse({ metadata: { isNew: true } })
  let enumerations = 0
  let reads = 0
  const maps = Array.from(
    { length: 1000 },
    (_, i) =>
      new Proxy(
        Object.fromEntries(Array.from({ length: 100 }, (_, j) => [`item_${i}_${j}`, 'top'])),
        {
          ownKeys(target) {
            enumerations++
            return Reflect.ownKeys(target)
          },
          get(target, key, receiver) {
            reads++
            return Reflect.get(target, key, receiver)
          },
        },
      ),
  )
  const nodes = Object.fromEntries([
    [level.id, level],
    [draft.id, draft],
    ...maps.map((attachments, i) => {
      const id = `procedural-item_${i}` as AnyNodeId
      return [
        id,
        { id, type: 'procedural-item', metadata: {}, children: [], attachments } as AnyNode,
      ]
    }),
  ]) as Record<AnyNodeId, AnyNode>
  const stop = subscribeSceneCommits((commit) => {
    expect(commit.current.nodes[draft.id]).toBeUndefined()
    expect((commit.current.nodes['procedural-item_0'] as ProceduralItemNode).attachments).toBe(
      maps[0]!,
    )
  })
  try {
    useScene.temporal.getState().pause()
    useScene.setState({
      nodes,
      rootNodeIds: [level.id, draft.id],
      collections: {},
      materials: {},
      installedPlugins: [],
    })
    useScene.temporal.getState().clear()
    enumerations = 0
    reads = 0
    useScene.temporal.getState().resume()
    useScene.getState().updateNode(level.id, { name: 'Snapshot trigger' })
    console.log(`100k attachment snapshot: enumerations=${enumerations}, entry reads=${reads}`)
    expect(enumerations).toBe(0)
    expect(reads).toBe(0)
  } finally {
    stop()
    useScene.temporal.getState().pause()
    useScene.setState(saved)
    useScene.temporal.getState().clear()
    useScene.temporal.getState().resume()
  }
})
