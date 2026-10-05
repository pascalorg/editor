import { afterEach, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import useScene from '../../store/use-scene'
import { transformZone } from './transform-zone'

afterEach(() => useScene.getState().unloadScene())

test('moving a room in a legacy house tolerates another zone without boundary lists', () => {
  const source = JSON.parse(
    readFileSync(
      new URL('../../utils/__fixtures__/project_hrY3qVVq16yo5Out.json', import.meta.url),
      'utf8',
    ),
  )
  useScene.getState().setScene(source, [])
  const nodes = { ...useScene.getState().nodes }
  const pool = Object.values(nodes).find(
    (node) => node.type === 'zone' && node.name === 'Swimming Pool',
  )
  const room = Object.values(nodes).find(
    (node) => node.type === 'zone' && node.name === 'Living Room',
  )
  // Loading fills the default lists; a graph from another writer may still omit them.
  expect(pool?.type).toBe('zone')
  const { boundaryWallIds: _walls, ...bare } = pool as Record<string, unknown>
  nodes[pool!.id] = bare as never
  expect(room?.type).toBe('zone')
  let serial = 0
  const plan = transformZone(nodes, {
    zoneId: room!.id,
    translate: [0.1, 0],
    mintId: (kind) => `${kind}_legacy_move_${serial++}`,
  })
  expect(plan.conflicts).toBeUndefined()
  expect(plan.changes.length).toBeGreaterThan(0)
})
