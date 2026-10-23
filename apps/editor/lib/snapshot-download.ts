import { emitter } from '@pascal-app/core'
import type { SnapshotCameraData } from '@pascal-app/editor'

function downloadImage(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  try {
    anchor.click()
    return url
  } finally {
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}

/** A user snapshot downloads locally; background thumbnails use their own upload path. */
export async function downloadSnapshot(
  projectId: string,
  projectName: string,
  blob: Blob,
  camera: SnapshotCameraData,
  download: (blob: Blob, filename: string) => string | Promise<string> = downloadImage,
) {
  const name = projectName.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'Pascal'
  const extension = blob.type === 'image/png' ? 'png' : blob.type === 'image/jpeg' ? 'jpg' : 'webp'
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const url = await download(blob, `${name}-snapshot-${timestamp}.${extension}`)
  emitter.emit('snapshot:saved', {
    projectId,
    requestId: camera.requestId,
    id: camera.requestId ?? crypto.randomUUID(),
    url,
    width: camera.resolution?.w ?? 0,
    height: camera.resolution?.h ?? 0,
  })
}
