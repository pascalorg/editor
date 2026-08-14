import { describe, expect, test } from 'bun:test'
import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import { buildTools } from './chat-ai'

/**
 * The chat side of the box-out tool.
 *
 * The node construction and the refusal are shared with the MCP surface and
 * covered there; this file asserts what the graph the tool actually mutates
 * ends up holding — the void parented to its host, in the host's children (so
 * the next scene load keeps it rather than sweeping it), and a mutation
 * recorded. A box-out written with no parent would survive the reply and vanish
 * on the next load, which is the failure this file exists to make visible.
 */

type ToolMap = ReturnType<typeof buildTools>

function scene(): { graph: SceneGraph; tools: ToolMap; mutations: () => number } {
  const graph = {
    nodes: {
      site_1: {
        object: 'node',
        id: 'site_1',
        type: 'site',
        parentId: null,
        visible: true,
        metadata: {},
        children: ['building_1'],
      },
      building_1: {
        object: 'node',
        id: 'building_1',
        type: 'building',
        parentId: 'site_1',
        visible: true,
        metadata: {},
        children: ['level_1'],
      },
      level_1: {
        object: 'node',
        id: 'level_1',
        type: 'level',
        parentId: 'building_1',
        visible: true,
        metadata: {},
        children: ['wall_1'],
        elevation: 0,
        height: 3,
      },
      wall_1: {
        object: 'node',
        id: 'wall_1',
        type: 'wall',
        parentId: 'level_1',
        visible: true,
        metadata: {},
        children: [],
        start: [0, 0],
        end: [6, 0],
        thickness: 0.25,
        height: 3,
        frontSide: 'unknown',
        backSide: 'unknown',
      },
    },
    rootNodeIds: ['site_1'],
  } as unknown as SceneGraph
  let mutations = 0
  const tools = buildTools(graph, [], () => {
    mutations++
  })
  return { graph, tools, mutations: () => mutations }
}

const call = (tools: ToolMap, name: keyof ToolMap, input: unknown): Promise<string> =>
  (tools[name].execute as (i: unknown) => Promise<string>)(input)

describe('add_box_out', () => {
  test('records the void on its host: parented, in the host children, one mutation', async () => {
    const made = scene()

    const reply = await call(made.tools, 'add_box_out', {
      elementId: 'wall_1',
      position: [2.5, 1.5, 0],
      width: 0.4,
      height: 0.6,
      draftAngleDeg: 1.5,
      chamferStrips: true,
    })

    expect(reply).toContain('box-out')
    expect(reply).toContain('1.5° draft')
    const id = /box-out ([A-Za-z0-9_-]+)/.exec(reply)?.[1]
    expect(id).toBeDefined()

    const boxOut = made.graph.nodes[id as keyof typeof made.graph.nodes] as
      | { type: string; parentId: string; width: number; height: number }
      | undefined
    expect(boxOut).toBeDefined()
    expect(boxOut?.type).toBe('formwork-box-out')
    expect(boxOut?.parentId).toBe('wall_1')
    expect(boxOut?.width).toBe(0.4)
    expect(boxOut?.height).toBe(0.6)

    const wall = made.graph.nodes.wall_1 as unknown as { children?: string[] }
    expect(wall.children).toContain(id)
    expect(made.mutations()).toBe(1)
  })

  test('refuses anything but a wall or a slab, without mutating', async () => {
    const made = scene()

    const reply = await call(made.tools, 'add_box_out', {
      elementId: 'level_1',
      position: [1, 1, 0],
      width: 0.4,
      height: 0.6,
    })

    expect(reply).toContain('wall or a slab')
    expect(made.mutations()).toBe(0)
  })
})
