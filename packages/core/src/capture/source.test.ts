import { describe, expect, test } from 'bun:test'
import type { CaptureSessionDescriptor } from './schema'
import { createHttpCaptureSource, PushCaptureSource } from './source'

const descriptor: CaptureSessionDescriptor = {
  schemaVersion: 2,
  sessionId: 'capture_123',
  state: 'live',
  clocks: [],
  coordinateFrames: [],
  streams: [
    { id: 'points', kind: 'point-cloud', role: 'pointCloud', availability: 'live' },
    { id: 'motion', kind: 'device-motion', role: 'deviceMotion', availability: 'live' },
  ],
}

describe('PushCaptureSource', () => {
  test('filters live packets by stream and closes the iterator', async () => {
    const source = new PushCaptureSource(descriptor)
    const iterator = source.subscribe({ streamIds: ['points'] })[Symbol.asyncIterator]()

    source.publishPacket({
      protocolVersion: 1,
      sessionId: descriptor.sessionId,
      streamId: 'motion',
      generation: 0,
      sequence: 0,
      timestamp: 0,
      payload: {},
    })
    source.publishPacket({
      protocolVersion: 1,
      sessionId: descriptor.sessionId,
      streamId: 'points',
      generation: 0,
      sequence: 1,
      timestamp: 0.1,
      payload: { positions: [0, 0, 0] },
    })

    expect((await iterator.next()).value).toMatchObject({
      type: 'packet',
      packet: { streamId: 'points', sequence: 1 },
    })

    source.close()
    expect((await iterator.next()).value).toEqual({ type: 'closed' })
    expect((await iterator.next()).done).toBe(true)
  })

  test('rejects packets from another session', () => {
    const source = new PushCaptureSource(descriptor)
    expect(() =>
      source.publishPacket({
        protocolVersion: 1,
        sessionId: 'capture_other',
        streamId: 'points',
        generation: 0,
        sequence: 0,
        timestamp: 0,
        payload: {},
      }),
    ).toThrow('does not belong')
  })

  test('rejects packets for undeclared streams', () => {
    const source = new PushCaptureSource(descriptor)
    expect(() =>
      source.publishPacket({
        protocolVersion: 1,
        sessionId: descriptor.sessionId,
        streamId: 'typo',
        generation: 0,
        sequence: 0,
        timestamp: 0,
        payload: {},
      }),
    ).toThrow('unknown stream')
  })

  test('bounds slow-subscriber queues and keeps the newest packets', async () => {
    const source = new PushCaptureSource(descriptor, { maxQueuedEventsPerSubscriber: 2 })
    const iterator = source.subscribe({ streamIds: ['points'] })[Symbol.asyncIterator]()
    for (let sequence = 0; sequence < 4; sequence += 1) {
      source.publishPacket({
        protocolVersion: 1,
        sessionId: descriptor.sessionId,
        streamId: 'points',
        generation: 0,
        sequence,
        timestamp: sequence,
        payload: {},
      })
    }

    expect((await iterator.next()).value).toMatchObject({ packet: { sequence: 2 } })
    expect((await iterator.next()).value).toMatchObject({ packet: { sequence: 3 } })
  })

  test('cancellation clears queued packets', async () => {
    const source = new PushCaptureSource(descriptor)
    const iterator = source.subscribe()[Symbol.asyncIterator]()
    source.publishPacket({
      protocolVersion: 1,
      sessionId: descriptor.sessionId,
      streamId: 'points',
      generation: 0,
      sequence: 0,
      timestamp: 0,
      payload: {},
    })

    await iterator.return?.()
    expect((await iterator.next()).done).toBe(true)
  })

  test('does not expose mutable descriptor identity', async () => {
    const source = new PushCaptureSource(descriptor)
    const described = await source.describe()
    described.sessionId = 'mutated'

    expect((await source.describe()).sessionId).toBe(descriptor.sessionId)
  })

  test('isolates live event payloads between subscribers', async () => {
    const source = new PushCaptureSource(descriptor)
    const first = source.subscribe()[Symbol.asyncIterator]()
    const second = source.subscribe()[Symbol.asyncIterator]()
    source.publishPacket({
      protocolVersion: 1,
      sessionId: descriptor.sessionId,
      streamId: 'points',
      generation: 0,
      sequence: 0,
      timestamp: 0,
      payload: { positions: [0, 0, 0] },
    })

    const firstEvent = (await first.next()).value
    if (firstEvent?.type !== 'packet') throw new Error('Expected a packet event.')
    const firstPayload = firstEvent.packet.payload as { positions: number[] }
    firstPayload.positions[0] = 99

    const secondEvent = (await second.next()).value
    expect(secondEvent).toMatchObject({
      type: 'packet',
      packet: { payload: { positions: [0, 0, 0] } },
    })
  })
})

describe('createHttpCaptureSource', () => {
  test('resolves relative artifacts against an absolute manifest URL', async () => {
    const source = createHttpCaptureSource(
      {
        sessionId: 'capture_123',
        manifestUrl: 'https://example.com/captures/capture_123/manifest.json',
      },
      {
        fetch: (async () =>
          new Response(
            JSON.stringify({
              schemaVersion: 1,
              sessionId: 'capture_123',
              projectId: 'project_123',
              streams: {},
            }),
          )) as typeof fetch,
      },
    )

    await source.describe()
    await expect(
      source.resolveArtifact?.({ id: 'model', mediaType: 'model/gltf-binary', uri: 'room.glb' }),
    ).resolves.toEqual({ url: 'https://example.com/captures/capture_123/room.glb' })
  })

  test('enforces locator schema and revision pins', async () => {
    const source = createHttpCaptureSource(
      {
        sessionId: 'capture_123',
        manifestUrl: 'https://example.com/manifest.json',
        revisionId: 'revision_expected',
        schemaVersion: 2,
      },
      {
        fetch: (async () =>
          new Response(
            JSON.stringify({
              schemaVersion: 2,
              sessionId: 'capture_123',
              revisionId: 'revision_other',
              streams: [],
            }),
          )) as typeof fetch,
      },
    )

    await expect(source.describe()).rejects.toThrow('revision does not match')
  })

  test('deduplicates static manifest requests across consumers', async () => {
    let requests = 0
    const source = createHttpCaptureSource(
      { sessionId: 'capture_123', manifestUrl: 'https://example.com/manifest.json' },
      {
        fetch: (async () => {
          requests += 1
          return new Response(
            JSON.stringify({
              schemaVersion: 1,
              sessionId: 'capture_123',
              projectId: 'project_123',
              streams: {},
            }),
          )
        }) as typeof fetch,
      },
    )

    await Promise.all([source.describe(), source.describe()])
    expect(requests).toBe(1)
  })
})
