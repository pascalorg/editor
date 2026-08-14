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
  leanToDownspoutLayoutPatch,
  leanToGutterLayoutPatch,
  leanToPostLayoutPatch,
  leanToRoofMaterialPatch,
  leanToRoofSegmentLayoutPatch,
  managedLeanToPostIndex,
  resolveLeanToPostBaseY,
  resolveLeanToPostGutterSetback,
} from './assembly'
import { LEAN_TO_EXTENSION_GEOMETRY_REVISION } from './layout'
import {
  applyLeanToRoofAttachment,
  applyLeanToWallAutoSpan,
  clearLeanToRoofAttachment,
  resolveLeanToHostRoof,
  resolveLeanToRoofAttachment,
} from './roof-attachment'

const ROOF_EDGE_REATTACH_TOLERANCE = 0.3

function sameTuple(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function postNeedsLayoutUpdate(
  post: ColumnNode,
  leanTo: LeanToExtensionNode,
  index: number,
  baseY: number,
  gutterSetback: number,
) {
  const expected = leanToPostLayoutPatch(leanTo, index, baseY, gutterSetback)
  return (
    !sameTuple(post.position, expected.position) ||
    post.rotation !== expected.rotation ||
    post.height !== expected.height ||
    post.width !== expected.width ||
    post.depth !== expected.depth ||
    post.crossSection !== expected.crossSection
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
  const expected = leanToDownspoutLayoutPatch(segment, gutter, leanTo)
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
    leanTo.pitch,
    leanTo.roofThickness,
    leanTo.shingleThickness,
    leanTo.eaveOverhang,
    leanTo.sideOverhang,
    leanTo.beamHeight,
    leanTo.rafterHeight,
    leanTo.postWidth,
    leanTo.postDepth,
    leanTo.postCount,
    leanTo.postInset,
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
  if (leanTo.connectionMode === 'manual') {
    return attachment &&
      Math.abs(attachment.highEdgeHeight - leanTo.highEdgeHeight) <= ROOF_EDGE_REATTACH_TOLERANCE
      ? applyLeanToRoofAttachment(leanTo, attachment)
      : wallSpanningLeanTo
  }
  return attachment
    ? applyLeanToRoofAttachment(leanTo, attachment)
    : clearLeanToRoofAttachment(wallSpanningLeanTo)
}

export function initializeLeanToExtensionSync(sceneApi: SceneApi) {
  const signatures = new Map<AnyNodeId, string>()
  let syncing = false
  const reconcile = () => {
    const nodes = sceneApi.nodes() as Record<AnyNodeId, AnyNode>
    const liveIds = new Set<AnyNodeId>()

    for (const candidate of Object.values(nodes)) {
      if (candidate.type !== 'lean-to-extension') continue
      const leanTo = candidate
      const id = leanTo.id as AnyNodeId
      liveIds.add(id)
      const effectiveLeanTo = resolveEffectiveLeanTo(leanTo, nodes)
      const parent = leanTo.parentId ? nodes[leanTo.parentId as AnyNodeId] : undefined
      const hostRoof = resolveLeanToHostRoof(effectiveLeanTo, nodes)
      const signature = extensionSignature(effectiveLeanTo, hostRoof, nodes)
      if (signatures.get(id) === signature) continue

      const managedByIndex = new Map<number, ColumnNode>()
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
        if (index === null || managedByIndex.has(index)) {
          duplicateIds.push(child.id as AnyNodeId)
        } else {
          managedByIndex.set(index, child)
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
                ) as Partial<AnyNode>,
              })
            }
          }
        }
      }

      for (let index = 0; index < effectiveLeanTo.postCount; index++) {
        const postBaseY =
          parent?.type === 'wall'
            ? resolveLeanToPostBaseY(effectiveLeanTo, parent, nodes, index)
            : 0
        const current = managedByIndex.get(index)
        const gutterSetback = resolveLeanToPostGutterSetback(effectiveLeanTo, current)
        if (!current) {
          create.push({
            node: {
              ...createManagedLeanToPost(effectiveLeanTo, index),
              ...leanToPostLayoutPatch(effectiveLeanTo, index, postBaseY, gutterSetback),
            } as ColumnNode,
            parentId: leanTo.id,
          })
        } else if (
          postNeedsLayoutUpdate(current, effectiveLeanTo, index, postBaseY, gutterSetback)
        ) {
          update.push({
            id: current.id as AnyNodeId,
            data: leanToPostLayoutPatch(
              effectiveLeanTo,
              index,
              postBaseY,
              gutterSetback,
            ) as Partial<AnyNode>,
          })
        }
      }
      for (const [index, post] of managedByIndex) {
        if (index >= effectiveLeanTo.postCount) remove.push(post.id as AnyNodeId)
      }

      if (create.length > 0 || update.length > 0 || remove.length > 0) {
        syncing = true
        sceneApi.pauseHistory()
        try {
          sceneApi.applyChanges?.({ create, update, delete: remove })
        } finally {
          sceneApi.resumeHistory()
          syncing = false
        }
      }
      signatures.set(id, signature)
    }

    for (const id of signatures.keys()) {
      if (!liveIds.has(id)) signatures.delete(id)
    }
  }

  reconcile()
  return (
    sceneApi.subscribeNodes?.(() => {
      if (!syncing) reconcile()
    }) ?? (() => {})
  )
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
