import { describe, expect, it } from 'bun:test'
import type { AnyNode } from '@pascal-app/core'
import { simplifyConvertedSceneGraph } from '../src/cleanup'

function level(id = 'level_1', children: string[] = []): AnyNode {
  return {
    object: 'node',
    id,
    type: 'level',
    name: 'Level',
    parentId: null,
    visible: true,
    level: 0,
    children,
  } as AnyNode
}

function wall(
  id: string,
  start: [number, number],
  end: [number, number],
  children: string[] = [],
): AnyNode {
  return {
    object: 'node',
    id,
    type: 'wall',
    name: id,
    parentId: 'level_1',
    visible: true,
    start,
    end,
    thickness: 0.2,
    height: 3,
    children,
    frontSide: 'unknown',
    backSide: 'unknown',
  } as AnyNode
}

function door(id: string, parentId: string, position: [number, number, number]): AnyNode {
  return {
    object: 'node',
    id,
    type: 'door',
    name: id,
    parentId,
    wallId: parentId,
    visible: true,
    width: 0.9,
    height: 2.1,
    position,
  } as AnyNode
}

function windowNode(id: string, parentId: string, position: [number, number, number]): AnyNode {
  return {
    object: 'node',
    id,
    type: 'window',
    name: id,
    parentId,
    wallId: parentId,
    visible: true,
    width: 1,
    height: 1.2,
    position,
  } as AnyNode
}

describe('simplifyConvertedSceneGraph', () => {
  it('merges collinear wall fragments across door-sized gaps', () => {
    const nodes: Record<string, AnyNode> = {
      level_1: level('level_1', ['wall_a', 'wall_b']),
      wall_a: wall('wall_a', [0, 0], [2, 0]),
      wall_b: wall('wall_b', [2.9, 0], [5, 0]),
    }

    const stats = simplifyConvertedSceneGraph(nodes)

    expect(stats.removedMergedWalls).toBe(1)
    expect(Object.values(nodes).filter((node) => node.type === 'wall')).toHaveLength(1)
    const keptWall = Object.values(nodes).find((node) => node.type === 'wall')
    expect(keptWall).toMatchObject({ start: [0, 0], end: [5, 0] })
    expect((nodes.level_1 as { children: string[] }).children).toEqual([keptWall?.id])
  })

  it('reprojects openings from removed walls onto the merged wall', () => {
    const nodes: Record<string, AnyNode> = {
      level_1: level('level_1', ['wall_a', 'wall_b']),
      wall_a: wall('wall_a', [0, 0], [2, 0]),
      wall_b: wall('wall_b', [2, 0], [4, 0], ['window_1']),
      window_1: windowNode('window_1', 'wall_b', [1, 1.4, 0]),
    }

    simplifyConvertedSceneGraph(nodes)

    const keptWall = Object.values(nodes).find((node) => node.type === 'wall')
    expect(Object.values(nodes).filter((node) => node.type === 'wall')).toHaveLength(1)
    expect(nodes.window_1).toMatchObject({
      parentId: keptWall?.id,
      wallId: keptWall?.id,
      position: [3, 1.4, 0],
    })
    expect((keptWall as { children: string[] }).children).toEqual(['window_1'])
  })

  it('removes duplicate openings hosted on the same wall', () => {
    const nodes: Record<string, AnyNode> = {
      level_1: level('level_1', ['wall_1']),
      wall_1: wall('wall_1', [0, 0], [4, 0], ['door_1', 'door_2']),
      door_1: door('door_1', 'wall_1', [1.5, 1.05, 0]),
      door_2: door('door_2', 'wall_1', [1.51, 1.05, 0]),
    }

    const stats = simplifyConvertedSceneGraph(nodes)

    expect(stats.removedDuplicateOpenings).toBe(1)
    expect(nodes.door_1).toBeDefined()
    expect(nodes.door_2).toBeUndefined()
    expect((nodes.wall_1 as { children: string[] }).children).toEqual(['door_1'])
  })
})
