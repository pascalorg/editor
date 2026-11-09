import { describe, expect, test } from 'bun:test'
import { refreshWallRunAttachment, translateWallRun } from './wall-run-move'

const wall = {
  id: 'wall_1',
  type: 'wall',
  start: [0, 0],
  end: [4, 0],
  height: 2.5,
} as never

const attachment = {
  wallId: 'wall_1',
  side: 'front' as const,
  startUV: [1, 1] as [number, number],
  endUV: [3, 1] as [number, number],
  offset: 0.1,
}

describe('wall-attached run movement', () => {
  test('translates only in wall U/V and updates attachment coordinates', () => {
    const result = translateWallRun(
      [
        [1, 1, 0.1],
        [3, 1, 0.1],
      ],
      attachment,
      wall,
      {
        surfaceHit: { kind: 'wall', hostId: 'wall_1', face: 'side', side: 'front' },
        surfaceLocalPosition: [2, 1.5, 0],
      },
    )
    expect(result?.path).toEqual([
      [1, 1.5, 0.1],
      [3, 1.5, 0.1],
    ])
    expect(result?.attachment.startUV).toEqual([1, 1.5])
    expect(result?.attachment.endUV).toEqual([3, 1.5])
  })

  test('rejects a different wall or a non-side hit', () => {
    expect(
      translateWallRun(
        [
          [1, 1, 0.1],
          [3, 1, 0.1],
        ],
        attachment,
        wall,
        {
          surfaceHit: { kind: 'wall', hostId: 'wall_2', face: 'side' },
          surfaceLocalPosition: [2, 1, 0],
        },
      ),
    ).toBeNull()
  })

  test('refreshes UV coordinates after a point edit', () => {
    const next = refreshWallRunAttachment(
      [
        [0.5, 0.8, 0.1],
        [2.5, 0.8, 0.1],
      ],
      attachment,
      wall,
    )
    expect(next.startUV).toEqual([0.5, 0.8])
    expect(next.endUV).toEqual([2.5, 0.8])
  })
})
