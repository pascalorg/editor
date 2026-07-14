'use client'

import {
  type AnyNode,
  type AnyNodeId,
  AnyNode as AnyNodeSchema,
  MeasurementNode,
  nodeRegistry,
  useScene,
} from '@pascal-app/core'
import { useEffect } from 'react'
import { type MeasurementSegment, useMeasurementTool } from '../store/use-measurement-tool'

function measurementSceneParentId(
  segment: MeasurementSegment,
  nodes: Readonly<Record<string, AnyNode>>,
): AnyNodeId | null {
  for (const attachment of [segment.startAttachment, segment.endAttachment]) {
    if (attachment?.ownerNodeId && nodes[attachment.ownerNodeId]) {
      return attachment.ownerNodeId as AnyNodeId
    }
    if (attachment && nodes[attachment.nodeId]) return attachment.nodeId as AnyNodeId
  }
  return null
}

function appendMeasurementSceneChild(parent: AnyNode, id: AnyNodeId): AnyNode {
  const currentChildren = (parent as { children?: unknown }).children
  const children = Array.isArray(currentChildren) ? currentChildren : []
  const candidate = {
    ...parent,
    children: Array.from(new Set([...children, id])),
  }

  const schema = nodeRegistry.get(parent.type)?.schema ?? AnyNodeSchema
  return schema.safeParse(candidate).success ? (candidate as AnyNode) : parent
}

export function syncLinearMeasurementSceneNodes(segments: ReadonlyArray<MeasurementSegment>) {
  useScene.setState((state) => {
    const existing = Object.values(state.nodes).filter(
      (node): node is Extract<AnyNode, { type: 'measurement' }> => node.type === 'measurement',
    )
    const existingIds = new Set<string>(existing.map((node) => node.id))
    const existingByMeasurementId = new Map(existing.map((node) => [node.measurementId, node]))
    const nodes = Object.fromEntries(
      Object.entries(state.nodes)
        .filter(([id]) => !existingIds.has(id as AnyNodeId))
        .map(([id, node]) => {
          const children = (node as { children?: unknown }).children
          if (!Array.isArray(children)) return [id, node]
          return [
            id,
            { ...node, children: children.filter((childId) => !existingIds.has(childId)) },
          ]
        }),
    ) as Record<AnyNodeId, AnyNode>
    const rootNodeIds = state.rootNodeIds.filter((id) => !existingIds.has(id))

    for (const segment of segments) {
      const parentId = measurementSceneParentId(segment, nodes)
      const id = `measurement_${segment.id}` as AnyNodeId
      nodes[id] = MeasurementNode.parse({
        ...existingByMeasurementId.get(segment.id),
        end: segment.end,
        endAttachment: segment.endAttachment,
        id,
        measuredDistanceMeters: segment.measuredDistanceMeters,
        measurementId: segment.id,
        parentId,
        start: segment.start,
        startAttachment: segment.startAttachment,
        view: segment.view,
      })

      if (!parentId) {
        rootNodeIds.push(id)
        continue
      }
      const parent = nodes[parentId]
      if (parent) {
        nodes[parentId] = appendMeasurementSceneChild(parent, id)
      }
    }

    return { nodes, rootNodeIds }
  })
}

export function MeasurementSceneGraphSync() {
  const segments = useMeasurementTool((state) => state.segments)
  const draggingSegmentEndpoint = useMeasurementTool((state) => state.draggingSegmentEndpoint)

  useEffect(() => {
    if (draggingSegmentEndpoint) return
    syncLinearMeasurementSceneNodes(segments)
  }, [draggingSegmentEndpoint, segments])

  useEffect(() => () => syncLinearMeasurementSceneNodes([]), [])

  return null
}
