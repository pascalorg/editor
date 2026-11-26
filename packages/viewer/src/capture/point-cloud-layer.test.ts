import { describe, expect, test } from 'bun:test'
import type { CaptureStreamPacket } from '@pascal-app/core/capture'
import { buildPointCloudData, buildPointCloudPayloadData } from './layers/point-cloud-layer'
import { firstPoints, parsePointCloudPly } from './layers/point-cloud-ply'

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

/** The phone's layout: float x y z, uchar red green blue, little-endian. */
function binaryPly(points: Array<[number, number, number, number, number, number]>): ArrayBuffer {
  const header = new TextEncoder().encode(
    [
      'ply',
      'format binary_little_endian 1.0',
      `element vertex ${points.length}`,
      'property float x',
      'property float y',
      'property float z',
      'property uchar red',
      'property uchar green',
      'property uchar blue',
      'end_header',
      '',
    ].join('\n'),
  )
  const buffer = new ArrayBuffer(header.byteLength + points.length * 15)
  new Uint8Array(buffer).set(header)
  const view = new DataView(buffer, header.byteLength)
  points.forEach(([x, y, z, r, g, b], index) => {
    const at = index * 15
    view.setFloat32(at, x, true)
    view.setFloat32(at + 4, y, true)
    view.setFloat32(at + 8, z, true)
    view.setUint8(at + 12, r)
    view.setUint8(at + 13, g)
    view.setUint8(at + 14, b)
  })
  return buffer
}

describe('parsePointCloudPly', () => {
  test('reads a binary cloud with its colours as bytes over 255, like the live stream', () => {
    const data = parsePointCloudPly(
      binaryPly([
        [0.5, 1, -2, 255, 0, 0],
        [3, 4, 5, 0, 255, 0],
      ]),
    )

    expect([...data.positions]).toEqual([0.5, 1, -2, 3, 4, 5])
    expect(data.colors ? [...data.colors] : null).toEqual([1, 0, 0, 0, 1, 0])
  })

  test('reads an ascii cloud without colours', () => {
    const text =
      'ply\nformat ascii 1.0\nelement vertex 2\nproperty float x\nproperty float y\nproperty float z\nend_header\n0 1 2\n3 4 5\n'
    const data = parsePointCloudPly(new TextEncoder().encode(text).buffer as ArrayBuffer)

    expect([...data.positions]).toEqual([0, 1, 2, 3, 4, 5])
    expect(data.colors).toBeNull()
  })

  test('refuses a file that ends before its last point', () => {
    const whole = binaryPly([
      [0, 0, 0, 0, 0, 0],
      [1, 1, 1, 0, 0, 0],
    ])
    expect(() => parsePointCloudPly(whole.slice(0, whole.byteLength - 1))).toThrow()
  })
})

describe('firstPoints', () => {
  test('keeps the first points of a shuffled cloud, and all of a small one', () => {
    const data = parsePointCloudPly(
      binaryPly([
        [0, 0, 0, 255, 0, 0],
        [1, 0, 0, 0, 255, 0],
        [2, 0, 0, 0, 0, 255],
      ]),
    )

    const kept = firstPoints(data, 2)
    expect([...kept.positions]).toEqual([0, 0, 0, 1, 0, 0])
    expect(kept.colors ? [...kept.colors] : null).toEqual([1, 0, 0, 0, 1, 0])
    expect(firstPoints(data, 10)).toBe(data)
  })
})
