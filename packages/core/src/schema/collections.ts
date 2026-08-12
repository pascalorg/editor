import { generateId } from './base'
import type { AnyNodeId } from './types'

export type CollectionId = `collection_${string}`

export type Collection = {
  id: CollectionId
  name: string
  color?: string
  nodeIds: AnyNodeId[]
  controlNodeId?: AnyNodeId
  /**
   * Hidden collections take their members out of the view without touching each
   * node's own `visible`, so unhiding restores exactly what was there before.
   *
   * Optional rather than defaulted so scenes saved before this existed load
   * unchanged — absent reads as visible.
   */
  visible?: boolean
  /** Locked members cannot be selected, moved, or deleted. Absent reads as unlocked. */
  locked?: boolean
}

export const generateCollectionId = (): CollectionId => generateId('collection')
