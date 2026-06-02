import { describe, expect, test } from 'bun:test'
import { planGeometryCapabilities } from './capability-planner'

describe('geometry capability planner', () => {
  test('routes spur gears to the parametric gear recipe', () => {
    const plan = planGeometryCapabilities('spur gear, 20 teeth, module 4.5')
    expect(plan.route).toBe('parametric_gear')
    expect(plan.availableCapabilities).toContain('compose_recipe:gear.spur')
    expect(plan.missingCapabilities).toEqual([])
  })

  test('routes cars to vehicle recipe v2', () => {
    const plan = planGeometryCapabilities('generate a car')
    expect(plan.route).toBe('vehicle_recipe_v2')
    expect(plan.availableCapabilities).toContain('compose_recipe:vehicle.*')
  })
})
