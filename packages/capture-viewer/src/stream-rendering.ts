import {
  type CaptureArtifactReference,
  type CaptureStreamDescriptor,
  captureLayerKey,
  DeviceMotionTrajectorySchema,
} from '@pascal-app/capture-protocol'

const GLB_MEDIA_TYPES = new Set(['model/gltf-binary', 'model/gltf+json'])
const USDZ_MEDIA_TYPES = new Set(['model/vnd.usdz+zip'])
const PLY_MEDIA_TYPES = new Set(['application/ply', 'application/vnd.ply', 'model/ply'])

export type CaptureModelFormat = 'gltf' | 'usdz'

export function isCaptureStreamRenderable(
  stream: CaptureStreamDescriptor,
  customRendererKeys: ReadonlySet<string> = new Set(),
): boolean {
  if (stream.availability === 'failed' || stream.availability === 'pending') return false
  const layerKey = captureLayerKey(stream)
  if (customRendererKeys.has(layerKey) || customRendererKeys.has(stream.kind)) return true
  if (layerKey === 'model') return isCaptureModelArtifact(stream.artifact)
  if (layerKey === 'deviceMotion') {
    return (
      stream.availability === 'live' ||
      DeviceMotionTrajectorySchema.safeParse(stream.inline).success
    )
  }
  if (layerKey === 'pointCloud') {
    return stream.availability === 'live' || isCapturePointCloudArtifact(stream.artifact)
  }
  return false
}

export function isCaptureModelArtifact(artifact: CaptureArtifactReference | undefined): boolean {
  return captureModelFormat(artifact) !== null
}

export function captureModelFormat(
  artifact: CaptureArtifactReference | undefined,
): CaptureModelFormat | null {
  if (!artifact) return null
  if (USDZ_MEDIA_TYPES.has(artifact.mediaType) || hasExtension(artifact.uri, ['.usdz'])) {
    return 'usdz'
  }
  if (GLB_MEDIA_TYPES.has(artifact.mediaType) || hasExtension(artifact.uri, ['.glb', '.gltf'])) {
    return 'gltf'
  }
  return null
}

export function isCapturePointCloudArtifact(
  artifact: CaptureArtifactReference | undefined,
): boolean {
  if (!artifact) return false
  return PLY_MEDIA_TYPES.has(artifact.mediaType) || hasExtension(artifact.uri, ['.ply'])
}

function hasExtension(uri: string | undefined, extensions: readonly string[]): boolean {
  if (!uri) return false
  const path = uri.split(/[?#]/, 1)[0]?.toLowerCase() ?? ''
  return extensions.some((extension) => path.endsWith(extension))
}
