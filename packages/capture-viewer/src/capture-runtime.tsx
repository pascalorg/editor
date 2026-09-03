'use client'

import {
  type CaptureArtifactReference,
  CaptureArtifactReferenceSchema,
  type CaptureArtifactResolution,
  type CaptureSessionDescriptor,
  type CaptureSessionLocator,
  type CaptureSource,
  type CaptureSourceResolver,
  type CaptureStreamDescriptor,
  type CaptureStreamPacket,
  captureLayerKey,
  DeviceMotionTrajectorySchema,
} from '@pascal-app/capture-protocol'
import { type ScanNode, sceneRegistry, useScene } from '@pascal-app/core'
import { ErrorBoundary, useNodeEvents, useViewer } from '@pascal-app/viewer'
import { createPortal, useFrame } from '@react-three/fiber'
import {
  type ComponentType,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { Object3D } from 'three'
import { rewriteLoopbackAssetUrl } from './asset-url'
import { resolveCaptureFrameMatrix } from './frame'
import { isCaptureSessionVisible, isCaptureStreamVisible } from './layer-visibility'
import { CaptureDeviceMotionLayer } from './layers/device-motion-layer'
import { CapturePointCloudLayer } from './layers/point-cloud-layer'
import { CaptureRoomModel } from './layers/room-model-layer'
import { CaptureSurfaceMeshLayer } from './layers/surface-mesh-layer'
import { useCaptureSource } from './source-state'
import {
  captureModelFormat,
  isCaptureModelArtifact,
  isCapturePointCloudArtifact,
  isCaptureStreamRenderable,
  streamHydratesJsonPayload,
} from './stream-rendering'
import { parseDeviceTrajectoryPackets, parseDeviceTrajectoryPayload } from './trajectory'

export type CaptureStreamRendererProps = {
  artifactUrl: string | null
  descriptor: CaptureSessionDescriptor
  packets: readonly CaptureStreamPacket[]
  scan: ScanNode
  source: CaptureSource
  stream: CaptureStreamDescriptor
  streamEpoch: string
}

export type CaptureStreamRenderer = ComponentType<CaptureStreamRendererProps>

export type CaptureRuntimeErrorContext =
  | {
      phase: 'source'
      scanId: ScanNode['id']
      sessionId: string
    }
  | {
      layerKey: string
      phase: 'stream'
      scanId: ScanNode['id']
      sessionId: string
      streamId: string
      streamKind: string
    }

export type CaptureRuntimeProps = {
  defaultLayerVisibility?: Readonly<Record<string, boolean>>
  maxPacketsPerStream?: number
  onError?: (error: Error, context: CaptureRuntimeErrorContext) => void
  renderers?: Readonly<Record<string, CaptureStreamRenderer>>
  resolveSource: CaptureSourceResolver
  retryKey?: number | string
}

const EMPTY_RENDERERS: Readonly<Record<string, CaptureStreamRenderer>> = {}
const EMPTY_LAYER_VISIBILITY: Readonly<Record<string, boolean>> = {}
type CaptureSessionScan = ScanNode & { captureSession: CaptureSessionLocator }

export function CaptureRuntime({
  defaultLayerVisibility = EMPTY_LAYER_VISIBILITY,
  maxPacketsPerStream = 32,
  onError,
  renderers = EMPTY_RENDERERS,
  resolveSource,
  retryKey = 0,
}: CaptureRuntimeProps) {
  const nodes = useScene((state) => state.nodes)
  const showScans = useViewer((state) => state.showScans)
  const scans = useMemo(
    () =>
      Object.values(nodes).filter(
        (node): node is CaptureSessionScan =>
          node.type === 'scan' &&
          node.captureSession !== null &&
          isCaptureSessionVisible(showScans, node.visible),
      ),
    [nodes, showScans],
  )

  return (
    <>
      {scans.map((scan) => (
        <CaptureSessionPortal
          defaultLayerVisibility={defaultLayerVisibility}
          key={`${scan.id}:${retryKey}`}
          maxPacketsPerStream={maxPacketsPerStream}
          onError={onError}
          renderers={renderers}
          resolveSource={resolveSource}
          scan={scan}
        />
      ))}
    </>
  )
}

function CaptureSessionPortal({
  defaultLayerVisibility,
  maxPacketsPerStream,
  onError,
  renderers,
  resolveSource,
  scan,
}: {
  defaultLayerVisibility: Readonly<Record<string, boolean>>
  maxPacketsPerStream: number
  onError?: (error: Error, context: CaptureRuntimeErrorContext) => void
  renderers: Readonly<Record<string, CaptureStreamRenderer>>
  resolveSource: CaptureSourceResolver
  scan: CaptureSessionScan
}) {
  const [target, setTarget] = useState<Object3D | null>(null)
  const onErrorRef = useRef(onError)
  const handlers = useNodeEvents(scan, 'scan')
  const customRendererKeys = useMemo(() => new Set(Object.keys(renderers)), [renderers])
  const streamFilter = useCallback(
    (stream: CaptureStreamDescriptor) =>
      isCaptureStreamVisible(stream, scan.layers, defaultLayerVisibility) &&
      isCaptureStreamRenderable(stream, customRendererKeys),
    [customRendererKeys, defaultLayerVisibility, scan.layers],
  )
  const sourceState = useCaptureSource(scan.captureSession, resolveSource, {
    maxPacketsPerStream,
    streamFilter,
  })

  useEffect(() => {
    onErrorRef.current = onError
  }, [onError])

  useEffect(() => {
    if (!sourceState.error) return
    onErrorRef.current?.(sourceState.error, {
      phase: 'source',
      scanId: scan.id,
      sessionId: scan.captureSession.sessionId,
    })
  }, [scan.captureSession.sessionId, scan.id, sourceState.error])

  useFrame(() => {
    const nextTarget = sceneRegistry.nodes.get(scan.id) ?? null
    if (nextTarget !== target) setTarget(nextTarget)
  })

  const descriptor = sourceState.descriptor
  const source = sourceState.source
  if (!(target && descriptor && source)) return null

  const visibleStreams = descriptor.streams.filter(streamFilter)

  return createPortal(
    <group {...handlers}>
      {visibleStreams.map((stream) => {
        const layerKey = captureLayerKey(stream)
        const renderKey = captureStreamRenderKey(stream)
        const packets = sourceState.packets[stream.id] ?? []
        const streamEpoch =
          sourceState.streamEpochs[stream.id] ??
          `descriptor:${descriptor.revisionId ?? ''}:${stream.id}:${stream.frameId ?? ''}`
        const latestPacket = packets.at(-1)
        const packetRevision = latestPacket
          ? `${latestPacket.generation}:${latestPacket.sequence}:${latestPacket.frameId ?? ''}`
          : 'static'
        return (
          <ErrorBoundary
            fallback={<group />}
            key={renderKey}
            onError={(error) =>
              onErrorRef.current?.(error, {
                layerKey,
                phase: 'stream',
                scanId: scan.id,
                sessionId: scan.captureSession.sessionId,
                streamId: stream.id,
                streamKind: stream.kind,
              })
            }
            resetKey={`${renderKey}:${sourceState.descriptorVersion}:${streamEpoch}:${packetRevision}`}
            scope={`capture:${layerKey}`}
          >
            <Suspense fallback={null}>
              <CaptureStreamLayer
                descriptor={descriptor}
                packets={packets}
                renderers={renderers}
                scan={scan}
                source={source}
                stream={stream}
                streamEpoch={streamEpoch}
              />
            </Suspense>
          </ErrorBoundary>
        )
      })}
    </group>,
    target,
  )
}

function captureStreamRenderKey(stream: CaptureStreamDescriptor): string {
  const artifact = stream.artifact
  return [
    stream.id,
    stream.availability,
    artifact?.id ?? '',
    artifact?.sha256 ?? '',
    artifact?.uri ?? '',
  ].join(':')
}

export function CaptureStreamLayer({
  descriptor,
  packets,
  renderers,
  scan,
  source,
  stream,
  streamEpoch,
}: Omit<CaptureStreamRendererProps, 'artifactUrl'> & {
  renderers: Readonly<Record<string, CaptureStreamRenderer>>
}) {
  const artifactUrl = useResolvedArtifact(source, stream.artifact)
  const layerKey = captureLayerKey(stream)
  const Renderer = renderers[layerKey] ?? renderers[stream.kind]
  // Extracted previews archive the inline payload shape as a JSON artifact.
  const payloadArtifactUrl = streamHydratesJsonPayload(stream) ? artifactUrl : null
  const fetchedPayload = useJsonArtifactPayload(payloadArtifactUrl)
  const payload = stream.inline ?? fetchedPayload
  const frameId = packets.at(-1)?.frameId ?? stream.frameId ?? stream.artifact?.frameId
  const frameMatrix = useMemo(
    () => resolveCaptureFrameMatrix(descriptor, frameId),
    [descriptor, frameId],
  )
  const trajectory = useMemo(() => {
    if (layerKey !== 'deviceMotion') return null
    const inline = DeviceMotionTrajectorySchema.safeParse(payload)
    return inline.success
      ? parseDeviceTrajectoryPayload(inline.data)
      : parseDeviceTrajectoryPackets(packets.map((packet) => packet.payload))
  }, [layerKey, packets, payload])
  const motionPlaybackKey = useMemo(() => {
    if (layerKey !== 'deviceMotion') return ''
    // Fetched payloads can be megabytes — key them by artifact identity and
    // load state instead of stringifying their content.
    const inlineVersion =
      packets.length === 0
        ? stream.inline != null
          ? JSON.stringify(stream.inline)
          : `${payloadArtifactUrl ?? ''}:${fetchedPayload ? 'loaded' : 'pending'}`
        : ''
    return [descriptor.revisionId ?? '', streamEpoch, inlineVersion].join(':')
  }, [
    descriptor.revisionId,
    fetchedPayload,
    layerKey,
    packets.length,
    payloadArtifactUrl,
    stream.inline,
    streamEpoch,
  ])
  if (frameId && !frameMatrix) {
    throw new Error(`Capture stream ${stream.id} references an invalid frame: ${frameId}.`)
  }
  let content: ReactNode = null
  if (Renderer) {
    content = (
      <Renderer
        artifactUrl={artifactUrl}
        descriptor={descriptor}
        packets={packets}
        scan={scan}
        source={source}
        stream={stream}
        streamEpoch={streamEpoch}
      />
    )
  } else if (
    layerKey === 'model' &&
    isCaptureModelArtifact(stream.artifact) &&
    stream.artifact &&
    artifactUrl
  ) {
    content = (
      <CaptureRoomModel
        format={captureModelFormat(stream.artifact) ?? undefined}
        mediaType={stream.artifact.mediaType}
        opacity={scan.opacity}
        url={artifactUrl}
      />
    )
  } else if (layerKey === 'deviceMotion') {
    content = trajectory ? (
      <CaptureDeviceMotionLayer key={motionPlaybackKey} trajectory={trajectory} />
    ) : null
  } else if (layerKey === 'pointCloud') {
    content = (
      <CapturePointCloudLayer
        artifactUrl={
          isCapturePointCloudArtifact(stream.artifact) ? (artifactUrl ?? undefined) : undefined
        }
        inline={payload}
        packets={stream.availability === 'live' ? packets : []}
      />
    )
  } else if (layerKey === 'surfaceMesh') {
    content = <CaptureSurfaceMeshLayer inline={payload} />
  }
  if (!(content && frameMatrix)) return content
  return (
    <group matrix={frameMatrix} matrixAutoUpdate={false}>
      {content}
    </group>
  )
}

function useJsonArtifactPayload(url: string | null): unknown {
  const [error, setError] = useState<Error | null>(null)
  const [payload, setPayload] = useState<unknown>(null)

  useEffect(() => {
    setError(null)
    setPayload(null)
    if (!url) return
    const abort = new AbortController()
    void fetch(rewriteLoopbackAssetUrl(url), { signal: abort.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Could not load ${url}: ${response.status}`)
        return (await response.json()) as unknown
      })
      .then((data) => {
        if (!abort.signal.aborted) setPayload(data)
      })
      .catch((cause: unknown) => {
        if (abort.signal.aborted) return
        setError(cause instanceof Error ? cause : new Error(`Could not load ${url}.`))
      })
    return () => abort.abort()
  }, [url])

  if (error) throw error
  return payload
}

function useResolvedArtifact(
  source: CaptureSource,
  artifact: CaptureArtifactReference | undefined,
): string | null {
  const [error, setError] = useState<Error | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const artifactKey = artifact ? JSON.stringify(artifact) : null
  const artifactSnapshot = useMemo(
    () =>
      artifactKey
        ? CaptureArtifactReferenceSchema.parse(JSON.parse(artifactKey) as unknown)
        : undefined,
    [artifactKey],
  )

  useEffect(() => {
    const abort = new AbortController()
    let dispose: (() => void) | undefined
    setError(null)
    setUrl(null)
    if (!artifactSnapshot) return () => abort.abort()

    const resolve: Promise<CaptureArtifactResolution> = source.resolveArtifact
      ? source.resolveArtifact(artifactSnapshot, abort.signal)
      : artifactSnapshot.uri
        ? Promise.resolve({ url: artifactSnapshot.uri })
        : Promise.reject(new Error(`Capture artifact ${artifactSnapshot.id} has no URI.`))
    void resolve
      .then((result) => {
        if (abort.signal.aborted) {
          result.dispose?.()
          return
        }
        dispose = result.dispose
        setUrl(result.url)
      })
      .catch((cause: unknown) => {
        if (!abort.signal.aborted) {
          setError(
            cause instanceof Error ? cause : new Error('Could not resolve capture artifact.'),
          )
        }
      })
    return () => {
      abort.abort()
      dispose?.()
    }
  }, [artifactSnapshot, source])

  if (error) throw error
  return url
}
