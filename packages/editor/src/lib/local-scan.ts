import {
  type AnyNodeId,
  ScanNode,
  type ScanNode as ScanNodeType,
  saveAsset,
} from '@pascal-app/core'
import { getGuideImageName } from './local-guide-image'

export async function createLocalScan({
  createNode,
  file,
  levelId,
  position = [0, 0, 0],
}: {
  createNode: (node: ScanNodeType, parentId: AnyNodeId) => void
  file: File
  levelId: string
  position?: [number, number, number]
}) {
  const assetUrl = await saveAsset(file)
  const scan = ScanNode.parse({
    name: getGuideImageName(file.name),
    url: assetUrl,
    position,
    rotation: [0, 0, 0],
    scale: 1,
  })

  createNode(scan, levelId as AnyNodeId)
  return scan
}
