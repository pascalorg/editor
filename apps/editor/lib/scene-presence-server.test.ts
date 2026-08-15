import { describe, expect, test } from 'bun:test'
import { ScenePresenceHub } from './scene-presence-server'

const participant = {
  actorId: 'alice',
  color: '#2563eb',
  cursor: { x: 0.25, y: 0.75 },
  name: 'Alice',
  selectedIds: ['wall_a'],
}

describe('scene presence hub', () => {
  test('broadcasts room snapshots and removes disconnected actors', () => {
    const hub = new ScenePresenceHub(() => 1_000)
    const snapshots: string[][] = []
    const unsubscribe = hub.subscribe('scene-a', (participants) => {
      snapshots.push(participants.map(({ actorId }) => actorId))
    })
    expect(hub.hasRoom('scene-a')).toBe(true)

    hub.upsert('scene-a', participant)
    hub.upsert('scene-a', { ...participant, actorId: 'bob', name: 'Bob' })
    hub.remove('scene-a', 'alice')
    unsubscribe()
    expect(hub.hasRoom('scene-a')).toBe(true)

    expect(snapshots).toEqual([[], ['alice'], ['alice', 'bob'], ['bob']])
  })

  test('isolates rooms and expires actors without a heartbeat', () => {
    let now = 1_000
    const hub = new ScenePresenceHub(() => now)
    hub.upsert('scene-a', participant)
    hub.upsert('scene-b', { ...participant, actorId: 'bob' })

    now += 15_001

    expect(hub.snapshot('scene-a')).toEqual([])
    expect(hub.snapshot('scene-b')).toEqual([])
    expect(hub.hasRoom('scene-a')).toBe(false)
  })
})
