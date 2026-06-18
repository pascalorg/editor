import { describe, expect, test } from 'bun:test'
import type { SceneGraph } from './scene'
import { prepareSceneGraphForSave } from './scene-save'

describe('prepareSceneGraphForSave', () => {
  test('removes transient placement metadata without mutating the live scene graph', () => {
    const scene: SceneGraph = {
      nodes: {
        assembly_generated: {
          id: 'assembly_generated',
          type: 'assembly',
          metadata: {
            generatedBy: 'ai-chat',
            isNew: true,
          },
        },
      },
      rootNodeIds: ['assembly_generated'],
    }

    const prepared = prepareSceneGraphForSave(scene)

    expect(prepared.nodes.assembly_generated).toMatchObject({
      metadata: { generatedBy: 'ai-chat' },
    })
    expect(prepared.nodes.assembly_generated).not.toMatchObject({
      metadata: { isNew: true },
    })
    expect(scene.nodes.assembly_generated).toMatchObject({
      metadata: { isNew: true },
    })
  })
})
