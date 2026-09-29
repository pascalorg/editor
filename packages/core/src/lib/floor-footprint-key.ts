import { generateId } from '../schema/base'

export function mintFloorFootprintKey(creatorId?: string): string {
  // A room can create another floor while other rooms still use its previous key.
  const key = generateId('floor')
  return creatorId ? `${key}:${creatorId}` : key
}

export function floorFootprintCreatorId(key: string): string | undefined {
  return /^floor_[^:]+:(zone_.+)$/.exec(key)?.[1]
}
