'use client'
import type { WallFeatureNode } from '@pascal-app/core'
import { WallFeatureGesture } from './tool'
export default function MoveWallFeatureTool({ node }: { node: WallFeatureNode }) {
  return <WallFeatureGesture node={node} moving />
}
