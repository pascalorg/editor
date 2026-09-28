import { describe, expect, test } from 'bun:test'
import { StairNode } from './stair'

describe('StairNode landscape connection', () => {
  test('defaults magnetic landscape snapping on and preserves its surface link', () => {
    const legacy = StairNode.parse({ id: 'stair_legacy', type: 'stair' })
    expect(legacy.autoLandscapeSnap).toBeUndefined()
    expect(legacy.landscapeSurfaceId).toBeUndefined()

    const attached = StairNode.parse({
      ...legacy,
      autoLandscapeSnap: false,
      landscapeSurfaceId: 'patio_1',
    })
    expect(attached.autoLandscapeSnap).toBe(false)
    expect(attached.landscapeSurfaceId).toBe('patio_1')
    expect(StairNode.parse(JSON.parse(JSON.stringify(attached)))).toMatchObject({
      autoLandscapeSnap: false,
      landscapeSurfaceId: 'patio_1',
    })
  })
})
