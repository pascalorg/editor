'use client'
import type { SlabFeatureNode } from '@pascal-app/core'
import { SlabFeatureGesture } from './tool'
export default function MoveSlabFeatureTool({ node }: { node: SlabFeatureNode }) {
  return <SlabFeatureGesture node={node} moving />
}
