import { z } from 'zod'
import {
  type CaptureArtifactReference,
  type CaptureSessionDescriptor,
  CaptureSessionDescriptorSchema,
  type CaptureSessionLocator,
  CaptureSessionLocatorSchema,
  normalizeCaptureSessionManifest,
} from './schema'

export const CaptureStreamPacketSchema = z.object({
  protocolVersion: z.literal(1),
  sessionId: z.string().min(1),
  streamId: z.string().min(1),
  generation: z.number().int().nonnegative(),
  sequence: z.number().int().nonnegative(),
  timestamp: z.number().nonnegative(),
  frameId: z.string().min(1).optional(),
  keyframe: z.boolean().optional(),
  bounds: z
    .tuple([z.number(), z.number(), z.number(), z.number(), z.number(), z.number()])
    .optional(),
  payload: z.unknown(),
})

export type CaptureStreamPacket = z.infer<typeof CaptureStreamPacketSchema>

export type CaptureSourceEvent =
  | { type: 'descriptor'; descriptor: CaptureSessionDescriptor }
  | { type: 'packet'; packet: CaptureStreamPacket }
  | { type: 'closed' }

export type CaptureArtifactResolution = {
  url: string
  dispose?: () => void
}

export type CaptureSubscriptionOptions = {
  signal?: AbortSignal
  streamIds?: readonly string[]
}

export interface CaptureSource {
  describe(signal?: AbortSignal): Promise<CaptureSessionDescriptor>
  resolveArtifact?(
    artifact: CaptureArtifactReference,
    signal?: AbortSignal,
  ): Promise<CaptureArtifactResolution>
  subscribe?(options?: CaptureSubscriptionOptions): AsyncIterable<CaptureSourceEvent>
}

export type CaptureSourceResolver = (
  locator: CaptureSessionLocator,
) => CaptureSource | Promise<CaptureSource>

export type HttpCaptureSourceOptions = {
  credentials?: RequestCredentials
  fetch?: typeof globalThis.fetch
  headers?: HeadersInit
  manifestUrl?: (locator: CaptureSessionLocator) => string
  resolveArtifact?: (
    artifact: CaptureArtifactReference,
    signal?: AbortSignal,
  ) => Promise<CaptureArtifactResolution>
}

export type PushCaptureSourceOptions = {
  maxQueuedEventsPerSubscriber?: number
}

export function createHttpCaptureSource(
  locatorInput: CaptureSessionLocator,
  options: HttpCaptureSourceOptions = {},
): CaptureSource {
  const locator = CaptureSessionLocatorSchema.parse(locatorInput)
  const manifestUrl = locator.manifestUrl ?? options.manifestUrl?.(locator)
  if (!manifestUrl) throw new Error(`Capture session ${locator.sessionId} has no manifest URL.`)
  let descriptorPromise: Promise<CaptureSessionDescriptor> | null = null

  const loadDescriptor = async (): Promise<CaptureSessionDescriptor> => {
    const fetcher = options.fetch ?? globalThis.fetch
    const response = await fetcher(manifestUrl, {
      credentials: options.credentials,
      headers: options.headers,
    })
    if (!response.ok) throw new Error(`Capture session ${locator.sessionId} is unavailable.`)
    const descriptor = normalizeCaptureSessionManifest(await response.json())
    if (descriptor.sessionId !== locator.sessionId) {
      throw new Error(`Capture manifest session does not match ${locator.sessionId}.`)
    }
    if (locator.schemaVersion && descriptor.schemaVersion !== locator.schemaVersion) {
      throw new Error(`Capture manifest schema does not match version ${locator.schemaVersion}.`)
    }
    if (locator.revisionId && descriptor.revisionId !== locator.revisionId) {
      throw new Error(`Capture manifest revision does not match ${locator.revisionId}.`)
    }
    return descriptor
  }

  return {
    describe(signal) {
      descriptorPromise ??= loadDescriptor().catch((cause: unknown) => {
        descriptorPromise = null
        throw cause
      })
      return waitForPromise(descriptorPromise, signal).then(cloneCaptureDescriptor)
    },
    async resolveArtifact(artifact, signal) {
      if (options.resolveArtifact) return options.resolveArtifact(artifact, signal)
      if (!artifact.uri) throw new Error(`Capture artifact ${artifact.id} has no URI.`)
      return { url: resolveArtifactUri(artifact.uri, manifestUrl) }
    },
  }
}

function waitForPromise<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    void promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

function abortError(): Error {
  const error = new Error('The capture request was aborted.')
  error.name = 'AbortError'
  return error
}

function resolveArtifactUri(uri: string, manifestUrl: string): string {
  try {
    const base =
      typeof globalThis.location === 'undefined'
        ? new URL(manifestUrl)
        : new URL(manifestUrl, globalThis.location.href)
    return new URL(uri, base).toString()
  } catch {
    return uri
  }
}

type Subscriber = {
  iterator: EventIterator
  streamIds: Set<string> | null
}

export class PushCaptureSource implements CaptureSource {
  #closed = false
  #descriptor: CaptureSessionDescriptor
  #maxQueuedEventsPerSubscriber: number
  #subscribers = new Set<Subscriber>()

  constructor(descriptor: CaptureSessionDescriptor, options: PushCaptureSourceOptions = {}) {
    this.#descriptor = cloneCaptureDescriptor(descriptor)
    this.#maxQueuedEventsPerSubscriber = Math.max(1, options.maxQueuedEventsPerSubscriber ?? 32)
  }

  async describe(): Promise<CaptureSessionDescriptor> {
    return cloneCaptureDescriptor(this.#descriptor)
  }

  async resolveArtifact(artifact: CaptureArtifactReference): Promise<CaptureArtifactResolution> {
    if (!artifact.uri) throw new Error(`Capture artifact ${artifact.id} has no URI.`)
    return { url: artifact.uri }
  }

  subscribe(options: CaptureSubscriptionOptions = {}): AsyncIterable<CaptureSourceEvent> {
    let cleanupAbort = () => {}
    let subscriber: Subscriber
    const iterator = new EventIterator(() => {
      cleanupAbort()
      this.#subscribers.delete(subscriber)
    }, this.#maxQueuedEventsPerSubscriber)
    subscriber = {
      iterator,
      streamIds: options.streamIds ? new Set(options.streamIds) : null,
    }
    this.#subscribers.add(subscriber)
    if (this.#closed) {
      iterator.close({ type: 'closed' })
    } else if (options.signal) {
      if (options.signal.aborted) iterator.finish()
      else {
        const onAbort = () => iterator.finish()
        options.signal.addEventListener('abort', onAbort, { once: true })
        cleanupAbort = () => options.signal?.removeEventListener('abort', onAbort)
      }
    }
    return iterator
  }

  updateDescriptor(descriptor: CaptureSessionDescriptor): void {
    if (this.#closed) return
    const nextDescriptor = cloneCaptureDescriptor(descriptor)
    if (nextDescriptor.sessionId !== this.#descriptor.sessionId) {
      throw new Error('A capture source cannot change session identity.')
    }
    this.#descriptor = nextDescriptor
    this.#publish({ type: 'descriptor', descriptor: cloneCaptureDescriptor(nextDescriptor) })
  }

  publishPacket(packetInput: CaptureStreamPacket): void {
    if (this.#closed) return
    const packet = CaptureStreamPacketSchema.parse(packetInput)
    if (packet.sessionId !== this.#descriptor.sessionId) {
      throw new Error(`Capture packet does not belong to ${this.#descriptor.sessionId}.`)
    }
    if (!this.#descriptor.streams.some((stream) => stream.id === packet.streamId)) {
      throw new Error(`Capture packet references unknown stream ${packet.streamId}.`)
    }
    this.#publish({ type: 'packet', packet })
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    for (const subscriber of this.#subscribers) {
      subscriber.iterator.close({ type: 'closed' })
    }
    this.#subscribers.clear()
  }

  #publish(event: CaptureSourceEvent): void {
    for (const subscriber of this.#subscribers) {
      if (
        event.type === 'packet' &&
        subscriber.streamIds &&
        !subscriber.streamIds.has(event.packet.streamId)
      ) {
        continue
      }
      subscriber.iterator.push(cloneCaptureSourceEvent(event))
    }
  }
}

class EventIterator implements AsyncIterableIterator<CaptureSourceEvent> {
  #done = false
  #maxQueuedEvents: number
  #onFinish: () => void
  #queue: CaptureSourceEvent[] = []
  #waiters: Array<(result: IteratorResult<CaptureSourceEvent>) => void> = []

  constructor(onFinish: () => void, maxQueuedEvents: number) {
    this.#onFinish = onFinish
    this.#maxQueuedEvents = maxQueuedEvents
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<CaptureSourceEvent> {
    return this
  }

  next(): Promise<IteratorResult<CaptureSourceEvent>> {
    const event = this.#queue.shift()
    if (event) return Promise.resolve({ done: false, value: event })
    if (this.#done) return Promise.resolve({ done: true, value: undefined })
    return new Promise((resolve) => this.#waiters.push(resolve))
  }

  return(): Promise<IteratorResult<CaptureSourceEvent>> {
    this.finish()
    return Promise.resolve({ done: true, value: undefined })
  }

  push(event: CaptureSourceEvent): void {
    if (this.#done) return
    const waiter = this.#waiters.shift()
    if (waiter) waiter({ done: false, value: event })
    else {
      this.#queue.push(event)
      this.#trimQueue()
    }
  }

  close(event: CaptureSourceEvent): void {
    if (this.#done) return
    this.#done = true
    this.#queue = []
    const waiter = this.#waiters.shift()
    if (waiter) waiter({ done: false, value: event })
    else this.#queue.push(event)
    for (const pending of this.#waiters.splice(0)) pending({ done: true, value: undefined })
    this.#onFinish()
  }

  finish(): void {
    if (this.#done) {
      this.#queue = []
      return
    }
    this.#done = true
    this.#queue = []
    this.#onFinish()
    for (const waiter of this.#waiters.splice(0)) waiter({ done: true, value: undefined })
  }

  #trimQueue(): void {
    while (this.#queue.length > this.#maxQueuedEvents) {
      const packetIndex = this.#queue.findIndex((event) => event.type === 'packet')
      this.#queue.splice(packetIndex >= 0 ? packetIndex : 0, 1)
    }
  }
}

function cloneCaptureDescriptor(descriptor: CaptureSessionDescriptor): CaptureSessionDescriptor {
  return CaptureSessionDescriptorSchema.parse(structuredClone(descriptor))
}

function cloneCaptureSourceEvent(event: CaptureSourceEvent): CaptureSourceEvent {
  if (event.type === 'descriptor') {
    return { type: 'descriptor', descriptor: cloneCaptureDescriptor(event.descriptor) }
  }
  if (event.type === 'packet') {
    return {
      type: 'packet',
      packet: CaptureStreamPacketSchema.parse(structuredClone(event.packet)),
    }
  }
  return { type: 'closed' }
}
