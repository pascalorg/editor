import {
  type AnyNodeId,
  GuideNode,
  type GuideNode as GuideNodeType,
  ScanNode,
  type ScanNode as ScanNodeType,
  saveAsset,
} from '@pascal-app/core'

export function getGuideImageName(filename: string) {
  return getAssetName(filename, 'Guide image')
}

export function getScanName(filename: string) {
  return getAssetName(filename, 'Scan')
}

function getAssetName(filename: string, fallback: string) {
  const trimmed = filename.trim()
  if (!trimmed) {
    return fallback
  }

  const dotIndex = trimmed.lastIndexOf('.')
  return dotIndex > 0 ? trimmed.slice(0, dotIndex) : trimmed
}

export async function createLocalGuideImage({
  createNode,
  file,
  levelId,
  position = [0, 0, 0],
}: {
  createNode: (node: GuideNodeType, parentId: AnyNodeId) => void
  file: File
  levelId: string
  position?: [number, number, number]
}) {
  const assetUrl = await saveAsset(file)
  const guide = GuideNode.parse({
    name: getGuideImageName(file.name),
    url: assetUrl,
    position,
    rotation: [0, 0, 0],
    scale: 1,
    opacity: 50,
    scaleReference: null,
  })

  createNode(guide, levelId as AnyNodeId)
  return guide
}

/** Logs a failed {@link createLocalGuideImage} and returns the message to show for it. */
export function guideImageErrorMessage(error: unknown): string {
  console.error('[guide-image]', error)
  return error instanceof Error && error.message
    ? `Could not add that guide image: ${error.message}`
    : 'Could not add that guide image.'
}

export async function createLocalScan({
  createNode,
  file,
  levelId,
}: {
  createNode: (node: ScanNodeType, parentId: AnyNodeId) => void
  file: File
  levelId: string
}) {
  const assetUrl = await saveAsset(file)
  const scan = ScanNode.parse({
    name: getScanName(file.name),
    url: assetUrl,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: 1,
    opacity: 100,
  })

  createNode(scan, levelId as AnyNodeId)
  return { scan, url: assetUrl }
}
