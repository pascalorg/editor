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
import { ErrorBoundary, useNodeEvents } from '@pascal-app/viewer'
import { createPortal, useFrame } from '@react-three/fiber'
import { type ComponentType, type ReactNode, Suspense, useEffect, useMemo, useState } from 'react'
import type { Object3D } from 'three'
import { resolveCaptureFrameMatrix } from './frame'
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
  maxPacketsPerStream?: number
  onError?: (error: Error, context: CaptureRuntimeErrorContext) => void
  renderers?: Readonly<Record<string, CaptureStreamRenderer>>
  resolveSource: CaptureSourceResolver
}

const EMPTY_RENDERERS: Readonly<Record<string, CaptureStreamRenderer>> = {}
type CaptureSessionScan = ScanNode & { captureSession: CaptureSessionLocator }

export function CaptureRuntime({
  maxPacketsPerStream = 32,
  onError,
  renderers = EMPTY_RENDERERS,
  resolveSource,
}: CaptureRuntimeProps) {
  const nodes = useScene((state) => state.nodes)
  const scans = useMemo(
    () =>
      Object.values(nodes).filter(
        (node): node is CaptureSessionScan => node.type === 'scan' && node.captureSession !== null,
      ),
    [nodes],
  )

  return (
    <>
      {scans.map((scan) => (
        <CaptureSessionPortal
          key={scan.id}
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
  maxPacketsPerStream,
  onError,
  renderers,
  resolveSource,
  scan,
}: {
  maxPacketsPerStream: number
  onError?: (error: Error, context: CaptureRuntimeErrorContext) => void
  renderers: Readonly<Record<string, CaptureStreamRenderer>>
  resolveSource: CaptureSourceResolver
  scan: CaptureSessionScan
}) {
  const [target, setTarget] = useState<Object3D | null>(null)
  const handlers = useNodeEvents(scan, 'scan')
  const sourceState = useCaptureSource(scan.captureSession, resolveSource, {
    maxPacketsPerStream,
  })

  useEffect(() => {
    if (!sourceState.error) return
    onError?.(sourceState.error, {
      phase: 'source',
      scanId: scan.id,
      sessionId: scan.captureSession.sessionId,
    })
  }, [onError, scan.captureSession.sessionId, scan.id, sourceState.error])

  useFrame(() => {
    const nextTarget = sceneRegistry.nodes.get(scan.id) ?? null
    if (nextTarget !== target) setTarget(nextTarget)
  })

  const descriptor = sourceState.descriptor
  const source = sourceState.source
  const customRendererKeys = useMemo(() => new Set(Object.keys(renderers)), [renderers])
  if (!(target && descriptor && source)) return null

  return createPortal(
    <group {...handlers}>
      {descriptor.streams.map((stream) => {
        const layerKey = captureLayerKey(stream)
        if ((scan.layers[layerKey] ?? true) === false) return null
        if (!isCaptureStreamRenderable(stream, customRendererKeys)) return null
        const renderKey = captureStreamRenderKey(stream)
        return (
          <ErrorBoundary
            fallback={<group />}
            key={renderKey}
            onError={(error) =>
              onError?.(error, {
                layerKey,
                phase: 'stream',
                scanId: scan.id,
                sessionId: scan.captureSession.sessionId,
                streamId: stream.id,
                streamKind: stream.kind,
              })
            }
            resetKey={`${renderKey}:${sourceState.descriptorVersion}`}
            scope={`capture:${layerKey}`}
          >
            <Suspense fallback={null}>
              <CaptureStreamLayer
                descriptor={descriptor}
                packets={sourceState.packets[stream.id] ?? []}
                renderers={renderers}
                scan={scan}
                source={source}
                stream={stream}
                streamEpoch={
                  sourceState.streamEpochs[stream.id] ??
                  `descriptor:${descriptor.revisionId ?? ''}:${stream.id}:${stream.frameId ?? ''}`
                }
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
  const frameId = packets.at(-1)?.frameId ?? stream.frameId ?? stream.artifact?.frameId
  const frameMatrix = useMemo(
    () => resolveCaptureFrameMatrix(descriptor, frameId),
    [descriptor, frameId],
  )
  const trajectory = useMemo(() => {
    if (layerKey !== 'deviceMotion') return null
    const inline = DeviceMotionTrajectorySchema.safeParse(stream.inline)
    return inline.success
      ? parseDeviceTrajectoryPayload(inline.data)
      : parseDeviceTrajectoryPackets(packets.map((packet) => packet.payload))
  }, [layerKey, packets, stream.inline])
  const motionPlaybackKey = useMemo(() => {
    if (layerKey !== 'deviceMotion') return ''
    const inlineVersion = packets.length === 0 ? JSON.stringify(stream.inline ?? null) : ''
    return [descriptor.revisionId ?? '', streamEpoch, inlineVersion].join(':')
  }, [descriptor.revisionId, layerKey, packets.length, stream.inline, streamEpoch])
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
        inline={stream.inline}
        packets={stream.availability === 'live' ? packets : []}
      />
    )
  } else if (layerKey === 'surfaceMesh') {
    content = <CaptureSurfaceMeshLayer inline={stream.inline} />
  }
  if (!(content && frameMatrix)) return content
  return (
    <group matrix={frameMatrix} matrixAutoUpdate={false}>
      {content}
    </group>
  )
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
