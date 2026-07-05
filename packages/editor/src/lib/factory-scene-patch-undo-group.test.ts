import { beforeEach, describe, expect, test } from 'bun:test'
import { AssemblyNode, BoxNode, LevelNode, useScene } from '@pascal-app/core'
import { applyFactoryScenePatchesAsUndoGroup } from './factory-scene-patch-undo-group'

function resetScene(nodes: Record<string, ReturnType<typeof LevelNode.parse> | ReturnType<typeof AssemblyNode.parse> | ReturnType<typeof BoxNode.parse>>, rootNodeIds: string[]) {
  useScene.setState({
    collections: {},
    dirtyNodes: new Set(),
    nodes,
    rootNodeIds,
  } as never)
  useScene.temporal.getState().clear()
}

describe('factory scene patch undo group', () => {
  beforeEach(() => {
    resetScene({}, [])
  })

  test('applies a factory patch batch as one undoable scene change', () => {
    const level = LevelNode.parse({ id: 'level_undo_group', children: [] })
    const pump = BoxNode.parse({ id: 'box_undo_pump', name: 'Pump' })
    const motor = BoxNode.parse({ id: 'box_undo_motor', name: 'Motor' })
    resetScene({ [level.id]: level }, [level.id])

    const beforePastCount = useScene.temporal.getState().pastStates.length
    const result = applyFactoryScenePatchesAsUndoGroup({
      fallbackParentId: level.id,
      patches: [
        { op: 'create', parentId: level.id, node: pump },
        { op: 'create', parentId: level.id, node: motor },
        { op: 'update', id: pump.id, data: { name: 'Feed pump' } },
      ],
    })

    expect(result.applied).toBe(true)
    expect(useScene.temporal.getState().pastStates.length).toBe(beforePastCount + 1)
    expect(useScene.getState().nodes[pump.id]).toMatchObject({
      name: 'Feed pump',
      parentId: level.id,
    })
    expect(useScene.getState().nodes[level.id]).toMatchObject({
      children: [pump.id, motor.id],
    })

    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes[pump.id]).toBeUndefined()
    expect(useScene.getState().nodes[motor.id]).toBeUndefined()
    expect(useScene.getState().nodes[level.id]).toMatchObject({ children: [] })

    useScene.temporal.getState().redo()
    expect(useScene.getState().nodes[pump.id]).toMatchObject({ name: 'Feed pump' })
    expect(useScene.getState().nodes[motor.id]).toBeDefined()
  })

  test('keeps replacement batches undoable as one change', () => {
    const level = LevelNode.parse({ id: 'level_replace', children: ['assembly_station'] })
    const oldAssembly = AssemblyNode.parse({
      id: 'assembly_station',
      name: 'Old station',
      parentId: level.id,
      children: ['box_old_child'],
    })
    const oldChild = BoxNode.parse({
      id: 'box_old_child',
      name: 'Old child',
      parentId: oldAssembly.id,
    })
    const newAssembly = AssemblyNode.parse({
      id: oldAssembly.id,
      name: 'New station',
      parentId: level.id,
      children: [],
    })
    resetScene(
      {
        [level.id]: level,
        [oldAssembly.id]: oldAssembly,
        [oldChild.id]: oldChild,
      },
      [level.id],
    )

    applyFactoryScenePatchesAsUndoGroup({
      fallbackParentId: level.id,
      patches: [
        { op: 'delete', id: oldAssembly.id },
        { op: 'create', parentId: level.id, node: newAssembly },
      ],
    })

    expect(useScene.temporal.getState().pastStates.length).toBe(1)
    expect(useScene.getState().nodes[oldAssembly.id]).toMatchObject({ name: 'New station' })
    expect(useScene.getState().nodes[oldChild.id]).toBeUndefined()

    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes[oldAssembly.id]).toMatchObject({ name: 'Old station' })
    expect(useScene.getState().nodes[oldChild.id]).toMatchObject({ name: 'Old child' })
  })
})
