import { generateId } from './base'
import type { CollectionTemplateId } from './collection-templates'
import type { AnyNodeId } from './types'

export type CollectionId = `collection_${string}`

/**
 * A named set of scene elements of any kind. Membership is the `nodeIds` list; items mirror it in
 * their `collectionIds`. Being in a collection says nothing about how elements connect.
 */
export type Collection = {
  id: CollectionId
  name: string
  color?: string
  nodeIds: AnyNodeId[]
  controlNodeId?: AnyNodeId
  /** The template it was made from; asking for a template again finds this collection. */
  template?: CollectionTemplateId
}

export const generateCollectionId = (): CollectionId => generateId('collection')
