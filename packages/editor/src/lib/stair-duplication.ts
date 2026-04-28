import {
  generateId,
  type AnyNodeId,
  sceneRegistry,
  type StairNode,
  StairNode as StairNodeSchema,
  type StairSegmentNode,
  StairSegmentNode as StairSegmentNodeSchema,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import useEditor from '../store/use-editor'

type DuplicateStairOptions = {
  mode?: 'select' | 'move'
  offset?: [number, number, number]
  parentId?: AnyNodeId
}

type DuplicateStairResult = {
  stair: StairNode
  segmentIds: StairSegmentNode['id'][]
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

function moveStairWhenRegistered(stairId: StairNode['id'], attempt = 0) {
  const latestStair = useScene.getState().nodes[stairId as AnyNodeId]
  if (!latestStair || latestStair.type !== 'stair') {
    return
  }

  if (sceneRegistry.nodes.has(stairId)) {
    useEditor.getState().setMovingNode(latestStair)
    useViewer.getState().setSelection({ selectedIds: [] })
    return
  }

  if (attempt >= MOVE_REGISTRY_RETRY_LIMIT) {
    console.warn(`Duplicated stair "${stairId}" did not register before move mode started`)
    return
  }

  requestAnimationFrame(() => moveStairWhenRegistered(stairId, attempt + 1))
}

export function duplicateStairSubtree(
  sourceStairId: AnyNodeId,
  options: DuplicateStairOptions = {},
): DuplicateStairResult {
  const { mode = 'move', offset = [1, 0, 1], parentId: explicitParentId } = options

  const scene = useScene.getState()
  const sourceStair = scene.nodes[sourceStairId]

  if (!sourceStair || sourceStair.type !== 'stair') {
    throw new Error(`Node "${sourceStairId}" is not a stair`)
  }

  const parentId = explicitParentId ?? (sourceStair.parentId as AnyNodeId | null)
  if (!parentId) {
    throw new Error(`Stair "${sourceStairId}" is missing a parent level`)
  }

  const stairClone = StairNodeSchema.parse({
    ...structuredClone(sourceStair),
    id: generateId('stair'),
    parentId,
    children: [],
    position: [
      sourceStair.position[0] + offset[0],
      sourceStair.position[1] + offset[1],
      sourceStair.position[2] + offset[2],
    ] as StairNode['position'],
    metadata: stripDuplicateFlags(sourceStair.metadata),
  })

  const segmentClones: StairSegmentNode[] = []
  for (const childId of sourceStair.children ?? []) {
    const childNode = scene.nodes[childId as AnyNodeId]
    if (!childNode || childNode.type !== 'stair-segment') {
      continue
    }

    const childClone = StairSegmentNodeSchema.parse({
      ...structuredClone(childNode),
      id: generateId('sseg'),
      parentId: stairClone.id,
      metadata: stripDuplicateFlags(childNode.metadata),
    })
    segmentClones.push(childClone)
  }

  scene.createNodes([
    { node: stairClone, parentId },
    ...segmentClones.map((segment) => ({ node: segment, parentId: stairClone.id as AnyNodeId })),
  ])

  const createdStair = useScene.getState().nodes[stairClone.id as AnyNodeId]
  if (!createdStair || createdStair.type !== 'stair') {
    throw new Error(`Duplicated stair "${stairClone.id}" was not created`)
  }

  if (mode === 'select') {
    useViewer.getState().setSelection({ selectedIds: [createdStair.id] })
  } else {
    useViewer.getState().setSelection({ selectedIds: [createdStair.id] })
    requestAnimationFrame(() => moveStairWhenRegistered(createdStair.id))
  }

  return {
    stair: createdStair,
    segmentIds: segmentClones.map((segment) => segment.id),
  }
}
