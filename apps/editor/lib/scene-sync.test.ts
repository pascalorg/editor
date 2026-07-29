import { describe, expect, test } from 'bun:test'
import {
  isRemoteSceneEcho,
  sceneGraphSignature,
  type PersistedSceneGraph,
} from './scene-sync'

function makeGraph(materialName = 'Accent'): PersistedSceneGraph {
  return {
    nodes: {},
    rootNodeIds: [],
    materials: {
      mat_accent: {
        id: 'mat_accent',
        name: materialName,
        material: { preset: 'custom', properties: { color: '#123456' } },
      },
    },
  }
}

describe('isRemoteSceneEcho', () => {
  test('recognizes only the exact remote graph', () => {
    const remote = makeGraph()

    expect(isRemoteSceneEcho(sceneGraphSignature(remote), sceneGraphSignature(remote))).toBe(true)
  })

  test('does not suppress a local material change', () => {
    const remote = makeGraph()
    const local = makeGraph('Updated accent')

    expect(isRemoteSceneEcho(sceneGraphSignature(remote), sceneGraphSignature(local))).toBe(false)
  })
})
