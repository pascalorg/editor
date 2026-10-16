import { describe, expect, test } from 'bun:test'
import { type AnyNode, StairNode, useScene } from '@pascal-app/core'

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

test('loading a scene preserves legacy stair destination and snap preference under generic names', () => {
  const previous = useScene.getState()
  const legacy = {
    ...StairNode.parse({ id: 'stair_migration' }),
    landscapeSurfaceId: 'deck_1',
    autoLandscapeSnap: false,
  }
  try {
    useScene.getState().setScene({ [legacy.id]: legacy as AnyNode }, [legacy.id])
    const loaded = useScene.getState().nodes[legacy.id]
    expect(loaded).toMatchObject({ destinationSurfaceId: 'deck_1', autoSurfaceSnap: false })
    expect(loaded).not.toHaveProperty('landscapeSurfaceId')
    expect(loaded).not.toHaveProperty('autoLandscapeSnap')
  } finally {
    useScene.setState(previous, true)
  }
})
