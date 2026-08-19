import { describe, expect, test } from 'bun:test'
import type { CaptureStreamPacket } from '@pascal-app/capture-protocol'
import {
  appendCapturePacket,
  nextCaptureStreamEpoch,
  retainLiveCapturePackets,
} from './source-state'

function packet(generation: number, sequence: number): CaptureStreamPacket {
  return {
    protocolVersion: 1,
    sessionId: 'capture_123',
    streamId: 'points',
    generation,
    sequence,
    timestamp: sequence,
    payload: {},
  }
}

describe('appendCapturePacket', () => {
  test('deduplicates, orders, bounds, and resets on a new generation', () => {
    let state: Readonly<Record<string, readonly CaptureStreamPacket[]>> = {}
    state = appendCapturePacket(state, packet(0, 2), 2)
    state = appendCapturePacket(state, packet(0, 1), 2)
    state = appendCapturePacket(state, packet(0, 2), 2)
    expect(state.points?.map((value) => value.sequence)).toEqual([1, 2])

    state = appendCapturePacket(state, packet(1, 0), 2)
    expect(state.points).toEqual([packet(1, 0)])
    expect(appendCapturePacket(state, packet(0, 3), 2)).toBe(state)
  })

  test('resets a stream on keyframes and coordinate-frame changes', () => {
    let state: Readonly<Record<string, readonly CaptureStreamPacket[]>> = {}
    state = appendCapturePacket(state, { ...packet(0, 0), frameId: 'world' }, 4)
    state = appendCapturePacket(state, { ...packet(0, 1), frameId: 'world' }, 4)
    state = appendCapturePacket(state, { ...packet(0, 2), frameId: 'world', keyframe: true }, 4)
    expect(state.points?.map((value) => value.sequence)).toEqual([2])

    state = appendCapturePacket(state, { ...packet(0, 3), frameId: 'sensor' }, 4)
    expect(state.points?.map((value) => value.sequence)).toEqual([3])
  })

  test('does not let a stale keyframe replace newer live packets', () => {
    let state: Readonly<Record<string, readonly CaptureStreamPacket[]>> = {}
    state = appendCapturePacket(state, { ...packet(0, 5), frameId: 'world' }, 4)
    const unchanged = appendCapturePacket(
      state,
      { ...packet(0, 2), frameId: 'world', keyframe: true },
      4,
    )

    expect(unchanged).toBe(state)
    expect(unchanged.points?.map((value) => value.sequence)).toEqual([5])
  })

  test('does not reinsert ordinary packets older than an accepted keyframe', () => {
    let state: Readonly<Record<string, readonly CaptureStreamPacket[]>> = {}
    state = appendCapturePacket(state, { ...packet(0, 5), frameId: 'world', keyframe: true }, 4)
    const unchanged = appendCapturePacket(state, { ...packet(0, 4), frameId: 'world' }, 4)

    expect(unchanged).toBe(state)
    expect(unchanged.points?.map((value) => value.sequence)).toEqual([5])
  })

  test('keeps a stable playback epoch when a bounded live window advances', () => {
    let state: Readonly<Record<string, readonly CaptureStreamPacket[]>> = {}
    let epoch: string | undefined
    const append = (nextPacket: CaptureStreamPacket) => {
      const previous = state.points ?? []
      const next = appendCapturePacket(state, nextPacket, 2)
      if (next !== state) epoch = nextCaptureStreamEpoch(epoch, previous, nextPacket)
      state = next
    }
    append({ ...packet(0, 0), frameId: 'world' })
    append({ ...packet(0, 1), frameId: 'world' })
    const initialEpoch = epoch

    append({ ...packet(0, 2), frameId: 'world' })
    expect(state.points?.map((value) => value.sequence)).toEqual([1, 2])
    expect(epoch).toBe(initialEpoch)

    append({ ...packet(0, 3), frameId: 'world', keyframe: true })
    expect(epoch).not.toBe(initialEpoch)
    const keyframeEpoch = epoch

    append({ ...packet(0, 4), frameId: 'world' })
    expect(epoch).toBe(keyframeEpoch)

    append({ ...packet(1, 0), frameId: 'world' })
    expect(epoch).not.toBe(keyframeEpoch)
  })
})

describe('retainLiveCapturePackets', () => {
  test('drops preview packets when a stream finalizes', () => {
    const packets = { points: [packet(0, 1)] }
    expect(
      retainLiveCapturePackets(packets, {
        schemaVersion: 2,
        sessionId: 'capture_123',
        state: 'ready',
        clocks: [],
        coordinateFrames: [],
        streams: [{ id: 'points', kind: 'point-cloud', availability: 'ready' }],
      }),
    ).toEqual({})
  })
})
