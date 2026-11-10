import { describe, expect, it } from 'bun:test'
import { doorDefinition } from './definition'
import { DoorNode } from './schema'

describe('door resize handles on non-wall hosts', () => {
  it('does not throw when host is not a standard wall node', () => {
    const door = DoorNode.parse({
      id: 'door_on_dormer',
      parentId: 'dormer_123',
      wallId: 'dormer_123',
      width: 1.0,
      height: 2.1,
      position: [1, 1.05, 0],
    })

    const dormerMock = {
      id: 'dormer_123',
      type: 'dormer',
    }

    const scene = {
      get: (id: string) => (id === 'dormer_123' ? dormerMock : undefined),
      nodes: () => ({ [dormerMock.id]: dormerMock as any }),
    }

    const handles =
      typeof doorDefinition.handles === 'function'
        ? doorDefinition.handles(door, scene as any)
        : (doorDefinition.handles ?? [])

    for (const handle of handles as any[]) {
      if (typeof handle.max === 'function') {
        expect(() => handle.max(door, scene as any)).not.toThrow()
      }
    }
  })
})
