import { describe, expect, test } from 'bun:test'
import { parseDeviceTrajectoryPackets } from './trajectory'

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

describe('parseDeviceTrajectoryPackets', () => {
  test('applies individual samples after the latest full trajectory snapshot', () => {
    const trajectory = parseDeviceTrajectoryPackets([
      {
        coordinateSystem: 'arkit-world',
        samples: [
          { segment: 0, timestamp: 0, transform: identity },
          { segment: 0, timestamp: 1, transform: identity },
        ],
      },
      { segment: 0, timestamp: 2, transform: identity },
    ])

    expect(trajectory?.poses.map((pose) => pose.timestamp)).toEqual([0, 1, 2])
  })
})
