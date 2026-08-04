import { beforeEach, describe, expect, test } from 'bun:test'
import useScene from './use-scene'

describe('loadScene default scene', () => {
  beforeEach(() => {
    useScene.setState({
      nodes: {},
      rootNodeIds: [],
      dirtyNodes: new Set(),
      collections: {},
    } as never)
    useScene.temporal.getState().clear()
  })

  test('links every default node to its parent', () => {
    useScene.getState().loadScene()

    const { nodes, rootNodeIds } = useScene.getState()
    const site = Object.values(nodes).find((node) => node.type === 'site')
    const building = Object.values(nodes).find((node) => node.type === 'building')
    const level = Object.values(nodes).find((node) => node.type === 'level')

    expect(site).toBeDefined()
    expect(building).toBeDefined()
    expect(level).toBeDefined()
    expect(rootNodeIds).toEqual([site?.id])

    // The hosted scene authority validates parent/child symmetry; a default
    // scene saved as-is must already satisfy it.
    expect(site?.parentId).toBeNull()
    expect(building?.parentId).toBe(site?.id as never)
    expect(level?.parentId).toBe(building?.id as never)
    expect(site && 'children' in site ? site.children : []).toEqual([building?.id])
    expect(building && 'children' in building ? building.children : []).toEqual([level?.id])
  })
})
