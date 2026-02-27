import {
  type AnyNodeId,
  ScanNode as ScanNodeSchema,
  GuideNode as GuideNodeSchema,
  useScene,
} from '@pascal-app/core'
import {
  createAssetUploadUrl,
  confirmAssetUpload,
  type AssetType,
} from '@/features/community/lib/assets/actions'
import { useUploadStore } from '@/store/use-upload'
import useEditor from '@/store/use-editor'

/**
 * Upload a file directly to Supabase Storage via signed URL with progress tracking.
 * Runs entirely outside React — survives component unmounts.
 */
export function uploadAssetWithProgress(
  projectId: string,
  levelId: string,
  file: File,
  assetType: AssetType,
) {
  const store = useUploadStore.getState()
  store.startUpload(levelId, assetType, file.name)

  // Run async work without blocking the caller
  doUpload(projectId, levelId, file, assetType).catch(() => {
    // errors are already recorded in the store by doUpload
  })
}

async function doUpload(
  projectId: string,
  levelId: string,
  file: File,
  assetType: AssetType,
) {
  const store = () => useUploadStore.getState()

  // Phase 1: Get signed URL
  const urlResult = await createAssetUploadUrl(
    projectId,
    file.name,
    file.type || 'application/octet-stream',
    assetType,
  )

  if (!urlResult.success) {
    store().setError(levelId, urlResult.error)
    return
  }

  // Phase 2: Upload directly to Supabase via XHR (for progress)
  store().setStatus(levelId, 'uploading')

  try {
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest()

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100)
          useUploadStore.getState().setProgress(levelId, pct)
        }
      })

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve()
        } else {
          reject(new Error(`Upload failed: HTTP ${xhr.status}`))
        }
      })

      xhr.addEventListener('error', () => reject(new Error('Network error during upload')))
      xhr.addEventListener('abort', () => reject(new Error('Upload aborted')))

      xhr.open('PUT', urlResult.signedUrl)
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
      xhr.send(file)
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Upload failed'
    store().setError(levelId, msg)
    return
  }

  // Phase 3: Confirm upload and record in DB
  store().setStatus(levelId, 'confirming')

  const confirmResult = await confirmAssetUpload(
    projectId,
    urlResult.assetId,
    urlResult.storageKey,
    file.name,
    file.type || null,
    assetType,
  )

  if (!confirmResult.success) {
    store().setError(levelId, confirmResult.error)
    return
  }

  // Phase 4: Create scene node (works even if component is unmounted)
  const Schema = assetType === 'scan' ? ScanNodeSchema : GuideNodeSchema
  const node = Schema.parse({
    url: confirmResult.url,
    name: file.name,
    parentId: levelId,
  })
  useScene.getState().createNode(node, levelId as AnyNodeId)
  useEditor.getState().setSelectedReferenceId(node.id)

  store().setResult(levelId, confirmResult.url)

  // Auto-clear after a short delay so the UI shows "done" briefly
  setTimeout(() => {
    useUploadStore.getState().clearUpload(levelId)
  }, 1500)
}
