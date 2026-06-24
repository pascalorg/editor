// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { afterEach, describe, expect, test } from 'bun:test'
import { sceneRegistry, useScene } from '@pascal-app/core'
import { Object3D } from 'three'
import { SCENE_LAYER } from '../../lib/layers'
import { applySoloLevelVisibility, clearSoloLevelVisibility } from './level-solo-visibility'

afterEach(() => {
  clearSoloLevelVisibility()
  sceneRegistry.clear()
  useScene.setState({ dirtyNodes: new Set(), nodes: {}, rootNodeIds: [] })
})

describe('solo level visibility', () => {
  test('hides non-selected level roots with layers and restores them', () => {
    const lower = new Object3D()
    const upper = new Object3D()
    const upperChild = new Object3D()
    upper.add(upperChild)

    sceneRegistry.nodes.set('level_lower', lower)
    sceneRegistry.nodes.set('level_upper', upper)

    applySoloLevelVisibility('level_upper')

    expect(lower.layers.isEnabled(SCENE_LAYER)).toBe(false)
    expect(upper.layers.isEnabled(SCENE_LAYER)).toBe(true)
    expect(upperChild.layers.isEnabled(SCENE_LAYER)).toBe(true)

    clearSoloLevelVisibility()

    expect(lower.layers.isEnabled(SCENE_LAYER)).toBe(true)
    expect(upper.layers.isEnabled(SCENE_LAYER)).toBe(true)
    expect(upperChild.layers.isEnabled(SCENE_LAYER)).toBe(true)
  })

  test('keeps selected level descendants even when their Object3D is not nested yet', () => {
    const lower = new Object3D()
    const upper = new Object3D()
    const upperWall = new Object3D()

    sceneRegistry.nodes.set('level_lower', lower)
    sceneRegistry.nodes.set('level_upper', upper)
    sceneRegistry.nodes.set('wall_upper', upperWall)
    useScene.setState({
      nodes: {
        level_lower: { children: [], id: 'level_lower', type: 'level' },
        level_upper: { children: ['wall_upper'], id: 'level_upper', type: 'level' },
        wall_upper: { id: 'wall_upper', parentId: 'level_upper', type: 'wall' },
      } as never,
    })

    applySoloLevelVisibility('level_upper')

    expect(lower.layers.isEnabled(SCENE_LAYER)).toBe(false)
    expect(upper.layers.isEnabled(SCENE_LAYER)).toBe(true)
    expect(upperWall.layers.isEnabled(SCENE_LAYER)).toBe(true)
  })
})
