import { afterEach, describe, expect, test } from 'bun:test'
import { type AnyNode, emitter, sceneRegistry } from '@pascal-app/core'
import { useNodeEvents } from '@pascal-app/viewer'
import type { ThreeEvent } from '@react-three/fiber'
import { Group, Mesh, Vector3 } from 'three'

afterEach(() => {
  sceneRegistry.clear()
})

describe('node event ownership', () => {
  test('emits a nested raycast hit only for its closest registered node', () => {
    const wall = { id: 'wall_event_owner', type: 'wall' } as unknown as AnyNode
    const level = { id: 'level_event_parent', type: 'level' } as unknown as AnyNode
    const levelObject = new Group()
    const wallObject = new Group()
    const hitObject = new Mesh()
    wallObject.add(hitObject)
    levelObject.add(wallObject)
    sceneRegistry.nodes.set(level.id, levelObject)
    sceneRegistry.nodes.set(wall.id, wallObject)
    sceneRegistry.nodeIds.set(levelObject, level.id)
    sceneRegistry.nodeIds.set(wallObject, wall.id)

    const emitted: string[] = []
    const onWallMove = () => emitted.push('wall')
    const onLevelMove = () => emitted.push('level')
    emitter.on('wall:move', onWallMove)
    emitter.on('level:move', onLevelMove)

    const event = {
      face: null,
      faceIndex: null,
      object: hitObject,
      point: new Vector3(1, 1, 0),
      stopPropagation: () => {},
    } as unknown as ThreeEvent<PointerEvent>

    useNodeEvents(wall as never, 'wall').onPointerMove(event)
    useNodeEvents(level as never, 'level').onPointerMove(event)

    emitter.off('wall:move', onWallMove)
    emitter.off('level:move', onLevelMove)
    expect(emitted).toEqual(['wall'])
  })
})
