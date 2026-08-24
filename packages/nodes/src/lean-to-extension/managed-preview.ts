import type { AnyNode, AnyNodeId, LeanToExtensionNode, SceneApi } from '@pascal-app/core'
import {
  isManagedLeanToNode,
  isManagedLeanToPost,
  leanToDownspoutLayoutPatch,
  leanToGutterLayoutPatch,
  leanToPostLayoutPatch,
  leanToRoofSegmentLayoutPatch,
  managedLeanToPostIndex,
  managedLeanToPostSide,
  resolveLeanToPostBaseY,
  resolveLeanToPostGutterSetback,
} from './assembly'

export function leanToManagedPreviewOverrides(
  node: LeanToExtensionNode,
  patch: Partial<LeanToExtensionNode>,
  sceneApi: SceneApi,
): ReadonlyArray<readonly [AnyNodeId, Partial<AnyNode>]> {
  const next = { ...node, ...patch } as LeanToExtensionNode
  const nodes = sceneApi.nodes() as Record<AnyNodeId, AnyNode>
  const entries: Array<readonly [AnyNodeId, Partial<AnyNode>]> = []

  const wall = next.parentId ? nodes[next.parentId as AnyNodeId] : undefined
  for (const childId of next.children) {
    const child = nodes[childId as AnyNodeId]
    if (!child) continue

    if (child.type === 'column' && isManagedLeanToPost(child, next.id)) {
      const index = managedLeanToPostIndex(child)
      if (index === null) continue
      const side = managedLeanToPostSide(child)
      const baseY =
        wall?.type === 'wall' ? resolveLeanToPostBaseY(next, wall, nodes, index, side) : 0
      const gutterSetback = side === 'low' ? resolveLeanToPostGutterSetback(next, child) : 0
      entries.push([
        child.id as AnyNodeId,
        leanToPostLayoutPatch(next, index, baseY, gutterSetback, side) as Partial<AnyNode>,
      ])
      continue
    }

    if (child.type !== 'roof' || !isManagedLeanToNode(child, next.id, 'roof')) continue
    const segment = child.children
      .map((id) => nodes[id as AnyNodeId])
      .find(
        (candidate) =>
          candidate?.type === 'roof-segment' &&
          isManagedLeanToNode(candidate, next.id, 'roof-segment'),
      )
    if (segment?.type !== 'roof-segment') continue

    const segmentPatch = leanToRoofSegmentLayoutPatch(next, nodes)
    entries.push([segment.id as AnyNodeId, segmentPatch as Partial<AnyNode>])

    const nextSegment = { ...segment, ...segmentPatch }
    const gutter = segment.children
      .map((id) => nodes[id as AnyNodeId])
      .find(
        (candidate) =>
          candidate?.type === 'gutter' && isManagedLeanToNode(candidate, next.id, 'gutter'),
      )
    if (gutter?.type !== 'gutter') continue
    const gutterPatch = leanToGutterLayoutPatch(nextSegment, next, gutter, nodes)
    entries.push([gutter.id as AnyNodeId, gutterPatch as Partial<AnyNode>])

    const nextGutter = { ...gutter, ...gutterPatch }
    const downspout = segment.children
      .map((id) => nodes[id as AnyNodeId])
      .find(
        (candidate) =>
          candidate?.type === 'downspout' && isManagedLeanToNode(candidate, next.id, 'downspout'),
      )
    if (downspout?.type === 'downspout') {
      entries.push([
        downspout.id as AnyNodeId,
        leanToDownspoutLayoutPatch(nextSegment, nextGutter, next, downspout) as Partial<AnyNode>,
      ])
    }
  }

  return entries
}
