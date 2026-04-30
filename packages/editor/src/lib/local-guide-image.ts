import {
  type AnyNodeId,
  GuideNode,
  type GuideNode as GuideNodeType,
  saveAsset,
} from '@pascal-app/core'

export function getGuideImageName(filename: string) {
  const trimmed = filename.trim()
  if (!trimmed) {
    return 'Guide image'
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
    locked: false,
    showIn3d: false,
    scaleReference: null,
  })

  createNode(guide, levelId as AnyNodeId)
  return guide
}
