import { afterEach, describe, expect, test } from 'bun:test'
import useFloorplanPreflight, { type FloorplanPreflightIssue } from './use-floorplan-preflight'

const COLLISION_ISSUE: FloorplanPreflightIssue = {
  id: 'dimension-1',
  kind: 'unresolved-collision',
  severity: 'warning',
  message: 'The same collision remains unresolved.',
}

afterEach(() => {
  useFloorplanPreflight.getState().setIssues([])
  useFloorplanPreflight.getState().setAuditIssues([])
})

describe('useFloorplanPreflight', () => {
  test('does not notify subscribers when layout issues are unchanged', () => {
    const state = useFloorplanPreflight.getState()
    state.setIssues([COLLISION_ISSUE])
    let notifications = 0
    const unsubscribe = useFloorplanPreflight.subscribe(() => {
      notifications += 1
    })

    useFloorplanPreflight.getState().setIssues([{ ...COLLISION_ISSUE }])

    unsubscribe()
    expect(notifications).toBe(0)
  })

  test('still publishes changed layout issues alongside audit issues', () => {
    const state = useFloorplanPreflight.getState()
    state.setAuditIssues([
      {
        id: 'audit-1',
        kind: 'dimension-completeness',
        severity: 'info',
        message: 'Audit issue',
      },
    ])

    useFloorplanPreflight.getState().setIssues([COLLISION_ISSUE])

    expect(useFloorplanPreflight.getState().issues).toEqual([
      COLLISION_ISSUE,
      expect.objectContaining({ id: 'audit-1' }),
    ])
  })
})
