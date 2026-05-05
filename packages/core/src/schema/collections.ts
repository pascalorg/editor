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
