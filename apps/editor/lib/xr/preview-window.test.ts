import { describe, expect, test } from 'bun:test'
import { createXRPreviewSceneSnapshot } from './preview-window'

describe('XR preview scene handoff', () => {
  test('copies the complete live editor graph into the XR snapshot', () => {
    const wall = { id: 'wall_1', parentId: 'level_1', type: 'wall' }
    const state = {
      collections: { shell: { id: 'shell', nodeIds: ['wall_1'] } },
      installedPlugins: ['@pascal-app/plugin-example'],
      materials: { plaster: { id: 'plaster' } },
      nodes: {
        level_1: { children: ['wall_1'], id: 'level_1', type: 'level' },
        wall_1: wall,
      },
      rootNodeIds: ['level_1'],
    }

    expect(createXRPreviewSceneSnapshot(state)).toEqual(state)
    expect(createXRPreviewSceneSnapshot(state).nodes.wall_1).toBe(wall)
  })

  test('runs room-surface synchronization in the standalone XR editor', async () => {
    const source = await Bun.file(
      new URL('../../components/xr/xr-preview-environment.tsx', import.meta.url),
    ).text()

    expect(source).toContain('initSpaceDetectionSync(useScene, useEditor)')
    expect(source).toContain('unsubscribeSpaceDetection()')
  })
})
