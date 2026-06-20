import { describe, expect, test } from 'bun:test'
import { fallbackFactoryPlan } from './factory-planner'
import { composeProcessLine } from './process-line-composer'
import { buildStationPlacement, validateProcessLineLayout } from './process-line-layout'
import type { ProcessLinePlan } from './process-line-types'

function waterElectrolysisPlan() {
  const plan = fallbackFactoryPlan('create a hydrogen electrolysis workshop')
  if (plan.kind !== 'process_line') throw new Error('expected process line plan')
  return plan.process
}

describe('process line layout diagnostics', () => {
  test('validates the default water electrolysis station layout', () => {
    const result = composeProcessLine({
      prompt: 'create a hydrogen electrolysis workshop',
      plan: waterElectrolysisPlan(),
      placement: { parentId: 'level_factory', generatedBy: 'factory-agent' },
    })

    expect(result.layoutDiagnostics).toEqual({
      fits: true,
      boundary: { length: 24, width: 9 },
      diagnostics: [],
    })
    expect(
      result.stationPlacements.every((placement) => {
        const box = placement.clearanceBox
        return box.minX >= -12 && box.maxX <= 12 && box.minZ >= -4.5 && box.maxZ <= 4.5
      }),
    ).toBe(true)
  })

  test('reports overlap and boundary diagnostics when a process line is too compressed', () => {
    const result = composeProcessLine({
      prompt: 'create a hydrogen electrolysis workshop',
      plan: {
        ...waterElectrolysisPlan(),
        dimensions: { length: 6, width: 2 },
      },
      placement: { parentId: 'level_factory', generatedBy: 'factory-agent' },
    })

    expect(result.layoutDiagnostics.fits).toBe(false)
    expect(result.layoutDiagnostics.diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining(['station_clearance_overlap', 'station_outside_boundary']),
    )
  })

  test('repairs a compressed linear layout by switching to parallel bays', () => {
    const result = composeProcessLine({
      prompt: 'create a hydrogen electrolysis workshop',
      plan: {
        ...waterElectrolysisPlan(),
        dimensions: { length: 18, width: 9 },
      },
      placement: { parentId: 'level_factory', generatedBy: 'factory-agent' },
    })

    expect(result.layoutDiagnostics).toEqual({
      fits: true,
      boundary: { length: 18, width: 9 },
      diagnostics: [],
    })
    expect(result.layoutStrategy).toMatchObject({
      style: 'parallel_bays',
      repaired: true,
    })
    expect(new Set(result.stationPlacements.map((placement) => placement.position[2])).size).toBe(2)
  })

  test('spreads large parallel-bay industry templates across their factory boundary', () => {
    const plan = fallbackFactoryPlan('生成一个电解铝厂')
    if (plan.kind !== 'process_line') throw new Error('expected process line plan')

    const result = composeProcessLine({
      prompt: '生成一个电解铝厂',
      plan: plan.process,
      placement: { parentId: 'level_factory', generatedBy: 'factory-agent' },
    })

    const xs = result.stationPlacements.map((placement) => placement.position[0])
    const zs = result.stationPlacements.map((placement) => placement.position[2])
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(40)
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(10)
    expect(result.layoutDiagnostics).toMatchObject({
      fits: true,
      boundary: { length: 72, width: 32 },
    })
  })

  test('reports invalid connection endpoints', () => {
    const plan: ProcessLinePlan = {
      processId: 'test_line',
      processLabel: 'Test process line',
      domain: 'generic',
      layoutStyle: 'linear',
      stations: [
        {
          id: 'feed',
          label: 'Feed tank',
          role: 'feed',
          equipmentHint: 'feed tank',
          footprintHint: 'medium',
        },
      ],
      connections: [
        {
          fromStationId: 'feed',
          toStationId: 'missing_station',
          visualKind: 'pipe',
          medium: 'water',
        },
      ],
    }
    const diagnostics = validateProcessLineLayout({
      plan,
      stationPlacements: [
        buildStationPlacement({
          station: plan.stations[0]!,
          position: [0, 0, 0],
        }),
      ],
      boundary: { length: 8, width: 4 },
    })

    expect(diagnostics.fits).toBe(false)
    expect(diagnostics.diagnostics).toEqual([
      expect.objectContaining({
        code: 'connection_missing_to_station',
        stationId: 'missing_station',
        connectionIndex: 0,
      }),
    ])
  })
})
