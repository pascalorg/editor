import { beforeEach, describe, expect, test } from 'bun:test'
import useScene from './use-scene'

describe('default scene skeleton', () => {
  beforeEach(() => {
    useScene.getState().unloadScene()
    useScene.temporal.getState().clear()
  })

  test('creates bidirectional site building level parent links', () => {
    useScene.getState().loadScene()

    const { rootNodeIds } = useScene.getState()
    const nodes = useScene.getState().nodes as Record<string, unknown>
    const site = nodes[rootNodeIds[0]!] as { children: string[]; id: string; type: string }
    const building = nodes[site.children[0]!] as { children: string[]; id: string; parentId: string; type: string }
    const level = nodes[building.children[0]!] as { id: string; parentId: string; type: string }

    expect(site.type).toBe('site')
    expect(building.type).toBe('building')
    expect(building.parentId).toBe(site.id)
    expect(level.type).toBe('level')
    expect(level.parentId).toBe(building.id)
  })
})
