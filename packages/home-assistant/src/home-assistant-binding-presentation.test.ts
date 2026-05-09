import { describe, expect, test } from 'bun:test'
import type { CollectionId, HomeAssistantResourceBinding } from '@pascal-app/core/schema'
import {
  getBindingAfterDeviceResourceCopyToGroup,
  getBindingAfterDeviceResourceRemovalFromGroup,
  getBindingAfterDeviceResourcesMergeIntoGroup,
  getBindingAfterRoomGrouping,
  getPresentationAfterResourceInclusion,
  getPresentationAfterResourceRemoval,
  homeAssistantBindingsAreEqual,
  mergeHomeAssistantPresentation,
} from './home-assistant-binding-presentation'
import { getSmartHomeRoomControlTileId } from './smart-home-composition'

const collectionId = 'collection_master' as CollectionId

function light(id: string): HomeAssistantResourceBinding {
  return {
    actions: [
      { capability: 'power', domain: 'light', key: 'toggle', label: 'Toggle', service: 'toggle' },
    ],
    capabilities: ['power'],
    defaultActionKey: 'toggle',
    entityId: id,
    id,
    kind: 'entity',
    label: id,
  }
}

function mediaPlayer(id: string): HomeAssistantResourceBinding {
  return {
    actions: [
      {
        capability: 'power',
        domain: 'media_player',
        key: 'toggle',
        label: 'Toggle',
        service: 'toggle',
      },
    ],
    capabilities: ['power', 'media'],
    defaultActionKey: 'toggle',
    entityId: id,
    id,
    kind: 'entity',
    label: id,
  }
}

function group(id: string): HomeAssistantResourceBinding {
  return {
    actions: [],
    capabilities: ['power'],
    defaultActionKey: null,
    entityId: id,
    id,
    isGroup: true,
    kind: 'entity',
    label: id,
    memberEntityIds: [],
  }
}

function localPlaceholder(id: string, label: string): HomeAssistantResourceBinding {
  return {
    actions: [],
    capabilities: ['power'],
    defaultActionKey: null,
    entityId: null,
    id,
    kind: 'entity',
    label,
  }
}

describe('home assistant binding presentation helpers', () => {
  test('removing a resource stores resource-id exclusions and clears legacy groups', () => {
    const resources = [light('light.master_1'), light('light.master_2')]
    const presentation = {
      rtsGroups: [
        resources.map((resource) => getSmartHomeRoomControlTileId(collectionId, resource.id)),
      ],
    } as never

    const nextPresentation = getPresentationAfterResourceRemoval(
      presentation,
      collectionId,
      resources[1]!.id,
      resources,
    )

    expect((nextPresentation as Record<string, unknown>).rtsGroups).toBeUndefined()
    expect((nextPresentation as Record<string, unknown>).rtsExcludedResourceIds).toBeUndefined()
    expect(nextPresentation.rtsRoomControls?.mode).toBe('user-managed')
    expect(nextPresentation.rtsRoomControls?.excludedResourceIds).toEqual([resources[1]!.id])
    expect(nextPresentation.rtsRoomControls?.groups?.[0]?.memberResourceIds).toEqual([
      resources[0]!.id,
    ])
  })

  test('including a resource removes only that durable exclusion', () => {
    const resources = [light('light.master_1'), light('light.master_2')]
    const nextPresentation = getPresentationAfterResourceInclusion(
      {
        rtsRoomControls: {
          excludedResourceIds: resources.map((resource) => resource.id),
          groups: [{ memberResourceIds: [resources[0]!.id] }],
        },
      },
      collectionId,
      resources[1]!.id,
      resources,
    )

    expect(nextPresentation?.rtsRoomControls?.excludedResourceIds).toEqual([resources[0]!.id])
    expect(nextPresentation?.rtsRoomControls?.mode).toBe('user-managed')
    expect(nextPresentation?.rtsRoomControls?.groups?.[0]?.memberResourceIds).toEqual([
      resources[0]!.id,
    ])
  })

  test('merging resource-id composition removes legacy presentation fields', () => {
    const merged = mergeHomeAssistantPresentation(
      {
        rtsExcludedResourceIds: ['light.legacy'],
        rtsGroups: [['legacy-tile']],
      } as never,
      {
        rtsRoomControls: {
          groups: [{ memberResourceIds: ['light.master_1'] }],
        },
      },
    )

    expect((merged as Record<string, unknown> | undefined)?.rtsExcludedResourceIds).toBeUndefined()
    expect((merged as Record<string, unknown> | undefined)?.rtsGroups).toBeUndefined()
    expect(merged?.rtsRoomControls?.groups?.[0]?.memberResourceIds).toEqual(['light.master_1'])
  })

  test('ha-derived presentation updates do not overwrite user-managed pill composition', () => {
    const merged = mergeHomeAssistantPresentation(
      {
        label: 'Master',
        rtsRoomControls: {
          excludedResourceIds: ['fan.master'],
          groups: [
            { memberResourceIds: ['light.master_1', 'light.master_2'] },
            { memberResourceIds: ['media_player.master_tv'] },
          ],
          mode: 'user-managed',
        },
      },
      {
        label: 'Master Bedroom',
        rtsRoomControls: {
          groups: [{ memberResourceIds: ['light.master_1', 'light.master_2', 'fan.master'] }],
          mode: 'ha-derived',
        },
      },
    )

    expect(merged?.label).toBe('Master Bedroom')
    expect(merged?.rtsRoomControls?.mode).toBe('user-managed')
    expect(merged?.rtsRoomControls?.excludedResourceIds).toEqual(['fan.master'])
    expect(merged?.rtsRoomControls?.groups).toEqual([
      { memberResourceIds: ['light.master_1', 'light.master_2'] },
      { memberResourceIds: ['media_player.master_tv'] },
    ])
  })

  test('room grouping persists resource-id composition from rendered tile ids', () => {
    const resources = [light('light.master_1'), light('light.master_2'), light('fan.master')]
    const nextBinding = getBindingAfterRoomGrouping({
      binding: {
        aggregation: 'all',
        collectionId,
        presentation: { rtsRoomControls: { excludedResourceIds: ['fan.master'] } },
        primaryResourceId: resources[0]!.id,
        resources,
      },
      controls: resources.map((resource) => ({
        id: getSmartHomeRoomControlTileId(collectionId, resource.id),
        resourceId: resource.id,
      })),
      groups: [
        [
          getSmartHomeRoomControlTileId(collectionId, resources[0]!.id),
          getSmartHomeRoomControlTileId(collectionId, resources[1]!.id),
        ],
      ],
    })

    expect(nextBinding?.presentation?.rtsRoomControls).toEqual({
      excludedResourceIds: ['fan.master'],
      groups: [{ memberResourceIds: ['light.master_1', 'light.master_2'] }],
      mode: 'user-managed',
    })
  })

  test('plain merged device groups only change layout, not bound resources', () => {
    const resources = [light('light.master_1'), light('light.master_2')]
    const grouped = getBindingAfterRoomGrouping({
      binding: {
        aggregation: 'all',
        collectionId,
        primaryResourceId: resources[0]!.id,
        resources,
      },
      controls: resources.map((resource) => ({
        id: getSmartHomeRoomControlTileId(collectionId, resource.id),
        resourceId: resource.id,
      })),
      groups: [
        [
          getSmartHomeRoomControlTileId(collectionId, resources[0]!.id),
          getSmartHomeRoomControlTileId(collectionId, resources[1]!.id),
        ],
      ],
    })
    const split = getBindingAfterRoomGrouping({
      binding: grouped!,
      collectionId,
      controls: resources.map((resource) => ({
        id: getSmartHomeRoomControlTileId(collectionId, resource.id),
        resourceId: resource.id,
      })),
      groups: [[getSmartHomeRoomControlTileId(collectionId, resources[1]!.id)]],
    })

    expect(grouped?.resources.map((resource) => resource.id)).toEqual([
      'light.master_1',
      'light.master_2',
    ])
    expect(split?.resources.map((resource) => resource.id)).toEqual([
      'light.master_1',
      'light.master_2',
    ])
    expect(split?.presentation?.rtsRoomControls).toEqual({
      groups: [{ memberResourceIds: ['light.master_2'] }],
      mode: 'user-managed',
    })
  })

  test('copying a device into a room group stores it as a separate user-managed pill member', () => {
    const targetResources = [group('light.master_group'), light('light.master_1')]
    const tv = mediaPlayer('media_player.master_tv')
    const nextBinding = getBindingAfterDeviceResourceCopyToGroup({
      sourceBinding: {
        aggregation: 'single',
        collectionId: 'collection_tv' as CollectionId,
        primaryResourceId: tv.id,
        resources: [tv],
      },
      targetBinding: {
        aggregation: 'all',
        collectionId,
        presentation: {
          rtsRoomControls: {
            groups: [{ memberResourceIds: ['light.master_1'] }],
            mode: 'user-managed',
          },
        },
        primaryResourceId: targetResources[0]!.id,
        resources: targetResources,
      },
    })

    expect(nextBinding?.resources.map((resource) => resource.id)).toEqual([
      'light.master_group',
      'light.master_1',
      'media_player.master_tv',
    ])
    expect(nextBinding?.presentation?.rtsRoomControls).toEqual({
      groups: [
        { memberResourceIds: ['light.master_1'] },
        { memberResourceIds: ['media_player.master_tv'] },
      ],
      mode: 'user-managed',
    })
  })

  test('copying from a multi-resource source uses the dragged resource id', () => {
    const targetResources = [group('light.master_group')]
    const resources = [light('light.master_1'), light('light.master_2')]
    const nextBinding = getBindingAfterDeviceResourceCopyToGroup({
      sourceBinding: {
        aggregation: 'all',
        collectionId: 'collection_source' as CollectionId,
        primaryResourceId: resources[0]!.id,
        resources,
      },
      sourceResourceId: resources[1]!.id,
      targetBinding: {
        aggregation: 'single',
        collectionId,
        primaryResourceId: targetResources[0]!.id,
        resources: targetResources,
      },
    })

    expect(nextBinding?.resources.map((resource) => resource.id)).toEqual([
      'light.master_group',
      'light.master_2',
    ])
    expect(nextBinding?.presentation?.rtsRoomControls).toEqual({
      groups: [{ memberResourceIds: ['light.master_2'] }],
      mode: 'user-managed',
    })
  })

  test('copying into a plain layout group does not rewrite bindings', () => {
    const sourceLight = light('light.other')
    const nextBinding = getBindingAfterDeviceResourceCopyToGroup({
      sourceBinding: {
        aggregation: 'single',
        collectionId: 'collection_other' as CollectionId,
        primaryResourceId: sourceLight.id,
        resources: [sourceLight],
      },
      targetBinding: {
        aggregation: 'all',
        collectionId,
        presentation: {
          rtsRoomControls: {
            groups: [{ memberResourceIds: ['light.master_1'] }],
            mode: 'user-managed',
          },
        },
        primaryResourceId: 'light.master_1',
        resources: [light('light.master_1')],
      },
    })

    expect(nextBinding).toBeNull()
  })

  test('merging one device button onto another creates one two-device Pascal group', () => {
    const sourceLight = light('light.master_2')
    const targetLight = light('light.master_1')
    const nextBinding = getBindingAfterDeviceResourcesMergeIntoGroup({
      sourceBinding: {
        aggregation: 'single',
        collectionId: 'collection_mbrl2' as CollectionId,
        primaryResourceId: sourceLight.id,
        resources: [sourceLight],
      },
      sourceResourceId: sourceLight.id,
      targetBinding: {
        aggregation: 'single',
        collectionId,
        primaryResourceId: targetLight.id,
        resources: [targetLight],
      },
      targetResourceId: targetLight.id,
    })

    expect(nextBinding?.resources.map((resource) => resource.id)).toEqual([
      `pascal-group:${collectionId}`,
      'light.master_1',
      'light.master_2',
    ])
    expect(nextBinding?.presentation?.rtsRoomControls).toEqual({
      groups: [{ memberResourceIds: ['light.master_1', 'light.master_2'] }],
      mode: 'user-managed',
    })
  })

  test('copying a device into an empty Pascal group enables it once and clears its exclusion', () => {
    const sourceLight = light('light.master_2')
    const nextBinding = getBindingAfterDeviceResourceCopyToGroup({
      sourceBinding: {
        aggregation: 'single',
        collectionId: 'collection_mbrl2' as CollectionId,
        primaryResourceId: sourceLight.id,
        resources: [sourceLight],
      },
      targetBinding: {
        aggregation: 'single',
        collectionId,
        presentation: {
          rtsRoomControls: {
            excludedResourceIds: ['light.master_2'],
            mode: 'user-managed',
          },
        },
        primaryResourceId: 'pascal-group:master',
        resources: [group('pascal-group:master')],
      },
    })
    const duplicateBinding = nextBinding
      ? getBindingAfterDeviceResourceCopyToGroup({
          sourceBinding: {
            aggregation: 'single',
            collectionId: 'collection_mbrl2' as CollectionId,
            primaryResourceId: sourceLight.id,
            resources: [sourceLight],
          },
          targetBinding: nextBinding,
        })
      : null

    expect(nextBinding?.resources.map((resource) => resource.id)).toEqual([
      'pascal-group:master',
      'light.master_2',
    ])
    expect(nextBinding?.presentation?.rtsRoomControls).toEqual({
      groups: [{ memberResourceIds: ['light.master_2'] }],
      mode: 'user-managed',
    })
    expect(duplicateBinding).toBeNull()
  })

  test('copying a device into a disabled rendered local pill promotes it into a Pascal group', () => {
    const sourceLight = light('light.master_2')
    const nextBinding = getBindingAfterDeviceResourceCopyToGroup({
      sourceBinding: {
        aggregation: 'single',
        collectionId: 'collection_mbrl2' as CollectionId,
        primaryResourceId: sourceLight.id,
        resources: [sourceLight],
      },
      targetBinding: {
        aggregation: 'single',
        collectionId,
        presentation: {
          label: 'Recessed Light',
        },
        primaryResourceId: 'local.recessed_light',
        resources: [localPlaceholder('local.recessed_light', 'Recessed Light')],
      },
    })

    expect(nextBinding?.resources.map((resource) => resource.id)).toEqual([
      `pascal-group:${collectionId}`,
      'light.master_2',
    ])
    expect(nextBinding?.presentation?.rtsRoomControls).toEqual({
      groups: [{ memberResourceIds: ['light.master_2'] }],
      mode: 'user-managed',
    })
  })

  test('removing a device from a room group excludes it from HA-derived rehydration', () => {
    const resources = [
      group('light.master_group'),
      light('light.master_1'),
      light('light.master_2'),
      light('fan.master'),
      mediaPlayer('media_player.master_tv'),
    ]
    const nextBinding = getBindingAfterDeviceResourceRemovalFromGroup(
      {
        aggregation: 'all',
        collectionId,
        presentation: {
          rtsRoomControls: {
            groups: [
              { memberResourceIds: ['light.master_1', 'light.master_2', 'fan.master'] },
              { memberResourceIds: ['media_player.master_tv'] },
            ],
            mode: 'user-managed',
          },
        },
        primaryResourceId: 'light.master_group',
        resources,
      },
      'fan.master',
    )

    expect(nextBinding?.resources.map((resource) => resource.id)).toEqual([
      'light.master_group',
      'light.master_1',
      'light.master_2',
      'media_player.master_tv',
    ])
    expect(nextBinding?.presentation?.rtsRoomControls).toEqual({
      excludedResourceIds: ['fan.master'],
      groups: [
        { memberResourceIds: ['light.master_1', 'light.master_2'] },
        { memberResourceIds: ['media_player.master_tv'] },
      ],
      mode: 'user-managed',
    })
  })

  test('removing a member from a plain layout group does not unbind the device', () => {
    const resources = [light('light.master_1'), light('light.master_2')]
    const nextBinding = getBindingAfterDeviceResourceRemovalFromGroup(
      {
        aggregation: 'all',
        collectionId,
        presentation: {
          rtsRoomControls: {
            groups: [{ memberResourceIds: ['light.master_1', 'light.master_2'] }],
            mode: 'user-managed',
          },
        },
        primaryResourceId: 'light.master_1',
        resources,
      },
      'light.master_1',
    )

    expect(nextBinding).toBeNull()
  })

  test('removing the final device from a room group leaves a disabled group pill state', () => {
    const resources = [group('light.master_group'), light('light.master_1')]
    const nextBinding = getBindingAfterDeviceResourceRemovalFromGroup(
      {
        aggregation: 'all',
        collectionId,
        presentation: {
          rtsRoomControls: {
            groups: [{ memberResourceIds: ['light.master_1'] }],
            mode: 'user-managed',
          },
        },
        primaryResourceId: 'light.master_1',
        resources,
      },
      'light.master_1',
    )

    expect(nextBinding?.resources.map((resource) => resource.id)).toEqual(['light.master_group'])
    expect(nextBinding?.primaryResourceId).toBe('light.master_group')
    expect(nextBinding?.presentation?.rtsRoomControls).toEqual({
      excludedResourceIds: ['light.master_1'],
      mode: 'user-managed',
    })
  })

  test('removing an auto-derived group member still stores a durable exclusion', () => {
    const resources = [group('light.master_group')]
    const nextBinding = getBindingAfterDeviceResourceRemovalFromGroup(
      {
        aggregation: 'single',
        collectionId,
        presentation: {
          rtsRoomControls: {
            groups: [{ memberResourceIds: ['light.master_1'] }],
            mode: 'user-managed',
          },
        },
        primaryResourceId: 'light.master_group',
        resources,
      },
      'light.master_1',
    )

    expect(nextBinding?.resources.map((resource) => resource.id)).toEqual(['light.master_group'])
    expect(nextBinding?.primaryResourceId).toBe('light.master_group')
    expect(nextBinding?.presentation?.rtsRoomControls).toEqual({
      excludedResourceIds: ['light.master_1'],
      mode: 'user-managed',
    })
  })

  test('ui split sequence can remove every member from a real group without rehydrating old members', () => {
    const resources = [
      group('light.master_group'),
      light('light.master_1'),
      light('light.master_2'),
    ]
    const initialBinding = {
      aggregation: 'all',
      collectionId,
      presentation: {
        rtsRoomControls: {
          groups: [{ memberResourceIds: ['light.master_1', 'light.master_2'] }],
          mode: 'user-managed',
        },
      },
      primaryResourceId: 'light.master_1',
      resources,
    } satisfies HomeAssistantCollectionBinding

    const afterFirstLayout = getBindingAfterRoomGrouping({
      binding: initialBinding,
      collectionId,
      controls: resources.slice(1).map((resource) => ({
        id: getSmartHomeRoomControlTileId(collectionId, resource.id),
        resourceId: resource.id,
      })),
      groups: [[getSmartHomeRoomControlTileId(collectionId, 'light.master_2')]],
    })
    const afterFirstRemoval = getBindingAfterDeviceResourceRemovalFromGroup(
      afterFirstLayout!,
      'light.master_1',
    )
    const afterSecondLayout = getBindingAfterRoomGrouping({
      binding: afterFirstRemoval!,
      collectionId,
      controls: [light('light.master_2')].map((resource) => ({
        id: getSmartHomeRoomControlTileId(collectionId, resource.id),
        resourceId: resource.id,
      })),
      groups: [],
    })
    const afterSecondRemoval = getBindingAfterDeviceResourceRemovalFromGroup(
      afterSecondLayout!,
      'light.master_2',
    )

    expect(afterFirstRemoval?.resources.map((resource) => resource.id)).toEqual([
      'light.master_group',
      'light.master_2',
    ])
    expect(afterFirstRemoval?.presentation?.rtsRoomControls).toEqual({
      excludedResourceIds: ['light.master_1'],
      groups: [{ memberResourceIds: ['light.master_2'] }],
      mode: 'user-managed',
    })
    expect(afterSecondRemoval?.resources.map((resource) => resource.id)).toEqual([
      'light.master_group',
    ])
    expect(afterSecondRemoval?.presentation?.rtsRoomControls).toEqual({
      excludedResourceIds: ['light.master_1', 'light.master_2'],
      mode: 'user-managed',
    })
  })

  test('binding equality ignores undefined properties and object key order', () => {
    expect(
      homeAssistantBindingsAreEqual(
        {
          aggregation: 'single',
          collectionId,
          presentation: { label: 'Master', rtsHidden: undefined },
          primaryResourceId: 'light.master_1',
          resources: [light('light.master_1')],
        },
        {
          resources: [light('light.master_1')],
          primaryResourceId: 'light.master_1',
          presentation: { label: 'Master' },
          collectionId,
          aggregation: 'single',
        },
      ),
    ).toBe(true)
  })
})
