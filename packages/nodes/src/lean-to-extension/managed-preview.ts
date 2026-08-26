import type { AnyNode, AnyNodeId, LeanToExtensionNode, SceneApi } from '@pascal-app/core'
import {
  isManagedLeanToNode,
  isManagedLeanToPost,
  leanToCanopyCornerPostLayoutPatch,
  leanToCornerPostIndex,
  leanToCornerPostLayoutPatch,
  leanToDownspoutLayoutPatch,
  leanToGutterLayoutPatch,
  leanToPostLayoutPatch,
  leanToRoofSegmentLayoutPatch,
  managedLeanToPostIndex,
  managedLeanToPostSide,
  managedLeanToRoofPlane,
  resolveLeanToPostBaseY,
  resolveLeanToPostBaseYAtLocalPosition,
  resolveLeanToPostGutterSetback,
} from './assembly'
import { resolveFreestandingCanopyJoints } from './canopy-joint'
import { resolveLeanToCornerJoints } from './corner-joint'
import { isDualSlopeLeanToCanopy } from './layout'

export function leanToManagedPreviewOverrides(
  node: LeanToExtensionNode,
  patch: Partial<LeanToExtensionNode>,
  sceneApi: SceneApi,
): ReadonlyArray<readonly [AnyNodeId, Partial<AnyNode>]> {
  const next = { ...node, ...patch } as LeanToExtensionNode
  const nodes = sceneApi.nodes() as Record<AnyNodeId, AnyNode>
  const entries: Array<readonly [AnyNodeId, Partial<AnyNode>]> = []

  const wall = next.parentId ? nodes[next.parentId as AnyNodeId] : undefined
  const cornerJoints = resolveLeanToCornerJoints(
    next,
    wall?.type === 'wall' ? wall : undefined,
    nodes,
  )
  const canopyJoints = resolveFreestandingCanopyJoints(next, nodes)
  for (const childId of next.children) {
    const child = nodes[childId as AnyNodeId]
    if (!child) continue

    if (child.type === 'column' && isManagedLeanToPost(child, next.id)) {
      const index = managedLeanToPostIndex(child)
      if (index === null) continue
      const side = managedLeanToPostSide(child)
      const cornerSide =
        index === leanToCornerPostIndex('left')
          ? 'left'
          : index === leanToCornerPostIndex('right')
            ? 'right'
            : null
      if (cornerSide) {
        const gutterSetback = resolveLeanToPostGutterSetback(next, child)
        const cornerJoint = cornerJoints[cornerSide]
        const canopyJoint = canopyJoints[cornerSide]
        const ungroundedPatch = cornerJoint
          ? leanToCornerPostLayoutPatch(next, cornerJoint, 0, gutterSetback)
          : canopyJoint
            ? leanToCanopyCornerPostLayoutPatch(next, canopyJoint, side, 0, gutterSetback)
            : null
        if (!ungroundedPatch) continue
        const baseY = resolveLeanToPostBaseYAtLocalPosition(
          next,
          wall?.type === 'wall' ? wall : undefined,
          nodes,
          ungroundedPatch.position,
        )
        entries.push([
          child.id as AnyNodeId,
          (cornerJoint
            ? leanToCornerPostLayoutPatch(next, cornerJoint, baseY, gutterSetback)
            : leanToCanopyCornerPostLayoutPatch(
                next,
                canopyJoint!,
                side,
                baseY,
                gutterSetback,
              )) as Partial<AnyNode>,
        ])
        continue
      }
      const baseY =
        wall?.type === 'wall' ? resolveLeanToPostBaseY(next, wall, nodes, index, side) : 0
      const gutterSetback =
        side === 'low' || (side === 'high' && isDualSlopeLeanToCanopy(next.canopyForm))
          ? resolveLeanToPostGutterSetback(next, child)
          : 0
      entries.push([
        child.id as AnyNodeId,
        leanToPostLayoutPatch(next, index, baseY, gutterSetback, side) as Partial<AnyNode>,
      ])
      continue
    }

    if (child.type !== 'roof' || !isManagedLeanToNode(child, next.id, 'roof')) continue
    const segments = child.children
      .map((id) => nodes[id as AnyNodeId])
      .filter(
        (candidate): candidate is Extract<AnyNode, { type: 'roof-segment' }> =>
          candidate?.type === 'roof-segment' &&
          isManagedLeanToNode(candidate, next.id, 'roof-segment'),
      )
    const segment = segments.find((candidate) => managedLeanToRoofPlane(candidate) === 'primary')
    for (const candidate of segments) {
      const plane = managedLeanToRoofPlane(candidate)
      const candidatePatch = leanToRoofSegmentLayoutPatch(next, nodes, plane)
      entries.push([candidate.id as AnyNodeId, candidatePatch as Partial<AnyNode>])
    }
    if (!segment) continue

    const nextSegment = {
      ...segment,
      ...leanToRoofSegmentLayoutPatch(next, nodes, 'primary'),
    }
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
