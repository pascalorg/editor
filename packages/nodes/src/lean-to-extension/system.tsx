'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type ColumnNode,
  type DownspoutNode,
  type GutterNode,
  type LeanToExtensionNode,
  type RoofNode,
  type RoofSegmentNode,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import {
  createManagedLeanToPost,
  createManagedLeanToRoofAssembly,
  isManagedLeanToNode,
  isManagedLeanToPost,
  leanToDownspoutLayoutPatch,
  leanToGutterLayoutPatch,
  leanToPostLayoutPatch,
  leanToRoofSegmentLayoutPatch,
  managedLeanToPostIndex,
} from './assembly'

function sameTuple(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function postNeedsLayoutUpdate(post: ColumnNode, leanTo: LeanToExtensionNode, index: number) {
  const expected = leanToPostLayoutPatch(leanTo, index)
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
    segment.overhang !== expected.overhang ||
    JSON.stringify(segment.trim) !== JSON.stringify(expected.trim)
  )
}

function gutterNeedsLayoutUpdate(gutter: GutterNode, segment: RoofSegmentNode) {
  const expected = leanToGutterLayoutPatch(segment)
  return (
    !sameTuple(gutter.position, expected.position) ||
    gutter.rotation !== expected.rotation ||
    gutter.length !== expected.length ||
    gutter.roofSegmentId !== expected.roofSegmentId
  )
}

function downspoutNeedsLayoutUpdate(
  downspout: DownspoutNode,
  gutter: GutterNode,
  segment: RoofSegmentNode,
) {
  const expected = leanToDownspoutLayoutPatch(segment, gutter)
  return (
    downspout.length !== expected.length ||
    downspout.diameter !== expected.diameter ||
    downspout.gutterId !== expected.gutterId
  )
}

function extensionSignature(leanTo: LeanToExtensionNode): string {
  return JSON.stringify([
    leanTo.span,
    leanTo.projection,
    leanTo.highEdgeHeight,
    leanTo.pitch,
    leanTo.roofThickness,
    leanTo.eaveOverhang,
    leanTo.sideOverhang,
    leanTo.beamHeight,
    leanTo.rafterHeight,
    leanTo.postWidth,
    leanTo.postDepth,
    leanTo.postCount,
    leanTo.postInset,
    leanTo.children,
  ])
}

const LeanToExtensionSystem = () => {
  const signaturesRef = useRef(new Map<AnyNodeId, string>())

  useFrame(() => {
    const scene = useScene.getState()
    const signatures = signaturesRef.current
    const liveIds = new Set<AnyNodeId>()

    for (const rawId of sceneRegistry.byType['lean-to-extension'] ?? []) {
      const id = rawId as AnyNodeId
      const leanTo = scene.nodes[id]
      if (leanTo?.type !== 'lean-to-extension') continue
      liveIds.add(id)
      const signature = extensionSignature(leanTo)
      if (signatures.get(id) === signature) continue

      const managedByIndex = new Map<number, ColumnNode>()
      const duplicateIds: AnyNodeId[] = []
      let roof: RoofNode | undefined
      for (const childId of leanTo.children) {
        const child = scene.nodes[childId as AnyNodeId]
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

      if (!roof) {
        const assembly = createManagedLeanToRoofAssembly(leanTo)
        create.push(
          { node: assembly.roof, parentId: leanTo.id },
          { node: assembly.segment, parentId: assembly.roof.id },
          { node: assembly.gutter, parentId: assembly.segment.id },
          { node: assembly.downspout, parentId: assembly.segment.id },
        )
      } else {
        const segment = roof.children
          .map((childId) => scene.nodes[childId as AnyNodeId])
          .find(
            (child): child is RoofSegmentNode =>
              child?.type === 'roof-segment' &&
              isManagedLeanToNode(child, leanTo.id, 'roof-segment'),
          )
        if (segment) {
          const segmentPatch = leanToRoofSegmentLayoutPatch(leanTo)
          const expectedSegment = { ...segment, ...segmentPatch } as RoofSegmentNode
          if (segmentNeedsLayoutUpdate(segment, leanTo)) {
            update.push({
              id: segment.id as AnyNodeId,
              data: segmentPatch as Partial<AnyNode>,
            })
          }
          const gutter = segment.children
            .map((childId) => scene.nodes[childId as AnyNodeId])
            .find(
              (child): child is GutterNode =>
                child?.type === 'gutter' && isManagedLeanToNode(child, leanTo.id, 'gutter'),
            )
          if (gutter) {
            const gutterPatch = leanToGutterLayoutPatch(expectedSegment)
            const expectedGutter = { ...gutter, ...gutterPatch } as GutterNode
            if (gutterNeedsLayoutUpdate(gutter, expectedSegment)) {
              update.push({
                id: gutter.id as AnyNodeId,
                data: gutterPatch as Partial<AnyNode>,
              })
            }
            const downspout = segment.children
              .map((childId) => scene.nodes[childId as AnyNodeId])
              .find(
                (child): child is DownspoutNode =>
                  child?.type === 'downspout' && isManagedLeanToNode(child, leanTo.id, 'downspout'),
              )
            if (
              downspout &&
              downspoutNeedsLayoutUpdate(downspout, expectedGutter, expectedSegment)
            ) {
              update.push({
                id: downspout.id as AnyNodeId,
                data: leanToDownspoutLayoutPatch(
                  expectedSegment,
                  expectedGutter,
                ) as Partial<AnyNode>,
              })
            }
          }
        }
      }

      for (let index = 0; index < leanTo.postCount; index++) {
        const current = managedByIndex.get(index)
        if (!current) {
          create.push({ node: createManagedLeanToPost(leanTo, index), parentId: leanTo.id })
        } else if (postNeedsLayoutUpdate(current, leanTo, index)) {
          update.push({
            id: current.id as AnyNodeId,
            data: leanToPostLayoutPatch(leanTo, index) as Partial<AnyNode>,
          })
        }
      }
      for (const [index, post] of managedByIndex) {
        if (index >= leanTo.postCount) remove.push(post.id as AnyNodeId)
      }

      if (create.length > 0 || update.length > 0 || remove.length > 0) {
        const temporal = useScene.temporal.getState()
        const wasTracking = (temporal as { isTracking?: boolean }).isTracking !== false
        if (wasTracking) temporal.pause()
        scene.applyNodeChanges({ create, update, delete: remove })
        if (wasTracking) temporal.resume()
      }
      signatures.set(id, signature)
    }

    for (const id of signatures.keys()) {
      if (!liveIds.has(id)) signatures.delete(id)
    }
  })

  return null
}

export default LeanToExtensionSystem
