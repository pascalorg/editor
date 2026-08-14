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
import {
  createManagedLeanToPost,
  createManagedLeanToRoofAssembly,
  isManagedLeanToNode,
  isManagedLeanToPost,
  type LeanToPostSide,
  leanToDownspoutLayoutPatch,
  leanToGutterLayoutPatch,
  leanToPostLayoutPatch,
  leanToRoofMaterialPatch,
  leanToRoofSegmentLayoutPatch,
  managedLeanToPostIndex,
  managedLeanToPostSide,
  resolveLeanToPostBaseY,
  resolveLeanToPostGutterSetback,
} from './assembly'
import { LEAN_TO_EXTENSION_GEOMETRY_REVISION, resolveLeanToLayout } from './layout'
import { resolveLeanToEndAbutments } from './placement-validation'
import {
  applyLeanToRoofAttachment,
  applyLeanToWallAutoSpan,
  clearLeanToRoofAttachment,
  resolveLeanToHostRoof,
  resolveLeanToRoofAttachment,
} from './roof-attachment'

const ROOF_EDGE_REATTACH_TOLERANCE = 0.3
const BROAD_LEAN_TO_DEPENDENCY_TYPES = new Set<AnyNode['type']>([
  'site',
  'building',
  'level',
  'slab',
  'wall',
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
  return (
    !sameTuple(post.position, expected.position) ||
    post.rotation !== expected.rotation ||
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

function segmentNeedsLayoutUpdate(segment: RoofSegmentNode, leanTo: LeanToExtensionNode) {
  const expected = leanToRoofSegmentLayoutPatch(leanTo)
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
    JSON.stringify(segment.trim) !== JSON.stringify(expected.trim)
  )
}

function gutterNeedsLayoutUpdate(
  gutter: GutterNode,
  segment: RoofSegmentNode,
  leanTo: LeanToExtensionNode,
) {
  const expected = leanToGutterLayoutPatch(segment, leanTo, gutter)
  return (
    !sameTuple(gutter.position, expected.position) ||
    gutter.rotation !== expected.rotation ||
    gutter.length !== expected.length ||
    gutter.roofSegmentId !== expected.roofSegmentId ||
    gutter.visible !== expected.visible ||
    gutter.profile !== expected.profile ||
    gutter.size !== expected.size ||
    JSON.stringify(gutter.outlets) !== JSON.stringify(expected.outlets)
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

function extensionSignature(
  leanTo: LeanToExtensionNode,
  hostRoof: RoofNode | undefined,
  nodes: Record<AnyNodeId, AnyNode>,
): string {
  return JSON.stringify([
    leanTo.span,
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
    leanTo.postBracing,
    leanTo.footingStyle,
    leanTo.highSideMode,
    leanTo.ledgerVisible,
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
    leanTo.children,
    leanTo.children.map((childId) => {
      const child = nodes[childId as AnyNodeId]
      return child?.type === 'column' ? child : null
    }),
  ])
}

function attachmentNeedsUpdate(current: LeanToExtensionNode, next: LeanToExtensionNode): boolean {
  return (
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
    !sameTuple(current.position, next.position) ||
    current.roofThickness !== next.roofThickness ||
    current.shingleThickness !== next.shingleThickness
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
  const parent = leanTo.parentId ? nodes[leanTo.parentId as AnyNodeId] : undefined
  if (parent?.type !== 'wall') {
    return leanTo.connectionMode === 'manual' ? leanTo : clearLeanToRoofAttachment(leanTo)
  }
  const wall = parent as WallNode
  const wallSpanningLeanTo = applyLeanToWallAutoSpan(leanTo, wall)
  const retained =
    leanTo.hostRoofSegmentId && leanTo.hostRoofEdge
      ? resolveLeanToRoofAttachment(wallSpanningLeanTo, wall, nodes, {
          roofSegmentId: leanTo.hostRoofSegmentId,
          edge: leanTo.hostRoofEdge,
        })
      : null
  const attachment = retained ?? resolveLeanToRoofAttachment(wallSpanningLeanTo, wall, nodes)
  const resolved =
    leanTo.connectionMode === 'manual'
      ? attachment &&
        Math.abs(attachment.highEdgeHeight - leanTo.highEdgeHeight) <= ROOF_EDGE_REATTACH_TOLERANCE
        ? applyLeanToRoofAttachment(leanTo, attachment)
        : wallSpanningLeanTo
      : attachment
        ? applyLeanToRoofAttachment(leanTo, attachment)
        : clearLeanToRoofAttachment(wallSpanningLeanTo)
  return resolveLeanToEndAbutments(resolved, wall, nodes)
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
            position: effectiveLeanTo.position,
            roofThickness: effectiveLeanTo.roofThickness,
            shingleThickness: effectiveLeanTo.shingleThickness,
          } as Partial<AnyNode>,
        })
      }

      if (!roof) {
        const assembly = createManagedLeanToRoofAssembly(effectiveLeanTo, hostRoof)
        create.push(
          { node: assembly.roof, parentId: leanTo.id },
          { node: assembly.segment, parentId: assembly.roof.id },
          { node: assembly.gutter, parentId: assembly.segment.id },
          { node: assembly.downspout, parentId: assembly.segment.id },
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
        const segment = roof.children
          .map((childId) => nodes[childId as AnyNodeId])
          .find(
            (child): child is RoofSegmentNode =>
              child?.type === 'roof-segment' &&
              isManagedLeanToNode(child, leanTo.id, 'roof-segment'),
          )
        if (segment) {
          const segmentPatch = leanToRoofSegmentLayoutPatch(effectiveLeanTo)
          const expectedSegment = {
            ...segment,
            ...segmentPatch,
          } as RoofSegmentNode
          if (segmentNeedsLayoutUpdate(segment, effectiveLeanTo)) {
            update.push({
              id: segment.id as AnyNodeId,
              data: segmentPatch as Partial<AnyNode>,
            })
          }
          const gutter = segment.children
            .map((childId) => nodes[childId as AnyNodeId])
            .find(
              (child): child is GutterNode =>
                child?.type === 'gutter' && isManagedLeanToNode(child, leanTo.id, 'gutter'),
            )
          if (gutter) {
            const gutterPatch = leanToGutterLayoutPatch(expectedSegment, effectiveLeanTo, gutter)
            const expectedGutter = { ...gutter, ...gutterPatch } as GutterNode
            if (gutterNeedsLayoutUpdate(gutter, expectedSegment, effectiveLeanTo)) {
              update.push({
                id: gutter.id as AnyNodeId,
                data: gutterPatch as Partial<AnyNode>,
              })
            }
            const downspout = segment.children
              .map((childId) => nodes[childId as AnyNodeId])
              .find(
                (child): child is DownspoutNode =>
                  child?.type === 'downspout' && isManagedLeanToNode(child, leanTo.id, 'downspout'),
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
        }
      }

      const resolvedPostCount = resolveLeanToLayout(effectiveLeanTo).postXs.length
      const postSides: LeanToPostSide[] =
        effectiveLeanTo.highSideMode === 'independent-high-beam' ? ['low', 'high'] : ['low']
      const desiredPostKeys = new Set<string>()
      for (const side of postSides) {
        for (let index = 0; index < resolvedPostCount; index++) {
          const key = `${side}:${index}`
          desiredPostKeys.add(key)
          const postBaseY =
            parent?.type === 'wall'
              ? resolveLeanToPostBaseY(effectiveLeanTo, parent, nodes, index, side)
              : 0
          const current = managedPosts.get(key)
          const gutterSetback =
            side === 'low' ? resolveLeanToPostGutterSetback(effectiveLeanTo, current) : 0
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
            update.push({
              id: current.id as AnyNodeId,
              data: leanToPostLayoutPatch(
                effectiveLeanTo,
                index,
                postBaseY,
                gutterSetback,
                side,
              ) as Partial<AnyNode>,
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
    if (affected.size > 0) reconcile(affected)
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
