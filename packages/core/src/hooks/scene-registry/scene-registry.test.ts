import { describe, expect, test } from 'bun:test'
import { Group } from 'three'
import { sceneRegistry } from './scene-registry'

describe('sceneRegistry revision', () => {
  test('changes only when registered object membership changes', () => {
    sceneRegistry.clear()
    const initial = sceneRegistry.revision
    const object = new Group()

    sceneRegistry.nodes.set('wall_a', object)
    expect(sceneRegistry.revision).toBe(initial + 1)

    sceneRegistry.nodes.set('wall_a', object)
    expect(sceneRegistry.revision).toBe(initial + 1)

    sceneRegistry.nodes.delete('missing')
    expect(sceneRegistry.revision).toBe(initial + 1)

    sceneRegistry.nodes.delete('wall_a')
    expect(sceneRegistry.revision).toBe(initial + 2)
  })

  test('clear invalidates a populated registry once', () => {
    sceneRegistry.clear()
    sceneRegistry.nodes.set('wall_a', new Group())
    sceneRegistry.nodes.set('wall_b', new Group())
    const beforeClear = sceneRegistry.revision

    sceneRegistry.clear()
    expect(sceneRegistry.revision).toBe(beforeClear + 1)
  })
})
