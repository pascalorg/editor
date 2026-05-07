import { describe, expect, test } from 'bun:test'
import type { AnyNodeId, CollectionId } from '@pascal-app/core'
import { getLegacySmartHomeRoomControlTileId, getSmartHomeRoomControlTileId } from '../smart-home-composition'
import { buildRoomControlGroups, type RoomControlTile } from './room-control-model'

const collectionId = 'collection_master' as CollectionId
const resourceId = 'light.mbrl2'

const tile: RoomControlTile = {
  collectionId,
  collectionLabel: 'Recessed Light',
  control: { kind: 'toggle', label: 'Power' },
  controlIndex: 0,
  disabled: false,
  id: getSmartHomeRoomControlTileId(collectionId, resourceId),
  intensityControl: null,
  intensityControlIndex: null,
  itemId: 'item_mbrl2' as AnyNodeId,
  itemKind: 'light',
  itemName: 'MbrL2',
  legacyIds: [getLegacySmartHomeRoomControlTileId(collectionId, resourceId)],
  resourceId,
}

describe('buildRoomControlGroups', () => {
  test('deduplicates current and legacy aliases for the same rendered control', () => {
    const groups = buildRoomControlGroups(
      [tile],
      [[tile.id, tile.legacyIds![0]!]],
    )

    expect(groups).toHaveLength(1)
    expect(groups[0]?.members).toEqual([tile])
  })
})
