import { generateId } from './base'
import type { AnyNodeId } from './types'

export type CollectionId = `collection_${string}`

export type Collection = {
  id: CollectionId
  name: string
  color?: string
  nodeIds: AnyNodeId[]
  controlNodeId?: AnyNodeId
}

export const generateCollectionId = (): CollectionId => generateId('collection')

export const getCollectionAttachmentNodeCollectionId = (node: unknown): CollectionId | null => {
  if (!(node && typeof node === 'object')) {
    return null
  }

  const collectionId = (node as { collectionId?: unknown }).collectionId
  const resources = (node as { resources?: unknown }).resources
  return typeof collectionId === 'string' && Array.isArray(resources)
    ? (collectionId as CollectionId)
    : null
}

export const normalizeCollection = (collection: Collection): Collection => {
  const nodeIds = Array.from(
    new Set(collection.nodeIds.filter((nodeId): nodeId is AnyNodeId => typeof nodeId === 'string')),
  )

  return {
    ...collection,
    controlNodeId:
      typeof collection.controlNodeId === 'string' && nodeIds.includes(collection.controlNodeId)
        ? collection.controlNodeId
        : nodeIds[0],
    nodeIds,
  }
}
