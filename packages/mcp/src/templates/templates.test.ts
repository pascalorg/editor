import { describe, expect, test } from 'bun:test'
import { AnyNode } from '@pascal-app/core/schema'
import { TEMPLATES, type TemplateId } from './index'

describe('scene templates', () => {
  const ids: TemplateId[] = Object.keys(TEMPLATES) as TemplateId[]

  for (const id of ids) {
    const entry = TEMPLATES[id]

    test(`${id} has required metadata`, () => {
      expect(entry.id).toBe(id)
      expect(typeof entry.name).toBe('string')
      expect(entry.name.length).toBeGreaterThan(0)
      expect(typeof entry.description).toBe('string')
      expect(entry.description.length).toBeGreaterThan(0)
    })

    test(`${id} template nodes all pass AnyNode.safeParse`, () => {
      const { nodes, rootNodeIds } = entry.template
      expect(rootNodeIds.length).toBeGreaterThan(0)
      expect(Object.keys(nodes).length).toBeGreaterThan(0)

      for (const [nodeId, node] of Object.entries(nodes)) {
        const res = AnyNode.safeParse(node)
        if (!res.success) {
          // Surface the path/message of the first issue for debuggability.
          const first = res.error.issues[0]
          throw new Error(
            `template ${id} node ${nodeId} failed AnyNode.safeParse at ${first?.path.join('.')}: ${first?.message}`,
          )
        }
        expect(res.success).toBe(true)
      }
    })

    test(`${id} root ids resolve and parent links point to existing nodes`, () => {
      const { nodes, rootNodeIds } = entry.template
      for (const rid of rootNodeIds) {
        expect(nodes[rid]).toBeDefined()
      }
      for (const node of Object.values(nodes)) {
        if (node.parentId && !(node.parentId in nodes)) {
          throw new Error(
            `template ${id} node ${node.id} has parentId ${node.parentId} which does not exist`,
          )
        }
      }
    })
  }

  test('empty-studio has 4 walls, 1 zone, 1 door, 1 window', () => {
    const { nodes } = TEMPLATES['empty-studio'].template
    const byType = groupByType(nodes)
    expect(byType.wall ?? 0).toBe(4)
    expect(byType.zone ?? 0).toBe(1)
    expect(byType.door ?? 0).toBe(1)
    expect(byType.window ?? 0).toBe(1)
  })

  test('two-bedroom has 9 walls, 4 zones, 4 doors, 5 windows', () => {
    const { nodes } = TEMPLATES['two-bedroom'].template
    const byType = groupByType(nodes)
    expect(byType.wall ?? 0).toBe(9)
    expect(byType.zone ?? 0).toBe(4)
    expect(byType.door ?? 0).toBe(4)
    expect(byType.window ?? 0).toBe(5)
  })

  test('garden-house has a fenced garden zone', () => {
    const { nodes } = TEMPLATES['garden-house'].template
    const byType = groupByType(nodes)
    expect(byType.zone ?? 0).toBeGreaterThanOrEqual(2)
    expect(byType.fence ?? 0).toBeGreaterThanOrEqual(3)
    expect(byType.wall ?? 0).toBeGreaterThanOrEqual(4)
  })
})

function groupByType(nodes: Record<string, { type: string }>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const node of Object.values(nodes)) {
    out[node.type] = (out[node.type] ?? 0) + 1
  }
  return out
}
