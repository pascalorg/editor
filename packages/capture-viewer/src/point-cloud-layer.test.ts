import { describe, expect, test } from 'bun:test'
import type { CaptureStreamPacket } from '@pascal-app/capture-protocol'
import { buildPointCloudData, buildPointCloudPayloadData } from './layers/point-cloud-layer'

function packet(sequence: number, positions: number[], colors?: number[]): CaptureStreamPacket {
  return {
    protocolVersion: 1,
    sessionId: 'capture_123',
    streamId: 'points',
    generation: 0,
    sequence,
    timestamp: sequence,
    payload: { colors, positions },
  }
}

describe('buildPointCloudData', () => {
  test('keeps the newest bounded points and normalizes byte colors', () => {
    const data = buildPointCloudData(
      [packet(0, [0, 0, 0], [255, 0, 0]), packet(1, [1, 0, 0, 2, 0, 0], [0, 255, 0, 0, 0, 255])],
      2,
    )

    expect([...data.positions]).toEqual([1, 0, 0, 2, 0, 0])
    expect(data.colors ? [...data.colors] : null).toEqual([0, 1, 0, 0, 0, 1])
  })

  test('renders bounded inline capture points', () => {
    const data = buildPointCloudPayloadData(
      {
        coordinateSystem: 'arkit-world',
        positions: [0, 0, 0, 1, 0, 0, 2, 0, 0],
      },
      2,
    )

    expect([...data.positions]).toEqual([1, 0, 0, 2, 0, 0])
    expect(data.colors).toBeNull()
  })

  test('drops non-finite live packet geometry', () => {
    expect(buildPointCloudData([packet(2, [0, 0, Number.NaN])], 100).positions).toHaveLength(0)
  })
})
