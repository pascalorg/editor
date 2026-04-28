import { describe, expect, test } from 'bun:test'
import type { CollectionId, HomeAssistantResourceBinding } from '@pascal-app/core/schema'
import {
  getPresentationAfterResourceInclusion,
  getPresentationAfterResourceRemoval,
  homeAssistantBindingsAreEqual,
  mergeHomeAssistantPresentation,
} from './home-assistant-binding-presentation'
import { getSmartHomeRoomControlTileId } from './smart-home-composition'

const collectionId = 'collection_master' as CollectionId

function light(id: string): HomeAssistantResourceBinding {
  return {
    actions: [{ domain: 'light', key: 'toggle', label: 'Toggle', service: 'toggle' }],
    capabilities: ['power'],
    defaultActionKey: 'toggle',
    entityId: id,
    id,
    kind: 'entity',
    label: id,
  }
}

describe('home assistant binding presentation helpers', () => {
  test('removing a resource stores resource-id exclusions and clears legacy groups', () => {
    const resources = [light('light.master_1'), light('light.master_2')]
    const presentation = {
      rtsGroups: [
        resources.map((resource) => getSmartHomeRoomControlTileId(collectionId, resource.id)),
      ],
    }

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
