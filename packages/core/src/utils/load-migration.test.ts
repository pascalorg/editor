import { expect, spyOn, test } from 'bun:test'
import { loadMigration, loadNodeView } from './load-migration'

const raw = () => ({
  wall: { id: 'wall', type: 'wall', start: [0, 0], end: [4, 0] },
  door: { id: 'door', type: 'door', parentId: 'wall', offset: 1 },
  slab: { id: 'slab', type: 'slab', polygon: [], metadata: { keep: true } },
})

test('the view supplies container defaults and leaves scalar absences for migrations to read', () => {
  const source = raw()
  const { view } = loadNodeView(source)
  expect(view.wall).toMatchObject({ children: [], metadata: {} })
  expect(view.door).toMatchObject({ position: [0, 0, 0], rotation: [0, 0, 0], offset: 1 })
  // Absence a migration reads: a legacy opening, a legacy slab solid to its level.
  expect(view.door).not.toHaveProperty('floorThresholdVersion')
  expect(view.slab).not.toHaveProperty('thickness')
  expect(view.slab).toMatchObject({ holes: [], metadata: { keep: true } })
  expect(source).toEqual(raw())
  const complete = view as Record<string, unknown>
  expect(loadNodeView(complete).view).toBe(complete)
})

test('a migration that changes nothing returns the stored nodes themselves', () => {
  const source = raw()
  const migrate = loadMigration(
    'noop',
    (nodes) => ({ nodes, changed: false }),
    (nodes) => ({ nodes, changed: false }),
  )
  expect(migrate(source).nodes).toBe(source)
})

test('fills a migration carried through are not written; values it wrote are', () => {
  const source = raw()
  const migrate = loadMigration(
    'rewrite',
    (nodes) => ({
      nodes: {
        ...nodes,
        wall: { ...(nodes.wall as object), height: 3 },
        door: { ...(nodes.door as object), rotation: [0, 0, 0] },
        slab: nodes.slab,
      },
    }),
    (nodes) => ({ nodes }),
  )
  const { nodes } = migrate(source)
  expect(nodes.wall).toEqual({ ...source.wall, height: 3 })
  expect(nodes.door).toEqual({ ...source.door, rotation: [0, 0, 0] })
  expect(nodes.slab).toBe(source.slab)
})

test('a fill a migration grew in place is its output and stays', () => {
  const source = raw()
  const migrate = loadMigration(
    'grow',
    (nodes) => {
      ;(nodes.wall as { children: string[] }).children.push('door')
      return { nodes }
    },
    (nodes) => ({ nodes }),
  )
  const { nodes } = migrate(source)
  expect(nodes.wall).toEqual({ ...source.wall, children: ['door'] })
  expect(source.wall).not.toHaveProperty('children')
})

test('a migration that throws is reported and the scene loads without it', () => {
  const error = spyOn(console, 'error').mockImplementation(() => {})
  try {
    const source = raw()
    const migrate = loadMigration(
      'broken',
      () => {
        throw new Error('boom')
      },
      (nodes) => ({ nodes, changed: false }),
    )
    expect(migrate(source)).toEqual({ nodes: source, changed: false })
    expect(migrate(source).nodes).toBe(source)
    expect(String(error.mock.calls[0]?.[0])).toStartWith('[scene load] broken failed')
  } finally {
    error.mockRestore()
  }
})
