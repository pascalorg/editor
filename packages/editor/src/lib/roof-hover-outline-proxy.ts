import { type AnyNodeId, sceneRegistry, useScene } from '@pascal-app/core'
import type * as THREE from 'three'

export const HOVERED_ROOF_SEGMENT_OUTLINE_PROXY_NAME = '__roof-hover-outline-proxy__'

function hoveredRoofSegmentOutlineProxyName(segmentId: string) {
  return `${HOVERED_ROOF_SEGMENT_OUTLINE_PROXY_NAME}:${segmentId}`
}

export function getHoveredRoofSegmentOutlineProxy(segmentId: string): THREE.Object3D | null {
  const segment = useScene.getState().nodes[segmentId as AnyNodeId]
  if (!(segment?.type === 'roof-segment' && segment.parentId)) return null
  return (
    sceneRegistry.nodes
      .get(segment.parentId)
      ?.getObjectByName(hoveredRoofSegmentOutlineProxyName(segmentId)) ?? null
  )
}

export function getHoveredRoofSegmentOutlineProxyName(segmentId: string): string {
  return hoveredRoofSegmentOutlineProxyName(segmentId)
}
