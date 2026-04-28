'use client'

import {
  type AnyNodeId,
  generateId,
  type RoofNode,
  RoofNode as RoofNodeSchema,
  type RoofSegmentNode,
  RoofSegmentNode as RoofSegmentNodeSchema,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import useEditor from '../store/use-editor'

type DuplicateRoofMode = 'select' | 'move'

type DuplicateRoofOptions = {
  mode?: DuplicateRoofMode
  offset?: [number, number, number]
  parentId?: AnyNodeId
}

type DuplicateRoofResult = {
  roof: RoofNode
  segmentIds: RoofSegmentNode['id'][]
}

const MOVE_REGISTRY_RETRY_LIMIT = 12

function stripDuplicateFlags(metadata: unknown) {
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
    return metadata
  }

  const nextMeta = { ...(metadata as Record<string, unknown>) }
  delete nextMeta.isNew
  delete nextMeta.isTransient
  return nextMeta
}

function buildDuplicateMetadata(metadata: unknown) {
  const cleaned = stripDuplicateFlags(metadata)
  if (typeof cleaned !== 'object' || cleaned === null || Array.isArray(cleaned)) {
    return { isNew: true }
  }

  return {
    ...cleaned,
    isNew: true,
  }
}

function moveRoofWhenRegistered(roofId: RoofNode['id'], attempt = 0) {
  const latestRoof = useScene.getState().nodes[roofId as AnyNodeId]
  if (latestRoof?.type !== 'roof') {
    return
  }

  if (sceneRegistry.nodes.has(roofId)) {
    useEditor.getState().setMovingNode(latestRoof)
    useViewer.getState().setSelection({ selectedIds: [] })
    return
  }

  if (attempt >= MOVE_REGISTRY_RETRY_LIMIT) {
    console.warn(`Duplicated roof "${roofId}" did not register before move mode started`)
    return
  }

  requestAnimationFrame(() => moveRoofWhenRegistered(roofId, attempt + 1))
}

export function duplicateRoofSubtree(
  sourceRoofId: AnyNodeId,
  options: DuplicateRoofOptions = {},
): DuplicateRoofResult {
  const { mode = 'move', offset = [1, 0, 1], parentId: explicitParentId } = options

  const scene = useScene.getState()
  const sourceRoof = scene.nodes[sourceRoofId]

  if (!sourceRoof || sourceRoof.type !== 'roof') {
    throw new Error(`Node "${sourceRoofId}" is not a roof`)
  }

  const parentId = explicitParentId ?? (sourceRoof.parentId as AnyNodeId | null)
  if (!parentId) {
    throw new Error(`Roof "${sourceRoofId}" is missing a parent level`)
  }

  const roofClone = RoofNodeSchema.parse({
    ...structuredClone(sourceRoof),
    id: generateId('roof'),
    parentId,
    children: [],
    position: [
      sourceRoof.position[0] + offset[0],
      sourceRoof.position[1] + offset[1],
      sourceRoof.position[2] + offset[2],
    ] as RoofNode['position'],
    metadata: buildDuplicateMetadata(sourceRoof.metadata),
  })

  const segmentClones: RoofSegmentNode[] = []
  for (const childId of sourceRoof.children ?? []) {
    const childNode = scene.nodes[childId as AnyNodeId]
    if (!childNode || childNode.type !== 'roof-segment') {
      continue
    }

    const childClone = RoofSegmentNodeSchema.parse({
      ...structuredClone(childNode),
      id: generateId('rseg'),
      parentId: roofClone.id,
      metadata: buildDuplicateMetadata(childNode.metadata),
    })
    segmentClones.push(childClone)
  }

  scene.createNodes([
    { node: roofClone, parentId },
    ...segmentClones.map((segment) => ({ node: segment, parentId: roofClone.id as AnyNodeId })),
  ])

  const nextScene = useScene.getState()
  const createdRoof = nextScene.nodes[roofClone.id as AnyNodeId]
  if (!createdRoof || createdRoof.type !== 'roof') {
    throw new Error(`Duplicated roof "${roofClone.id}" was not created`)
  }

  const createdParent = nextScene.nodes[parentId]
  const parentChildIds =
    createdParent && 'children' in createdParent && Array.isArray(createdParent.children)
      ? (createdParent.children as AnyNodeId[])
      : null
  if (!createdParent || !parentChildIds?.includes(createdRoof.id as AnyNodeId)) {
    throw new Error(`Duplicated roof "${createdRoof.id}" was not linked to parent "${parentId}"`)
  }

  const segmentIds = segmentClones.map((segment) => segment.id)
  const createdChildIds = (createdRoof.children ?? []) as AnyNodeId[]
  const missingSegmentId = segmentIds.find(
    (segmentId) => !createdChildIds.includes(segmentId as AnyNodeId),
  )
  if (missingSegmentId) {
    throw new Error(
      `Duplicated roof "${createdRoof.id}" is missing cloned segment "${missingSegmentId}"`,
    )
  }

  const invalidSegment = segmentIds.find((segmentId) => {
    const segment = nextScene.nodes[segmentId as AnyNodeId]
    return !segment || segment.type !== 'roof-segment' || segment.parentId !== createdRoof.id
  })
  if (invalidSegment) {
    throw new Error(
      `Duplicated roof segment "${invalidSegment}" was not linked to roof "${createdRoof.id}"`,
    )
  }

  const setSelection = useViewer.getState().setSelection
  if (mode === 'select') {
    setSelection({ selectedIds: [createdRoof.id] })
  } else {
    setSelection({ selectedIds: [createdRoof.id] })
    requestAnimationFrame(() => moveRoofWhenRegistered(createdRoof.id))
  }

  return {
    roof: createdRoof,
    segmentIds,
  }
}

export function clearRoofDuplicateMetadata(
  roofId: AnyNodeId,
  updates: Partial<Pick<RoofNode, 'position' | 'rotation' | 'metadata'>> = {},
) {
  const scene = useScene.getState()
  const roofNode = scene.nodes[roofId]
  if (!roofNode || roofNode.type !== 'roof') {
    return
  }

  const nodeUpdates: { id: AnyNodeId; data: Record<string, unknown> }[] = [
    {
      id: roofId,
      data: {
        ...updates,
        metadata:
          updates.metadata !== undefined
            ? stripDuplicateFlags(updates.metadata)
            : stripDuplicateFlags(roofNode.metadata),
      },
    },
  ]

  for (const childId of roofNode.children ?? []) {
    const childNode = scene.nodes[childId as AnyNodeId]
    if (!childNode || childNode.type !== 'roof-segment') {
      continue
    }

    nodeUpdates.push({
      id: childNode.id as AnyNodeId,
      data: {
        metadata: stripDuplicateFlags(childNode.metadata),
      },
    })
  }

  scene.updateNodes(nodeUpdates as { id: AnyNodeId; data: Partial<RoofNode | RoofSegmentNode> }[])
}
