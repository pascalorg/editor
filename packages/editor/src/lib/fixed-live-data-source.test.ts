import { describe, expect, test } from 'bun:test'
import {
  buildFixedFactoryLiveDataSnapshot,
  flattenLiveDataMessage,
  inferFixedLiveDataPaths,
} from './fixed-live-data-source'

describe('fixed live data source', () => {
  test('flattens nested telemetry messages into bindable paths', () => {
    expect(
      flattenLiveDataMessage({
        machine: { temperature: 28 },
        refinery: { tank: { level: 62 } },
        ignored: [1, 2],
      }),
    ).toEqual({
      'machine.temperature': 28,
      'refinery.tank.level': 62,
    })
  })

  test('infers field metadata for inspector and data lens consumers', () => {
    const paths = inferFixedLiveDataPaths({
      'machine.temperature': 28,
      'refinery.tank.level': 62,
      'custom.flag': true,
    })

    expect(paths.find((path) => path.path === 'machine.temperature')).toMatchObject({
      label: 'Machine temperature',
      unit: '°C',
      valueType: 'number',
    })
    expect(paths.find((path) => path.path === 'refinery.tank.level')).toMatchObject({
      label: 'Tank level',
      unit: '%',
      category: 'refinery',
    })
    expect(paths.find((path) => path.path === 'custom.flag')).toMatchObject({
      label: 'Custom / Flag',
      valueType: 'boolean',
    })
  })

  test('builds a stable snapshot from the fixed factory message', () => {
    const snapshot = buildFixedFactoryLiveDataSnapshot(123)

    expect(snapshot.timestamp).toBe(123)
    expect(snapshot.values['machine.temperature']).toBe(28)
    expect(snapshot.values['refinery.crude.flowRate']).toBe(1280)
    expect(snapshot.values['refinery.tank.level']).toBe(62)
  })
})
