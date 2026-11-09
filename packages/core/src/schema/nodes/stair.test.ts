import { describe, expect, test } from 'bun:test'
import { StairNode } from '@pascal-app/core'

describe('StairNode surface connection', () => {
  test('defaults magnetic surface snapping on and preserves its surface link', () => {
    const legacy = StairNode.parse({ id: 'stair_legacy', type: 'stair' })
    expect(legacy.autoSurfaceSnap).toBeUndefined()
    expect(legacy.destinationSurfaceId).toBeUndefined()

    const attached = StairNode.parse({
      ...legacy,
      autoSurfaceSnap: false,
      destinationSurfaceId: 'patio_1',
    })
    expect(attached.autoSurfaceSnap).toBe(false)
    expect(attached.destinationSurfaceId).toBe('patio_1')
    expect(StairNode.parse(JSON.parse(JSON.stringify(attached)))).toMatchObject({
      autoSurfaceSnap: false,
      destinationSurfaceId: 'patio_1',
    })
  })
})
