import type {
  CaptureSessionDescriptor,
  CaptureSessionLocator,
  CaptureSource,
  CaptureSourceResolver,
  CaptureStreamPacket,
} from '@pascal-app/capture-protocol'
import { useCallback, useEffect, useState } from 'react'

export type CaptureSourceState = {
  descriptor: CaptureSessionDescriptor | null
  descriptorVersion: number
  error: Error | null
  loading: boolean
  packets: Readonly<Record<string, readonly CaptureStreamPacket[]>>
  retry: () => void
  source: CaptureSource | null
  streamEpochs: Readonly<Record<string, string>>
}

type CaptureSourceSnapshot = Omit<CaptureSourceState, 'retry'>

export type UseCaptureSourceOptions = {
  maxPacketsPerStream?: number
  subscribe?: boolean
}

const EMPTY_PACKETS: Readonly<Record<string, readonly CaptureStreamPacket[]>> = {}
const EMPTY_STREAM_EPOCHS: Readonly<Record<string, string>> = {}

export function useCaptureSource(
  locator: CaptureSessionLocator | null,
  resolveSource: CaptureSourceResolver,
  options: UseCaptureSourceOptions = {},
): CaptureSourceState {
  const { maxPacketsPerStream = 32, subscribe = true } = options
  const [retryVersion, setRetryVersion] = useState(0)
  const [state, setState] = useState<CaptureSourceSnapshot>({
    descriptor: null,
    descriptorVersion: 0,
    error: null,
    loading: Boolean(locator),
    packets: EMPTY_PACKETS,
    source: null,
    streamEpochs: EMPTY_STREAM_EPOCHS,
  })

  useEffect(() => {
    const abort = new AbortController()
    if (!locator) {
      setState({
        descriptor: null,
        descriptorVersion: 0,
        error: null,
        loading: false,
        packets: EMPTY_PACKETS,
        source: null,
        streamEpochs: EMPTY_STREAM_EPOCHS,
      })
      return () => abort.abort()
    }

    setState({
      descriptor: null,
      descriptorVersion: retryVersion,
      error: null,
      loading: true,
      packets: EMPTY_PACKETS,
      source: null,
      streamEpochs: EMPTY_STREAM_EPOCHS,
    })
    void consumeCaptureSource(
      locator,
      resolveSource,
      abort.signal,
      retryVersion,
      maxPacketsPerStream,
      subscribe,
      setState,
    )
    return () => abort.abort()
  }, [locator, maxPacketsPerStream, resolveSource, retryVersion, subscribe])

  const retry = useCallback(() => setRetryVersion((current) => current + 1), [])
  return { ...state, retry }
}

async function consumeCaptureSource(
  locator: CaptureSessionLocator,
  resolveSource: CaptureSourceResolver,
  signal: AbortSignal,
  descriptorVersion: number,
  maxPacketsPerStream: number,
  subscribe: boolean,
  setState: (
    update: CaptureSourceSnapshot | ((current: CaptureSourceSnapshot) => CaptureSourceSnapshot),
  ) => void,
): Promise<void> {
  try {
    const source = await resolveSource(locator)
    const descriptor = await source.describe(signal)
    if (signal.aborted) return
    setState({
      descriptor,
      descriptorVersion,
      error: null,
      loading: false,
      packets: EMPTY_PACKETS,
      source,
      streamEpochs: EMPTY_STREAM_EPOCHS,
    })

    if (!(subscribe && source.subscribe)) return
    const iterator = source.subscribe({ signal })[Symbol.asyncIterator]()
    const closeIterator = () => void iterator.return?.()
    signal.addEventListener('abort', closeIterator, { once: true })
    try {
      for (;;) {
        const next = await iterator.next()
        if (next.done || signal.aborted || next.value.type === 'closed') return
        const event = next.value
        if (event.type === 'descriptor') {
          setState((current) => {
            const revisionChanged =
              current.descriptor?.revisionId !== event.descriptor.revisionId &&
              (current.descriptor?.revisionId !== undefined ||
                event.descriptor.revisionId !== undefined)
            return {
              ...current,
              descriptor: event.descriptor,
              descriptorVersion: current.descriptorVersion + 1,
              packets: revisionChanged
                ? EMPTY_PACKETS
                : retainLiveCapturePackets(current.packets, event.descriptor),
              streamEpochs: revisionChanged
                ? EMPTY_STREAM_EPOCHS
                : retainLiveCaptureStreamValues(current.streamEpochs, event.descriptor),
            }
          })
        } else {
          setState((current) => {
            const previousPackets = current.packets[event.packet.streamId] ?? []
            const packets = appendCapturePacket(current.packets, event.packet, maxPacketsPerStream)
            if (packets === current.packets) return current
            return {
              ...current,
              packets,
              streamEpochs: {
                ...current.streamEpochs,
                [event.packet.streamId]: nextCaptureStreamEpoch(
                  current.streamEpochs[event.packet.streamId],
                  previousPackets,
                  event.packet,
                ),
              },
            }
          })
        }
      }
    } finally {
      signal.removeEventListener('abort', closeIterator)
      await iterator.return?.()
    }
  } catch (cause) {
    if (signal.aborted) return
    setState({
      descriptor: null,
      descriptorVersion,
      error: cause instanceof Error ? cause : new Error('Could not load capture session.'),
      loading: false,
      packets: EMPTY_PACKETS,
      source: null,
      streamEpochs: EMPTY_STREAM_EPOCHS,
    })
  }
}

export function retainLiveCapturePackets(
  packetsByStream: Readonly<Record<string, readonly CaptureStreamPacket[]>>,
  descriptor: CaptureSessionDescriptor,
): Readonly<Record<string, readonly CaptureStreamPacket[]>> {
  const liveStreamIds = new Set(
    descriptor.streams
      .filter((stream) => stream.availability === 'live')
      .map((stream) => stream.id),
  )
  return Object.fromEntries(
    Object.entries(packetsByStream).filter(([streamId]) => liveStreamIds.has(streamId)),
  )
}

function retainLiveCaptureStreamValues<T>(
  valuesByStream: Readonly<Record<string, T>>,
  descriptor: CaptureSessionDescriptor,
): Readonly<Record<string, T>> {
  const liveStreamIds = new Set(
    descriptor.streams
      .filter((stream) => stream.availability === 'live')
      .map((stream) => stream.id),
  )
  return Object.fromEntries(
    Object.entries(valuesByStream).filter(([streamId]) => liveStreamIds.has(streamId)),
  )
}

export function appendCapturePacket(
  packetsByStream: Readonly<Record<string, readonly CaptureStreamPacket[]>>,
  packet: CaptureStreamPacket,
  maxPacketsPerStream: number,
): Readonly<Record<string, readonly CaptureStreamPacket[]>> {
  const previous = packetsByStream[packet.streamId] ?? []
  const latest = previous.at(-1)
  const currentGeneration = latest?.generation
  if (currentGeneration !== undefined && packet.generation < currentGeneration)
    return packetsByStream
  const resetSequence = previous[0]?.keyframe ? previous[0].sequence : null
  if (
    currentGeneration === packet.generation &&
    resetSequence !== null &&
    packet.sequence <= resetSequence
  ) {
    return packetsByStream
  }
  const resetsStream = Boolean(packet.keyframe) || latest?.frameId !== packet.frameId
  if (
    latest &&
    currentGeneration === packet.generation &&
    resetsStream &&
    packet.sequence <= latest.sequence
  ) {
    return packetsByStream
  }
  const sameGeneration = currentGeneration === packet.generation && !resetsStream ? previous : []
  if (sameGeneration.some((candidate) => candidate.sequence === packet.sequence))
    return packetsByStream
  const limit = Math.max(1, maxPacketsPerStream)
  const next = [...sameGeneration, packet]
    .sort((left, right) => left.sequence - right.sequence)
    .slice(-limit)
  return { ...packetsByStream, [packet.streamId]: next }
}

export function nextCaptureStreamEpoch(
  currentEpoch: string | undefined,
  previousPackets: readonly CaptureStreamPacket[],
  packet: CaptureStreamPacket,
): string {
  const latest = previousPackets.at(-1)
  const resetsStream =
    previousPackets.length === 0 ||
    latest?.generation !== packet.generation ||
    latest.frameId !== packet.frameId ||
    Boolean(packet.keyframe)
  if (resetsStream) return `${packet.generation}:${packet.frameId ?? ''}:${packet.sequence}`
  return (
    currentEpoch ??
    `${latest.generation}:${latest.frameId ?? ''}:${previousPackets[0]?.sequence ?? latest.sequence}`
  )
}
