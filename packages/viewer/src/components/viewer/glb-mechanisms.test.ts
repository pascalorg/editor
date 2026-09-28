import { describe, expect, test } from 'bun:test'
import { Object3D } from 'three'
import { bakedLoopMechanisms } from './glb-mechanisms'

function identityNode(userData: Record<string, unknown>): Object3D {
  const object = new Object3D()
  object.userData = userData
  return object
}

describe('baked loop mechanisms', () => {
  test("a plugin node's listed loop clips run as a mechanism, read from the GLB alone", () => {
    const identity = new Map([
      [
        'articraft_1',
        identityNode({
          pascalId: 'articraft_1',
          kind: 'articraft:asset',
          clips: ['articraft_1: loop'],
        }),
      ],
    ])
    expect(bakedLoopMechanisms(identity, new Set())).toEqual(
      new Map([['articraft_1', ['articraft_1: loop']]]),
    )
  })

  test('clips another controller plays, openables and nodes without clips are left alone', () => {
    const identity = new Map([
      // procedural playback or an interactive item already drives these
      ['fan_1', identityNode({ pascalId: 'fan_1', kind: 'item', clips: ['fan_1: loop'] })],
      [
        'procedural_1',
        identityNode({
          pascalId: 'procedural_1',
          kind: 'procedural-item',
          clips: ['procedural_1:blade: loop'],
        }),
      ],
      // doors, windows, cabinets: toggled by the openable path
      [
        'door_1',
        identityNode({ pascalId: 'door_1', kind: 'door', openable: true, clips: ['door_1: open'] }),
      ],
      ['wall_1', identityNode({ pascalId: 'wall_1', kind: 'wall' })],
    ])
    expect(bakedLoopMechanisms(identity, new Set(['fan_1', 'procedural_1'])).size).toBe(0)
  })
})
