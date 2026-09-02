'use client'

import type {
  AnyNode,
  AnyNodeId,
  ColumnNode,
  DownspoutNode,
  GutterNode,
  LeanToExtensionNode,
  RoofNode,
  RoofSegmentNode,
  SceneApi,
  WallNode,
} from '@pascal-app/core'
import { useEffect } from 'react'
import { isLeanToPostOmitted } from '../shared/lean-to-post-omissions'
import { bendLocalPoint } from './arc'
import {
  createManagedLeanToCanopyCornerPost,
  createManagedLeanToCornerPost,
  createManagedLeanToDrainagePair,
  createManagedLeanToPost,
  createManagedLeanToRoofAssembly,
  createManagedLeanToRoofSegment,
  isManagedLeanToNode,
  isManagedLeanToPost,
  type LeanToDrainageSide,
  type LeanToPostSide,
  type LeanToRoofPlane,
  leanToCanopyCornerPostLayoutPatch,
  leanToCornerPostIndex,
  leanToCornerPostLayoutPatch,
  leanToDownspoutLayoutPatch,
  leanToGutterLayoutPatch,
  leanToPostLayoutPatch,
  leanToRoofMaterialPatch,
  leanToRoofSegmentLayoutPatch,
  managedLeanToDrainageSide,
  managedLeanToPostIndex,
  managedLeanToPostSide,
  managedLeanToRoofPlane,
  resolveLeanToCanopyPostIndexes,
  resolveLeanToPostBaseY,
  resolveLeanToPostBaseYAtLocalPosition,
  resolveLeanToPostGutterSetback,
} from './assembly'
import {
  canopyCornerJointMetadata,
  FREESTANDING_CANOPY_JOINTS_KEY,
  resolveFreestandingCanopyJoints,
} from './canopy-joint'
import { resolveConicalLeanToPlacement } from './conical-host'
import {
  LEAN_TO_CORNER_JOINTS_KEY,
  leanToCornerJointMetadata,
  resolveLeanToCornerJoints,
} from './corner-joint'
import {
  isDualSlopeLeanToCanopy,
  LEAN_TO_EXTENSION_GEOMETRY_REVISION,
  resolveLeanToSpanArc,
} from './layout'
import { reconcileLeanToSlabEdgePlacement } from './placement'
import { resolveLeanToEndAbutments } from './placement-validation'
import {
  applyLeanToAvailableWallSpan,
  applyLeanToRoofAttachment,
  applyLeanToWallAutoSpan,
  applyLeanToWallCornerSpan,
  clearLeanToRoofAttachment,
  resolveLeanToHostRoof,
  resolveLeanToRoofAttachment,
} from './roof-attachment'

const BROAD_LEAN_TO_DEPENDENCY_TYPES = new Set<AnyNode['type']>([
  'site',
  'building',
  'level',
  'slab',
  'wall',
  'lean-to-extension',
  'roof',
  'roof-segment',
])

function affectedLeanToIds(
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
  previous: Readonly<Record<AnyNodeId, AnyNode>>,
  changedIds: ReadonlySet<AnyNodeId>,
  leanToIds: ReadonlySet<AnyNodeId>,
): Set<AnyNodeId> {
  const affected = new Set<AnyNodeId>()
  for (const id of changedIds) {
    const candidate = nodes[id] ?? previous[id]
    if (!candidate) continue
    if (candidate.type === 'lean-to-extension') affected.add(id)
    const managedBy = (candidate.metadata as Record<string, unknown> | undefined)?.managedByLeanTo
    if (typeof managedBy === 'string') affected.add(managedBy as AnyNodeId)
    let parentId = candidate.parentId as AnyNodeId | null
    const seen = new Set<AnyNodeId>()
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId)
      const parent = nodes[parentId] ?? previous[parentId]
      if (!parent) break
      if (parent.type === 'lean-to-extension') {
        affected.add(parent.id as AnyNodeId)
        break
      }
      parentId = parent.parentId as AnyNodeId | null
    }
    if (BROAD_LEAN_TO_DEPENDENCY_TYPES.has(candidate.type)) {
      for (const leanToId of leanToIds) affected.add(leanToId)
    }
  }
  return affected
}

function sameTuple(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function postNeedsLayoutUpdate(
  post: ColumnNode,
  leanTo: LeanToExtensionNode,
  index: number,
  baseY: number,
  gutterSetback: number,
  side: LeanToPostSide,
) {
  const expected = leanToPostLayoutPatch(leanTo, index, baseY, gutterSetback, side)
  return postPatchNeedsLayoutUpdate(post, expected)
}

function postPatchNeedsLayoutUpdate(
  post: ColumnNode,
  expected: ReturnType<typeof leanToPostLayoutPatch>,
) {
  return (
    !sameTuple(post.position, expected.position) ||
    post.height !== expected.height ||
    post.width !== expected.width ||
    post.depth !== expected.depth ||
    post.crossSection !== expected.crossSection ||
    post.baseStyle !== expected.baseStyle ||
    post.baseHeight !== expected.baseHeight ||
    post.baseWidthScale !== expected.baseWidthScale ||
    post.baseDepthScale !== expected.baseDepthScale ||
    JSON.stringify(post.slots) !== JSON.stringify(expected.slots)
  )
}

function segmentNeedsLayoutUpdate(
  segment: RoofSegmentNode,
  leanTo: LeanToExtensionNode,
  nodes: Record<AnyNodeId, AnyNode>,
  plane: LeanToRoofPlane = 'primary',
) {
  const expected = leanToRoofSegmentLayoutPatch(leanTo, nodes, plane)
  return (
    !sameTuple(segment.position, expected.position) ||
    segment.rotation !== expected.rotation ||
    segment.roofType !== expected.roofType ||
    segment.width !== expected.width ||
    segment.depth !== expected.depth ||
    segment.wallHeight !== expected.wallHeight ||
    segment.pitch !== expected.pitch ||
    segment.wallThickness !== expected.wallThickness ||
    segment.deckThickness !== expected.deckThickness ||
    segment.shingleThickness !== expected.shingleThickness ||
    segment.overhang !== expected.overhang ||
    JSON.stringify(segment.arc) !== JSON.stringify(expected.arc) ||
    segment.shedSideInfillSpan !== expected.shedSideInfillSpan ||
    segment.shedSideInfillMinX !== expected.shedSideInfillMinX ||
    segment.shedSideInfillMaxX !== expected.shedSideInfillMaxX ||
    JSON.stringify(segment.shedFootprintPieces) !== JSON.stringify(expected.shedFootprintPieces) ||
    JSON.stringify(segment.shedOpenEndSides) !== JSON.stringify(expected.shedOpenEndSides) ||
    JSON.stringify(segment.trim) !== JSON.stringify(expected.trim) ||
    JSON.stringify(segment.metadata) !== JSON.stringify(expected.metadata)
  )
}

function gutterNeedsLayoutUpdate(
  gutter: GutterNode,
  segment: RoofSegmentNode,
  leanTo: LeanToExtensionNode,
  nodes: Record<string, AnyNode>,
  drainageSide: LeanToDrainageSide = 'primary',
) {
  const expected = leanToGutterLayoutPatch(segment, leanTo, gutter, nodes, drainageSide)
  return (
    !sameTuple(gutter.position, expected.position) ||
    gutter.rotation !== expected.rotation ||
    gutter.length !== expected.length ||
    JSON.stringify(gutter.arc) !== JSON.stringify(expected.arc) ||
    gutter.roofSegmentId !== expected.roofSegmentId ||
    gutter.visible !== expected.visible ||
    gutter.profile !== expected.profile ||
    gutter.size !== expected.size ||
    gutter.endCapLeft !== expected.endCapLeft ||
    gutter.endCapRight !== expected.endCapRight ||
    JSON.stringify(gutter.outlets) !== JSON.stringify(expected.outlets) ||
    JSON.stringify(gutter.metadata) !== JSON.stringify(expected.metadata)
  )
}

function downspoutNeedsLayoutUpdate(
  downspout: DownspoutNode,
  gutter: GutterNode,
  segment: RoofSegmentNode,
  leanTo: LeanToExtensionNode,
) {
  const expected = leanToDownspoutLayoutPatch(segment, gutter, leanTo, downspout)
  return (
    downspout.diameter !== expected.diameter ||
    downspout.gutterId !== expected.gutterId ||
    downspout.lengthMode !== expected.lengthMode ||
    downspout.visible !== expected.visible ||
    downspout.outletId !== expected.outletId
  )
}

// The ground beneath each post — its slab support or terrain height — feeds
// the post base Y but is not otherwise part of the lean-to's own fields, so
// terrain edits and slab moves would leave the reconcile signature unchanged
// and the posts stuck at a stale height. Folding the resolved base Ys into the
// signature makes those external changes trigger a re-reconcile.
function leanToGroundSignature(
  leanTo: LeanToExtensionNode,
  nodes: Record<AnyNodeId, AnyNode>,
): number[] {
  const parent = leanTo.parentId ? nodes[leanTo.parentId as AnyNodeId] : undefined
  const wall = parent?.type === 'wall' ? (parent as WallNode) : undefined
  const cornerJoints = resolveLeanToCornerJoints(leanTo, wall, nodes)
  const canopyJoints = resolveFreestandingCanopyJoints(leanTo, nodes)
  const sides: LeanToPostSide[] =
    leanTo.highSideMode === 'independent-high-beam' ? ['low', 'high'] : ['low']
  const values: number[] = []
  for (const side of sides) {
    for (const index of resolveLeanToCanopyPostIndexes(leanTo, cornerJoints, canopyJoints, side)) {
      values.push(resolveLeanToPostBaseY(leanTo, wall, nodes, index, side))
    }
  }
  for (const joint of Object.values(cornerJoints)) {
    if (!joint?.sharedPostOwner) continue
    if (isLeanToPostOmitted(leanTo, 'low', leanToCornerPostIndex(joint.side))) continue
    const bent = bendLocalPoint(leanTo, joint.sharedPostPosition[0], joint.sharedPostPosition[2])
    values.push(
      resolveLeanToPostBaseYAtLocalPosition(leanTo, wall, nodes, [
        bent.x,
        joint.sharedPostPosition[1],
        bent.y,
      ]),
    )
  }
  for (const joint of Object.values(canopyJoints)) {
    if (!joint?.sharedPostOwner || cornerJoints[joint.side]) continue
    for (const side of sides) {
      if (isLeanToPostOmitted(leanTo, side, leanToCornerPostIndex(joint.side))) continue
      const patch = leanToCanopyCornerPostLayoutPatch(leanTo, joint, side)
      values.push(resolveLeanToPostBaseYAtLocalPosition(leanTo, wall, nodes, patch.position))
    }
  }
  return values.map((value) => Math.round(value * 1e5) / 1e5)
}

function extensionSignature(
  leanTo: LeanToExtensionNode,
  hostRoof: RoofNode | undefined,
  nodes: Record<AnyNodeId, AnyNode>,
): string {
  return JSON.stringify([
    leanToGroundSignature(leanTo, nodes),
    leanTo.hostKind,
    leanTo.canopyForm,
    leanTo.span,
    leanTo.spanArcCenterZ,
    leanTo.spanArcRadius,
    leanTo.autoSpan,
    leanTo.position,
    leanTo.projection,
    leanTo.highEdgeHeight,
    leanTo.lowEdgeHeight,
    leanTo.pitch,
    leanTo.roofThickness,
    leanTo.shingleThickness,
    leanTo.highOverhang,
    leanTo.lowOverhang,
    leanTo.leftOverhang,
    leanTo.rightOverhang,
    leanTo.autoMiterCorners,
    leanTo.coveringType,
    leanTo.beamHeight,
    leanTo.rafterHeight,
    leanTo.rafterSpacing,
    leanTo.rafterEndInset,
    leanTo.postWidth,
    leanTo.postDepth,
    leanTo.postCount,
    leanTo.postLayoutMode,
    leanTo.postSpacing,
    leanTo.postInset,
    leanTo.omittedPostSlots,
    leanTo.postBracing,
    leanTo.footingStyle,
    leanTo.highSideMode,
    leanTo.ledgerVerticalOffset,
    leanTo.lowBeamInset,
    leanTo.slots,
    leanTo.connectionMode,
    leanTo.hostRoofId,
    leanTo.hostRoofSegmentId,
    leanTo.hostRoofEdge,
    leanTo.hostRoofEdgeRange,
    leanTo.connectionOffset,
    leanTo.connectionInset,
    leanTo.matchHostRoofMaterial,
    leanTo.matchHostRoofStructure,
    leanTo.gutterEnabled,
    leanTo.gutterProfile,
    leanTo.gutterSize,
    leanTo.downspoutEnabled,
    leanTo.downspoutPosition,
    hostRoof && leanTo.matchHostRoofMaterial !== false ? leanToRoofMaterialPatch(hostRoof) : null,
    Object.values(nodes)
      .filter((node) => node.type === 'lean-to-extension')
      .map((node) => ({
        id: node.id,
        parentId: node.parentId,
        hostKind: node.hostKind,
        canopyForm: node.canopyForm,
        position: node.position,
        rotation: node.rotation,
        span: node.span,
        projection: node.projection,
        highEdgeHeight: node.highEdgeHeight,
        pitch: node.pitch,
        roofThickness: node.roofThickness,
        shingleThickness: node.shingleThickness,
        beamHeight: node.beamHeight,
        rafterHeight: node.rafterHeight,
        leftOverhang: node.leftOverhang,
        rightOverhang: node.rightOverhang,
        lowOverhang: node.lowOverhang,
        autoMiterCorners: node.autoMiterCorners,
        gutterEnabled: node.gutterEnabled,
      })),
    leanTo.children,
    leanTo.children.map((childId) => {
      const child = nodes[childId as AnyNodeId]
      return child?.type === 'column' ? child : null
    }),
  ])
}

function attachmentNeedsUpdate(current: LeanToExtensionNode, next: LeanToExtensionNode): boolean {
  return (
    current.hostKind !== next.hostKind ||
    current.canopyForm !== next.canopyForm ||
    current.highSideMode !== next.highSideMode ||
    current.connectionMode !== next.connectionMode ||
    current.hostRoofId !== next.hostRoofId ||
    current.hostRoofSegmentId !== next.hostRoofSegmentId ||
    current.hostRoofEdge !== next.hostRoofEdge ||
    !sameTuple(current.hostRoofEdgeRange ?? [], next.hostRoofEdgeRange ?? []) ||
    current.connectionInset !== next.connectionInset ||
    current.highEdgeHeight !== next.highEdgeHeight ||
    current.lowEdgeHeight !== next.lowEdgeHeight ||
    current.leftEndCondition !== next.leftEndCondition ||
    current.rightEndCondition !== next.rightEndCondition ||
    current.downspoutPosition !== next.downspoutPosition ||
    current.span !== next.span ||
    current.spanArcCenterZ !== next.spanArcCenterZ ||
    current.spanArcRadius !== next.spanArcRadius ||
    !sameTuple(current.position, next.position) ||
    !sameTuple(current.rotation, next.rotation) ||
    current.roofThickness !== next.roofThickness ||
    current.shingleThickness !== next.shingleThickness ||
    JSON.stringify(current.metadata) !== JSON.stringify(next.metadata)
  )
}

function roofNeedsMaterialUpdate(roof: RoofNode, hostRoof: RoofNode): boolean {
  const expected = leanToRoofMaterialPatch(hostRoof)
  return Object.entries(expected).some(
    ([key, value]) => JSON.stringify(roof[key as keyof typeof expected]) !== JSON.stringify(value),
  )
}

function resolveEffectiveLeanTo(
  leanTo: LeanToExtensionNode,
  nodes: Record<AnyNodeId, AnyNode>,
): LeanToExtensionNode {
  if (leanTo.hostKind !== 'freestanding' && leanTo.canopyForm !== 'mono') {
    leanTo = { ...leanTo, canopyForm: 'mono' }
  }
  const parent = leanTo.parentId ? nodes[leanTo.parentId as AnyNodeId] : undefined
  if (parent?.type === 'roof-segment' && leanTo.hostKind === 'conical-roof') {
    return resolveConicalLeanToPlacement(parent, leanTo) ?? leanTo
  }
  if (leanTo.hostKind === 'slab-edge') {
    return reconcileLeanToSlabEdgePlacement(leanTo, nodes)
  }
  if (parent?.type !== 'wall') {
    const detached = leanTo.connectionMode === 'manual' ? leanTo : clearLeanToRoofAttachment(leanTo)
    if (leanTo.hostKind !== 'freestanding') return { ...detached, canopyForm: 'mono' }
    const freestanding = {
      ...detached,
      highSideMode: 'independent-high-beam',
    } as LeanToExtensionNode
    const withoutStaleJointEnds = {
      ...freestanding,
      leftEndCondition:
        freestanding.leftEndCondition === 'joined' ? 'open' : freestanding.leftEndCondition,
      rightEndCondition:
        freestanding.rightEndCondition === 'joined' ? 'open' : freestanding.rightEndCondition,
    } as LeanToExtensionNode
    const canopyJoints = resolveFreestandingCanopyJoints(withoutStaleJointEnds, nodes)
    const monoJoints = isDualSlopeLeanToCanopy(withoutStaleJointEnds.canopyForm)
      ? {}
      : resolveLeanToCornerJoints(withoutStaleJointEnds, undefined, nodes)
    const hasLeftJoint = Boolean(canopyJoints.left ?? monoJoints.left)
    const hasRightJoint = Boolean(canopyJoints.right ?? monoJoints.right)
    return {
      ...withoutStaleJointEnds,
      leftEndCondition: hasLeftJoint ? 'joined' : withoutStaleJointEnds.leftEndCondition,
      rightEndCondition: hasRightJoint ? 'joined' : withoutStaleJointEnds.rightEndCondition,
      metadata: {
        ...(withoutStaleJointEnds.metadata && typeof withoutStaleJointEnds.metadata === 'object'
          ? withoutStaleJointEnds.metadata
          : {}),
        [LEAN_TO_CORNER_JOINTS_KEY]: isDualSlopeLeanToCanopy(withoutStaleJointEnds.canopyForm)
          ? {}
          : leanToCornerJointMetadata(monoJoints),
        [FREESTANDING_CANOPY_JOINTS_KEY]: canopyCornerJointMetadata(canopyJoints),
      },
    }
  }
  const wall = parent as WallNode
  const wallSpanningLeanTo = applyLeanToWallCornerSpan(applyLeanToWallAutoSpan(leanTo, wall), wall)
  const retained =
    leanTo.hostRoofSegmentId && leanTo.hostRoofEdge
      ? resolveLeanToRoofAttachment(wallSpanningLeanTo, wall, nodes, {
          roofSegmentId: leanTo.hostRoofSegmentId,
          edge: leanTo.hostRoofEdge,
        })
      : null
  const attachment = retained ?? resolveLeanToRoofAttachment(wallSpanningLeanTo, wall, nodes)
  // Manual mode is an explicit user choice to detach from any roof; never
  // magnetically reattach it (doing so silently flipped connectionMode back to
  // 'auto' and overwrote the user's wall-side height). Auto mode still tracks
  // the nearest matching roof edge.
  const resolved =
    leanTo.connectionMode === 'manual'
      ? wallSpanningLeanTo
      : attachment
        ? applyLeanToRoofAttachment(wallSpanningLeanTo, attachment)
        : clearLeanToRoofAttachment(wallSpanningLeanTo)
  const withoutStaleJointEnds = {
    ...resolved,
    leftEndCondition: resolved.leftEndCondition === 'joined' ? 'open' : resolved.leftEndCondition,
    rightEndCondition:
      resolved.rightEndCondition === 'joined' ? 'open' : resolved.rightEndCondition,
  }
  const available = applyLeanToAvailableWallSpan(
    withoutStaleJointEnds,
    wall,
    nodes,
    leanTo.position[0],
  )
  const withAbutments = resolveLeanToEndAbutments(available, wall, nodes)
  const joints = resolveLeanToCornerJoints(withAbutments, wall, nodes)
  const spanArc = resolveLeanToSpanArc(wall, withAbutments)
  return {
    ...withAbutments,
    spanArcCenterZ: spanArc?.centerZ,
    spanArcRadius: spanArc?.radius,
    leftEndCondition: joints.left ? 'joined' : withAbutments.leftEndCondition,
    rightEndCondition: joints.right ? 'joined' : withAbutments.rightEndCondition,
    metadata: {
      ...(withAbutments.metadata && typeof withAbutments.metadata === 'object'
        ? withAbutments.metadata
        : {}),
      [LEAN_TO_CORNER_JOINTS_KEY]: leanToCornerJointMetadata(joints),
    },
  }
}

export function initializeLeanToExtensionSync(sceneApi: SceneApi) {
  const applyChanges = sceneApi.applyChanges
  const subscribeNodes = sceneApi.subscribeNodes
  if (!(applyChanges && subscribeNodes)) return () => {}
  const signatures = new Map<AnyNodeId, string>()
  const leanToIds = new Set<AnyNodeId>()
  for (const node of Object.values(sceneApi.nodes())) {
    if (node.type === 'lean-to-extension') leanToIds.add(node.id as AnyNodeId)
  }
  let syncing = false
  const reconcile = (candidateIds: Iterable<AnyNodeId>) => {
    const nodes = sceneApi.nodes() as Record<AnyNodeId, AnyNode>

    for (const id of candidateIds) {
      const candidate = nodes[id]
      if (candidate?.type !== 'lean-to-extension') {
        signatures.delete(id)
        leanToIds.delete(id)
        continue
      }
      const leanTo = candidate
      const effectiveLeanTo = resolveEffectiveLeanTo(leanTo, nodes)
      const parent = leanTo.parentId ? nodes[leanTo.parentId as AnyNodeId] : undefined
      const hostRoof = resolveLeanToHostRoof(effectiveLeanTo, nodes)
      const signature = extensionSignature(effectiveLeanTo, hostRoof, nodes)
      if (signatures.get(id) === signature) continue

      const managedPosts = new Map<string, ColumnNode>()
      const duplicateIds: AnyNodeId[] = []
      let roof: RoofNode | undefined
      for (const childId of leanTo.children) {
        const child = nodes[childId as AnyNodeId]
        if (!child) continue
        if (child.type === 'roof' && isManagedLeanToNode(child, leanTo.id, 'roof')) {
          roof ??= child
          continue
        }
        if (child.type !== 'column' || !isManagedLeanToPost(child, leanTo.id)) continue
        const index = managedLeanToPostIndex(child)
        const side = managedLeanToPostSide(child)
        const key = `${side}:${index}`
        if (index === null || managedPosts.has(key)) {
          duplicateIds.push(child.id as AnyNodeId)
        } else {
          managedPosts.set(key, child)
        }
      }

      const create: { node: AnyNode; parentId?: AnyNodeId }[] = []
      const update: { id: AnyNodeId; data: Partial<AnyNode> }[] = []
      const remove = [...duplicateIds]

      if (attachmentNeedsUpdate(leanTo, effectiveLeanTo)) {
        update.push({
          id,
          data: {
            hostKind: effectiveLeanTo.hostKind,
            canopyForm: effectiveLeanTo.canopyForm,
            highSideMode: effectiveLeanTo.highSideMode,
            connectionMode: effectiveLeanTo.connectionMode,
            hostRoofId: effectiveLeanTo.hostRoofId,
            hostRoofSegmentId: effectiveLeanTo.hostRoofSegmentId,
            hostRoofEdge: effectiveLeanTo.hostRoofEdge,
            hostRoofEdgeRange: effectiveLeanTo.hostRoofEdgeRange,
            connectionInset: effectiveLeanTo.connectionInset,
            highEdgeHeight: effectiveLeanTo.highEdgeHeight,
            lowEdgeHeight: effectiveLeanTo.lowEdgeHeight,
            leftEndCondition: effectiveLeanTo.leftEndCondition,
            rightEndCondition: effectiveLeanTo.rightEndCondition,
            downspoutPosition: effectiveLeanTo.downspoutPosition,
            span: effectiveLeanTo.span,
            spanArcCenterZ: effectiveLeanTo.spanArcCenterZ,
            spanArcRadius: effectiveLeanTo.spanArcRadius,
            position: effectiveLeanTo.position,
            rotation: effectiveLeanTo.rotation,
            roofThickness: effectiveLeanTo.roofThickness,
            shingleThickness: effectiveLeanTo.shingleThickness,
            metadata: effectiveLeanTo.metadata,
          } as Partial<AnyNode>,
        })
      }

      if (!roof) {
        const assembly = createManagedLeanToRoofAssembly(effectiveLeanTo, hostRoof, nodes)
        create.push(
          { node: assembly.roof, parentId: leanTo.id },
          { node: assembly.segment, parentId: assembly.roof.id },
          ...(assembly.oppositeSegment
            ? [{ node: assembly.oppositeSegment, parentId: assembly.roof.id }]
            : []),
          { node: assembly.gutter, parentId: assembly.segment.id },
          { node: assembly.downspout, parentId: assembly.segment.id },
          ...(assembly.oppositeGutter && assembly.oppositeSegment
            ? [{ node: assembly.oppositeGutter, parentId: assembly.oppositeSegment.id }]
            : []),
          ...(assembly.oppositeDownspout && assembly.oppositeSegment
            ? [
                {
                  node: assembly.oppositeDownspout,
                  parentId: assembly.oppositeSegment.id,
                },
              ]
            : []),
        )
      } else {
        if (
          hostRoof &&
          effectiveLeanTo.matchHostRoofMaterial !== false &&
          roofNeedsMaterialUpdate(roof, hostRoof)
        ) {
          update.push({
            id: roof.id as AnyNodeId,
            data: leanToRoofMaterialPatch(hostRoof) as Partial<AnyNode>,
          })
        }
        const managedSegments = roof.children
          .map((childId) => nodes[childId as AnyNodeId])
          .filter(
            (child): child is RoofSegmentNode =>
              child?.type === 'roof-segment' &&
              isManagedLeanToNode(child, leanTo.id, 'roof-segment'),
          )
        const segment = managedSegments.find(
          (candidate) => managedLeanToRoofPlane(candidate) === 'primary',
        )
        const oppositeSegment = managedSegments.find(
          (candidate) => managedLeanToRoofPlane(candidate) === 'opposite',
        )
        if (isDualSlopeLeanToCanopy(effectiveLeanTo.canopyForm)) {
          if (!oppositeSegment) {
            const createdOppositeSegment = createManagedLeanToRoofSegment(
              effectiveLeanTo,
              roof.id,
              'opposite',
              nodes,
            )
            create.push({
              node: createdOppositeSegment,
              parentId: roof.id as AnyNodeId,
            })
            if (effectiveLeanTo.canopyForm === 'gable') {
              const pair = createManagedLeanToDrainagePair(
                createdOppositeSegment,
                effectiveLeanTo,
                'opposite',
                nodes,
              )
              create.push(
                { node: pair.gutter, parentId: createdOppositeSegment.id as AnyNodeId },
                { node: pair.downspout, parentId: createdOppositeSegment.id as AnyNodeId },
              )
            }
          } else {
            const oppositePatch = leanToRoofSegmentLayoutPatch(effectiveLeanTo, nodes, 'opposite')
            const expectedOppositeSegment = {
              ...oppositeSegment,
              ...oppositePatch,
            } as RoofSegmentNode
            if (segmentNeedsLayoutUpdate(oppositeSegment, effectiveLeanTo, nodes, 'opposite')) {
              update.push({
                id: oppositeSegment.id as AnyNodeId,
                data: oppositePatch as Partial<AnyNode>,
              })
            }
            const oppositeChildren = oppositeSegment.children.map(
              (childId) => nodes[childId as AnyNodeId],
            )
            const oppositeGutter = oppositeChildren.find(
              (child): child is GutterNode =>
                child?.type === 'gutter' &&
                isManagedLeanToNode(child, leanTo.id, 'gutter') &&
                managedLeanToDrainageSide(child) === 'opposite',
            )
            const oppositeDownspout = oppositeChildren.find(
              (child): child is DownspoutNode =>
                child?.type === 'downspout' &&
                isManagedLeanToNode(child, leanTo.id, 'downspout') &&
                managedLeanToDrainageSide(child) === 'opposite',
            )
            if (effectiveLeanTo.canopyForm === 'gable') {
              if (!oppositeGutter) {
                const pair = createManagedLeanToDrainagePair(
                  expectedOppositeSegment,
                  effectiveLeanTo,
                  'opposite',
                  nodes,
                )
                create.push(
                  { node: pair.gutter, parentId: oppositeSegment.id as AnyNodeId },
                  { node: pair.downspout, parentId: oppositeSegment.id as AnyNodeId },
                )
              } else {
                const gutterPatch = leanToGutterLayoutPatch(
                  expectedOppositeSegment,
                  effectiveLeanTo,
                  oppositeGutter,
                  nodes,
                  'opposite',
                )
                const expectedGutter = { ...oppositeGutter, ...gutterPatch } as GutterNode
                if (
                  gutterNeedsLayoutUpdate(
                    oppositeGutter,
                    expectedOppositeSegment,
                    effectiveLeanTo,
                    nodes,
                    'opposite',
                  )
                ) {
                  update.push({
                    id: oppositeGutter.id as AnyNodeId,
                    data: gutterPatch as Partial<AnyNode>,
                  })
                }
                if (
                  oppositeDownspout &&
                  downspoutNeedsLayoutUpdate(
                    oppositeDownspout,
                    expectedGutter,
                    expectedOppositeSegment,
                    effectiveLeanTo,
                  )
                ) {
                  update.push({
                    id: oppositeDownspout.id as AnyNodeId,
                    data: leanToDownspoutLayoutPatch(
                      expectedOppositeSegment,
                      expectedGutter,
                      effectiveLeanTo,
                      oppositeDownspout,
                    ) as Partial<AnyNode>,
                  })
                }
              }
            } else {
              if (oppositeGutter) remove.push(oppositeGutter.id as AnyNodeId)
              if (oppositeDownspout) remove.push(oppositeDownspout.id as AnyNodeId)
            }
          }
        } else if (oppositeSegment) {
          remove.push(oppositeSegment.id as AnyNodeId)
        }
        if (segment) {
          const segmentPatch = leanToRoofSegmentLayoutPatch(effectiveLeanTo, nodes)
          const expectedSegment = {
            ...segment,
            ...segmentPatch,
          } as RoofSegmentNode
          if (segmentNeedsLayoutUpdate(segment, effectiveLeanTo, nodes)) {
            update.push({
              id: segment.id as AnyNodeId,
              data: segmentPatch as Partial<AnyNode>,
            })
          }
          const managedSegmentChildren = segment.children.map(
            (childId) => nodes[childId as AnyNodeId],
          )
          const gutter = managedSegmentChildren.find(
            (child): child is GutterNode =>
              child?.type === 'gutter' &&
              isManagedLeanToNode(child, leanTo.id, 'gutter') &&
              managedLeanToDrainageSide(child) === 'primary',
          )
          if (gutter) {
            const gutterPatch = leanToGutterLayoutPatch(
              expectedSegment,
              effectiveLeanTo,
              gutter,
              nodes,
            )
            const expectedGutter = { ...gutter, ...gutterPatch } as GutterNode
            if (gutterNeedsLayoutUpdate(gutter, expectedSegment, effectiveLeanTo, nodes)) {
              update.push({
                id: gutter.id as AnyNodeId,
                data: gutterPatch as Partial<AnyNode>,
              })
            }
            const downspout = managedSegmentChildren.find(
              (child): child is DownspoutNode =>
                child?.type === 'downspout' &&
                isManagedLeanToNode(child, leanTo.id, 'downspout') &&
                child.gutterId === gutter.id,
            )
            if (
              downspout &&
              downspoutNeedsLayoutUpdate(
                downspout,
                expectedGutter,
                expectedSegment,
                effectiveLeanTo,
              )
            ) {
              update.push({
                id: downspout.id as AnyNodeId,
                data: leanToDownspoutLayoutPatch(
                  expectedSegment,
                  expectedGutter,
                  effectiveLeanTo,
                  downspout,
                ) as Partial<AnyNode>,
              })
            }
          }

          const oppositeGutter = managedSegmentChildren.find(
            (child): child is GutterNode =>
              child?.type === 'gutter' &&
              isManagedLeanToNode(child, leanTo.id, 'gutter') &&
              managedLeanToDrainageSide(child) === 'opposite',
          )
          const oppositeDownspout = managedSegmentChildren.find(
            (child): child is DownspoutNode =>
              child?.type === 'downspout' &&
              isManagedLeanToNode(child, leanTo.id, 'downspout') &&
              managedLeanToDrainageSide(child) === 'opposite',
          )
          if (oppositeGutter) remove.push(oppositeGutter.id as AnyNodeId)
          if (oppositeDownspout) remove.push(oppositeDownspout.id as AnyNodeId)
        }
      }

      const cornerJoints = resolveLeanToCornerJoints(
        effectiveLeanTo,
        parent?.type === 'wall' ? parent : undefined,
        nodes,
      )
      const canopyJoints = resolveFreestandingCanopyJoints(effectiveLeanTo, nodes)
      const postSides: LeanToPostSide[] =
        effectiveLeanTo.highSideMode === 'independent-high-beam' ? ['low', 'high'] : ['low']
      const desiredPostKeys = new Set<string>()
      for (const side of postSides) {
        for (const index of resolveLeanToCanopyPostIndexes(
          effectiveLeanTo,
          cornerJoints,
          canopyJoints,
          side,
        )) {
          const key = `${side}:${index}`
          desiredPostKeys.add(key)
          const postBaseY = resolveLeanToPostBaseY(
            effectiveLeanTo,
            parent?.type === 'wall' ? parent : undefined,
            nodes,
            index,
            side,
          )
          const current = managedPosts.get(key)
          const gutterSetback =
            side === 'low' ||
            (side === 'high' && isDualSlopeLeanToCanopy(effectiveLeanTo.canopyForm))
              ? resolveLeanToPostGutterSetback(effectiveLeanTo, current)
              : 0
          if (!current) {
            create.push({
              node: {
                ...createManagedLeanToPost(effectiveLeanTo, index, side),
                ...leanToPostLayoutPatch(effectiveLeanTo, index, postBaseY, gutterSetback, side),
              } as ColumnNode,
              parentId: leanTo.id,
            })
          } else if (
            postNeedsLayoutUpdate(current, effectiveLeanTo, index, postBaseY, gutterSetback, side)
          ) {
            // Post rotation is user-owned once placed (the arc yaw is applied
            // only at create time), so the managed sync must not clobber it.
            const { rotation: _rotation, ...postData } = leanToPostLayoutPatch(
              effectiveLeanTo,
              index,
              postBaseY,
              gutterSetback,
              side,
            )
            update.push({
              id: current.id as AnyNodeId,
              data: postData as Partial<AnyNode>,
            })
          }
        }
      }
      for (const joint of Object.values(cornerJoints)) {
        if (!joint?.sharedPostOwner) continue
        const index = leanToCornerPostIndex(joint.side)
        if (isLeanToPostOmitted(effectiveLeanTo, 'low', index)) continue
        const key = `low:${index}`
        desiredPostKeys.add(key)
        const bentCornerPost = bendLocalPoint(
          effectiveLeanTo,
          joint.sharedPostPosition[0],
          joint.sharedPostPosition[2],
        )
        const postBaseY = resolveLeanToPostBaseYAtLocalPosition(
          effectiveLeanTo,
          parent?.type === 'wall' ? parent : undefined,
          nodes,
          [bentCornerPost.x, joint.sharedPostPosition[1], bentCornerPost.y],
        )
        const current = managedPosts.get(key)
        const gutterSetback = resolveLeanToPostGutterSetback(effectiveLeanTo, current)
        const patch = leanToCornerPostLayoutPatch(effectiveLeanTo, joint, postBaseY, gutterSetback)
        if (!current) {
          create.push({
            node: {
              ...createManagedLeanToCornerPost(effectiveLeanTo, joint),
              ...patch,
            } as ColumnNode,
            parentId: leanTo.id,
          })
        } else if (postPatchNeedsLayoutUpdate(current, patch)) {
          update.push({
            id: current.id as AnyNodeId,
            data: patch as Partial<AnyNode>,
          })
        }
      }
      for (const joint of Object.values(canopyJoints)) {
        if (!joint?.sharedPostOwner || cornerJoints[joint.side]) continue
        for (const side of postSides) {
          const index = leanToCornerPostIndex(joint.side)
          if (isLeanToPostOmitted(effectiveLeanTo, side, index)) continue
          const key = `${side}:${index}`
          desiredPostKeys.add(key)
          const current = managedPosts.get(key)
          const gutterSetback = resolveLeanToPostGutterSetback(effectiveLeanTo, current)
          const ungroundedPatch = leanToCanopyCornerPostLayoutPatch(
            effectiveLeanTo,
            joint,
            side,
            0,
            gutterSetback,
          )
          const postBaseY = resolveLeanToPostBaseYAtLocalPosition(
            effectiveLeanTo,
            parent?.type === 'wall' ? parent : undefined,
            nodes,
            ungroundedPatch.position,
          )
          const patch = leanToCanopyCornerPostLayoutPatch(
            effectiveLeanTo,
            joint,
            side,
            postBaseY,
            gutterSetback,
          )
          if (!current) {
            create.push({
              node: {
                ...createManagedLeanToCanopyCornerPost(effectiveLeanTo, joint, side),
                ...patch,
              } as ColumnNode,
              parentId: leanTo.id,
            })
          } else if (postPatchNeedsLayoutUpdate(current, patch)) {
            update.push({
              id: current.id as AnyNodeId,
              data: patch as Partial<AnyNode>,
            })
          }
        }
      }
      for (const [key, post] of managedPosts) {
        if (!desiredPostKeys.has(key)) remove.push(post.id as AnyNodeId)
      }

      if (create.length > 0 || update.length > 0 || remove.length > 0) {
        syncing = true
        sceneApi.pauseHistory()
        try {
          applyChanges({ create, update, delete: remove })
        } finally {
          sceneApi.resumeHistory()
          syncing = false
        }
      }
      signatures.set(id, signature)
    }
  }

  reconcile(leanToIds)
  return subscribeNodes((nodes, previous, changedIds) => {
    if (syncing) return
    for (const id of changedIds) {
      if (nodes[id]?.type === 'lean-to-extension') leanToIds.add(id)
    }
    const affected = affectedLeanToIds(nodes, previous, changedIds, leanToIds)
    if (affected.size > 0) {
      // A scene import can hydrate an extension before its managed roof,
      // segment, and gutter children. Invalidate the cached signature for
      // every dependent change so that a later child batch cannot skip the
      // repair of persisted layout metadata.
      for (const id of affected) signatures.delete(id)
      reconcile(affected)
    }
  })
}

const LeanToExtensionSystem = ({ sceneApi }: { sceneApi: SceneApi }) => {
  useEffect(() => {
    void LEAN_TO_EXTENSION_GEOMETRY_REVISION
    for (const node of Object.values(sceneApi.nodes())) {
      if (node.type === 'lean-to-extension') sceneApi.markDirty(node.id as AnyNodeId)
    }
    return initializeLeanToExtensionSync(sceneApi)
  }, [sceneApi])

  return null
}

export default LeanToExtensionSystem
