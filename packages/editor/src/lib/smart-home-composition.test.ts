import { describe, expect, test } from 'bun:test'
import type {
  CollectionId,
  HomeAssistantCollectionBinding,
  HomeAssistantResourceBinding,
} from '@pascal-app/core/schema'
import { normalizeHomeAssistantCollectionBinding } from '@pascal-app/core/schema'
import {
  buildSmartHomeRoomControlCompositionFromTileGroups,
  getDurableSmartHomeRoomControlTileGroups,
  getLegacySmartHomeRoomControlTileId,
  getSmartHomeRoomControlTileId,
  isSmartHomeBindingPresentationHidden,
  normalizeSmartHomeRoomGroupsForBinding,
  repairHomeAssistantBindingResourcesFromGroups,
} from './smart-home-composition'

const collectionId = 'collection_master' as CollectionId

function entityResource(id: string, label = id): HomeAssistantResourceBinding {
  return {
    actions: [
      {
        capability: 'power',
        domain: id.split('.')[0] ?? 'light',
        fields: [],
        key: 'turn_on',
        label: 'Turn on',
        service: 'turn_on',
      },
    ],
    capabilities: ['power'],
    defaultActionKey: 'turn_on',
    entityId: id,
    id,
    kind: 'entity',
    label,
  }
}

function groupResource(id: string, memberEntityIds: string[]): HomeAssistantResourceBinding {
  return {
    actions: [],
    capabilities: ['power'],
    entityId: id,
    id,
    isGroup: true,
    kind: 'entity',
    label: 'Master',
    memberEntityIds,
  }
}

function binding(
  resources: HomeAssistantResourceBinding[],
  rtsGroups?: string[][],
): HomeAssistantCollectionBinding {
  return {
    aggregation: 'all',
    collectionId,
    presentation: rtsGroups ? ({ rtsGroups } as never) : undefined,
    primaryResourceId: resources[0]?.id ?? null,
    resources,
  }
}

describe('smart home composition', () => {
  const lights = [1, 2, 3, 4].map((index) =>
    entityResource(`light.pascal_master_bedroom_recessed_light_${index}`, `MbrL${index}`),
  )
  const masterGroup = groupResource(
    'light.pascal_master_bedroom_lights_group',
    lights.map((resource) => resource.id),
  )
  const tv = entityResource('media_player.master_tv', 'Master TV')

  test('normalizes stored tile ids and appends newly available controls', () => {
    const rawGroups = [[getSmartHomeRoomControlTileId(collectionId, lights[0]!.id)]]
    const groups = normalizeSmartHomeRoomGroupsForBinding({
      appendMissingControls: true,
      collectionId,
      rawGroups,
      resources: lights,
    })

    expect(groups).toEqual([
      [getSmartHomeRoomControlTileId(collectionId, lights[0]!.id)],
      [getSmartHomeRoomControlTileId(collectionId, lights[1]!.id)],
      [getSmartHomeRoomControlTileId(collectionId, lights[2]!.id)],
      [getSmartHomeRoomControlTileId(collectionId, lights[3]!.id)],
    ])
  })

  test('hydrates all HA group member devices into the binding resources', () => {
    const allResourcesById = new Map(
      lights.concat(masterGroup).map((resource) => [resource.id, resource]),
    )
    const repaired = repairHomeAssistantBindingResourcesFromGroups({
      allResourcesById,
      binding: binding([masterGroup, lights[0]!]),
      rawGroups: [[getSmartHomeRoomControlTileId(collectionId, lights[0]!.id)]],
    })

    expect(repaired.resources.map((resource) => resource.id)).toEqual([
      masterGroup.id,
      lights[0]!.id,
      lights[1]!.id,
      lights[2]!.id,
      lights[3]!.id,
    ])
  })

  test('keeps detached HA group members excluded from automatic hydration', () => {
    const allResourcesById = new Map(
      lights.concat(masterGroup).map((resource) => [resource.id, resource]),
    )
    const repaired = repairHomeAssistantBindingResourcesFromGroups({
      allResourcesById,
      binding: binding([masterGroup, lights[0]!, lights[1]!]),
      detachedResourceIds: [lights[1]!.id],
      rawGroups: [[getSmartHomeRoomControlTileId(collectionId, lights[0]!.id)]],
    })

    expect(repaired.resources.map((resource) => resource.id)).toEqual([
      masterGroup.id,
      lights[0]!.id,
      lights[2]!.id,
      lights[3]!.id,
    ])
    expect(repaired.presentation?.rtsRoomControls?.excludedResourceIds).toContain(lights[1]!.id)
  })

  test('preserves user-added resources referenced by authored room groups', () => {
    const tvGroup = [getSmartHomeRoomControlTileId(collectionId, tv.id)]
    const allResourcesById = new Map(
      lights.concat(masterGroup, tv).map((resource) => [resource.id, resource]),
    )
    const repaired = repairHomeAssistantBindingResourcesFromGroups({
      allResourcesById,
      binding: binding(
        [masterGroup, lights[0]!, tv],
        [[getSmartHomeRoomControlTileId(collectionId, lights[0]!.id)], tvGroup],
      ),
      rawGroups: [[getSmartHomeRoomControlTileId(collectionId, lights[0]!.id)], tvGroup],
    })

    expect(repaired.resources.some((resource) => resource.id === tv.id)).toBe(true)
  })

  test('converts legacy tile ids into resource-id room-control composition', () => {
    const legacyGroup = [
      `${getLegacySmartHomeRoomControlTileId(collectionId, lights[0]!.id)}:0`,
      `${getLegacySmartHomeRoomControlTileId(collectionId, lights[1]!.id)}:1`,
    ]
    const composition = buildSmartHomeRoomControlCompositionFromTileGroups({
      collectionId,
      groups: [legacyGroup],
      resources: lights,
    })

    expect(composition?.groups?.[0]?.memberResourceIds).toEqual([lights[0]!.id, lights[1]!.id])

    const normalized = normalizeHomeAssistantCollectionBinding(binding(lights, [legacyGroup]))

    expect(normalized?.presentation?.rtsRoomControls?.groups?.[0]?.memberResourceIds).toEqual([
      lights[0]!.id,
      lights[1]!.id,
    ])
    expect(
      (normalized?.presentation as Record<string, unknown> | undefined)?.rtsGroups,
    ).toBeUndefined()
  })

  test('preserves explicit user-managed room-control authority', () => {
    const composition = buildSmartHomeRoomControlCompositionFromTileGroups({
      collectionId,
      groups: [[getSmartHomeRoomControlTileId(collectionId, lights[0]!.id)]],
      mode: 'user-managed',
      resources: lights,
    })

    expect(composition?.mode).toBe('user-managed')
    expect(composition?.groups?.[0]).toEqual({ memberResourceIds: [lights[0]!.id] })

    const normalized = normalizeHomeAssistantCollectionBinding({
      ...binding(lights),
      presentation: { rtsRoomControls: composition },
    })

    expect(normalized?.presentation?.rtsRoomControls?.mode).toBe('user-managed')
    expect(normalized?.presentation?.rtsRoomControls?.groups?.[0]).toEqual({
      memberResourceIds: [lights[0]!.id],
    })
  })

  test('canonicalizes UI control ids into durable HA resource tile ids', () => {
    const uiGroups = [['collection_master:item-light-node:0', 'collection_master:item-fan-node:0']]
    const groups = getDurableSmartHomeRoomControlTileGroups({
      collectionId,
      controls: [
        {
          id: 'collection_master:item-light-node:0',
          resourceId: lights[0]!.id,
        },
        {
          id: 'collection_master:item-fan-node:0',
          legacyIds: ['legacy-fan-control'],
          resourceId: 'fan.master',
        },
      ],
      groups: uiGroups,
    })

    expect(groups).toEqual([
      [
        getSmartHomeRoomControlTileId(collectionId, lights[0]!.id),
        getSmartHomeRoomControlTileId(collectionId, 'fan.master'),
      ],
    ])

    const composition = buildSmartHomeRoomControlCompositionFromTileGroups({
      collectionId,
      groups,
      mode: 'user-managed',
      resources: [lights[0]!, entityResource('fan.master')],
    })

    expect(composition?.groups).toEqual([{ memberResourceIds: [lights[0]!.id, 'fan.master'] }])
  })

  test('marks hidden group presentation as durable scene state', () => {
    const normalized = normalizeHomeAssistantCollectionBinding({
      ...binding([masterGroup]),
      presentation: { rtsHidden: true },
    })

    expect(isSmartHomeBindingPresentationHidden(normalized?.presentation)).toBe(true)
  })
})
