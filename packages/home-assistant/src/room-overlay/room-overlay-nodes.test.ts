import { describe, expect, test } from 'bun:test'
import type { AnyNode, AnyNodeId, Collection, CollectionId } from '@pascal-app/core'
import type {
  HomeAssistantCollectionBinding,
  HomeAssistantResourceBinding,
} from '../home-assistant-binding'
import {
  buildCollectionBindingFromResource,
  buildHomeAssistantResourceCollection,
  createPascalGroupResource,
  toResourceBinding,
} from '../home-assistant-collections'
import { getSmartHomeRoomControlTileId } from '../smart-home-composition'
import { DEFAULT_SMART_HOME_OVERLAY_VISIBILITY } from '../types'
import { buildHomeAssistantRoomOverlayNodes } from './room-overlay-nodes'

const collectionId = 'collection_master' as CollectionId
const itemIds = ['item_master_1', 'item_master_2'] as AnyNodeId[]

const collection: Collection = {
  controlNodeId: itemIds[0],
  id: collectionId,
  name: 'Master',
  nodeIds: itemIds,
}

const sceneNodes = Object.fromEntries(
  itemIds.map((id, index) => [
    id,
    {
      asset: {
        interactive: {
          controls: [{ kind: 'toggle', label: 'Toggle' }],
        },
        name: `Light ${index + 1}`,
      },
      id,
      position: [index, 0, 0],
      type: 'item',
    } as unknown as AnyNode,
  ]),
) as Record<AnyNodeId, AnyNode>

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

function fan(id: string): HomeAssistantResourceBinding {
  return {
    actions: [
      { capability: 'power', domain: 'fan', key: 'toggle', label: 'Toggle', service: 'toggle' },
    ],
    capabilities: ['power', 'speed'],
    defaultActionKey: 'toggle',
    entityId: id,
    id,
    kind: 'entity',
    label: id,
  }
}

function pascalGroup(id: string): HomeAssistantResourceBinding {
  return {
    actions: [],
    capabilities: ['power'],
    defaultActionKey: null,
    entityId: null,
    id,
    isGroup: true,
    kind: 'entity',
    label: 'Master',
    memberEntityIds: [],
  }
}

function placeholder(id: string, label: string): HomeAssistantResourceBinding {
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

function importedGroup(id: string, members: string[]): HomeAssistantResourceBinding {
  return {
    ...pascalGroup(id),
    label: 'Master',
    memberEntityIds: members,
  }
}

const buildNodes = (binding: HomeAssistantCollectionBinding) =>
  buildHomeAssistantRoomOverlayNodes({
    bindings: { [collectionId]: binding },
    collections: { [collectionId]: collection },
    sceneNodes,
    selectedLevelId: null,
    visibility: DEFAULT_SMART_HOME_OVERLAY_VISIBILITY,
  })

describe('buildHomeAssistantRoomOverlayNodes', () => {
  test('renders bound device members as enabled device controls inside a positioned group pill', () => {
    const resources = [
      pascalGroup('pascal-group:master'),
      light('light.master_1'),
      light('light.master_2'),
    ]
    const nodes = buildNodes({
      aggregation: 'all',
      collectionId,
      presentation: {
        rtsRoomControls: {
          groups: [{ memberResourceIds: ['light.master_1', 'light.master_2'] }],
          mode: 'user-managed',
        },
        rtsWorldPosition: { x: 1, y: 0, z: 1 },
      },
      primaryResourceId: resources[1]!.id,
      resources,
    })

    const groupNode = nodes.find((node) => node.id === collectionId)
    const members = groupNode?.controlGroups.flatMap((group) => group.members) ?? []

    expect(members.map((member) => member.resourceId)).toEqual(['light.master_1', 'light.master_2'])
    expect(members.every((member) => member.disabled !== true)).toBe(true)
  })

  test('renders an empty positioned group as a disabled pill instead of disabled device buttons', () => {
    const removedResourceIds = ['light.master_1', 'light.master_2']
    const nodes = buildNodes({
      aggregation: 'single',
      collectionId,
      presentation: {
        rtsRoomControls: {
          excludedResourceIds: removedResourceIds,
          mode: 'user-managed',
        },
        rtsWorldPosition: { x: 1, y: 0, z: 1 },
      },
      primaryResourceId: 'pascal-group:master',
      resources: [pascalGroup('pascal-group:master')],
    })

    const groupNode = nodes.find((node) => node.id === collectionId)
    const members = groupNode?.controlGroups.flatMap((group) => group.members) ?? []

    expect(members).toHaveLength(1)
    expect(members[0]?.id).toBe(getSmartHomeRoomControlTileId(collectionId, 'pascal-group:master'))
    expect(members[0]?.disabled).toBe(true)
    expect(nodes.some((node) => node.id.includes(':local:'))).toBe(false)
  })

  test('renders a disabled local pill with a Pascal group resource id', () => {
    const nodes = buildNodes({
      aggregation: 'single',
      collectionId,
      presentation: {
        label: 'Recessed Light',
        rtsWorldPosition: { x: 1, y: 0, z: 1 },
      },
      primaryResourceId: 'local.recessed_light',
      resources: [placeholder('local.recessed_light', 'Recessed Light')],
    })

    const groupNode = nodes.find((node) => node.id === collectionId)
    const members = groupNode?.controlGroups.flatMap((group) => group.members) ?? []

    expect(members).toHaveLength(1)
    expect(members[0]?.resourceId).toBe(`pascal-group:${collectionId}`)
    expect(members[0]?.disabled).toBe(true)
  })

  test('uses current HA device labels for single device overlays', () => {
    const singleCollectionId = 'collection_mbrl1' as CollectionId
    const singleItemId = 'item_recessed_light' as AnyNodeId
    const deviceResource = {
      ...light('light.pascal_master_bedroom_recessed_light_1'),
      label: 'MbrL1',
    }
    const nodes = buildHomeAssistantRoomOverlayNodes({
      bindings: {
        [singleCollectionId]: {
          aggregation: 'single',
          collectionId: singleCollectionId,
          presentation: {
            rtsWorldPosition: { x: 8, y: 0, z: 8 },
          },
          primaryResourceId: deviceResource.id,
          resources: [deviceResource],
        },
      },
      collections: {
        [singleCollectionId]: {
          controlNodeId: singleItemId,
          id: singleCollectionId,
          name: 'Recessed Light',
          nodeIds: [singleItemId],
        },
      },
      sceneNodes: {
        [singleItemId]: {
          asset: {
            interactive: {
              controls: [{ kind: 'toggle', label: 'Toggle' }],
            },
            name: 'Recessed Light',
          },
          id: singleItemId,
          position: [0, 0, 0],
          type: 'item',
        } as unknown as AnyNode,
      },
      selectedLevelId: null,
      visibility: DEFAULT_SMART_HOME_OVERLAY_VISIBILITY,
    })

    const overlayNode = nodes.find((node) => node.id === singleCollectionId)
    const member = overlayNode?.controlGroups[0]?.members[0]

    expect(overlayNode?.roomName).toBe('MbrL1')
    expect(overlayNode?.iconOnly).toBe(true)
    expect(overlayNode?.worldPosition).toBeUndefined()
    expect(overlayNode?.screenPosition).toBeUndefined()
    expect(overlayNode?.anchorNodeIds).toEqual([singleItemId])
    expect(member?.itemName).toBe('MbrL1')
  })

  test('keeps a newly placed empty Pascal group visible on the selected floor', () => {
    const resource = createPascalGroupResource('Pascal group')
    const positionedCollection = buildHomeAssistantResourceCollection(resource)
    const binding = buildCollectionBindingFromResource({
      collectionId: positionedCollection.id,
      presentation: {
        label: resource.label,
        rtsWorldPosition: { x: 4, y: 0, z: 2 },
      },
      resource,
    })

    const nodes = buildHomeAssistantRoomOverlayNodes({
      bindings: { [positionedCollection.id]: binding },
      collections: { [positionedCollection.id]: positionedCollection },
      sceneNodes,
      selectedLevelId: 'level_main' as AnyNodeId,
      visibility: DEFAULT_SMART_HOME_OVERLAY_VISIBILITY,
    })

    const groupNode = nodes.find((node) => node.id === positionedCollection.id)
    const members = groupNode?.controlGroups.flatMap((group) => group.members) ?? []

    expect(groupNode?.worldPosition).toEqual({ x: 4, y: 0, z: 2 })
    expect(members).toHaveLength(1)
    expect(members[0]?.resourceId).toBe(resource.id)
    expect(members[0]?.disabled).toBe(true)
  })

  test('renders one copied device once inside a positioned Pascal group', () => {
    const groupResource = createPascalGroupResource('Pascal group')
    const deviceResource = light('light.mbrl2')
    const groupCollection = buildHomeAssistantResourceCollection(groupResource)
    const deviceCollection = {
      controlNodeId: itemIds[0],
      id: 'collection_mbrl2' as CollectionId,
      name: 'MbrL2',
      nodeIds: [itemIds[0]],
    }
    const staleAnchoredGroupCollection = {
      ...groupCollection,
      controlNodeId: itemIds[0],
      nodeIds: itemIds,
    }
    const groupBinding = {
      aggregation: 'all',
      collectionId: staleAnchoredGroupCollection.id,
      presentation: {
        label: groupResource.label,
        rtsRoomControls: {
          groups: [
            {
              memberResourceIds: [deviceResource.id],
            },
          ],
          mode: 'user-managed',
        },
        rtsWorldPosition: { x: 4, y: 0, z: 2 },
      },
      primaryResourceId: deviceResource.id,
      resources: [toResourceBinding(groupResource), deviceResource],
    } satisfies HomeAssistantCollectionBinding
    const deviceBinding = {
      aggregation: 'single',
      collectionId: deviceCollection.id,
      primaryResourceId: deviceResource.id,
      resources: [deviceResource],
    } satisfies HomeAssistantCollectionBinding

    const nodes = buildHomeAssistantRoomOverlayNodes({
      bindings: {
        [deviceCollection.id]: deviceBinding,
        [staleAnchoredGroupCollection.id]: groupBinding,
      },
      collections: {
        [deviceCollection.id]: deviceCollection,
        [staleAnchoredGroupCollection.id]: staleAnchoredGroupCollection,
      },
      sceneNodes,
      selectedLevelId: null,
      visibility: DEFAULT_SMART_HOME_OVERLAY_VISIBILITY,
    })

    const groupNode = nodes.find((node) => node.id === staleAnchoredGroupCollection.id)
    const members = groupNode?.controlGroups.flatMap((group) => group.members) ?? []

    expect(members.map((member) => member.resourceId)).toEqual([deviceResource.id])
  })

  test('derives imported group pill position from direct collection anchors', () => {
    const resources = [
      importedGroup('light.master_group', ['light.master_1', 'light.master_2']),
      light('light.master_1'),
      light('light.master_2'),
    ]
    const nodes = buildNodes({
      aggregation: 'all',
      collectionId,
      presentation: {
        label: 'Master',
      },
      primaryResourceId: resources[1]!.id,
      resources,
    })

    const groupNode = nodes.find((node) => node.id === collectionId)
    const localNodes = nodes.filter((node) => node.id.includes(':local:'))

    expect(groupNode?.worldPosition).toEqual({ x: 0.5, y: 0, z: 0 })
    expect(groupNode?.controlGroups.flatMap((group) => group.members)).toHaveLength(2)
    expect(localNodes).toHaveLength(2)
    expect(localNodes.every((node) => node.iconOnly)).toBe(true)
    expect(localNodes.map((node) => node.anchorNodeIds[0])).toEqual(itemIds)
  })

  test('renders group members as local device icons at their item anchors', () => {
    const resources = [
      pascalGroup('pascal-group:recessed-light'),
      light('light.mbrl2'),
      light('light.mbrl3'),
    ]
    const nodes = buildNodes({
      aggregation: 'all',
      collectionId,
      presentation: {
        label: 'Recessed Light',
        rtsRoomControls: {
          groups: [{ memberResourceIds: ['light.mbrl2', 'light.mbrl3'] }],
          mode: 'user-managed',
        },
        rtsWorldPosition: { x: 1, y: 0, z: 1 },
      },
      primaryResourceId: 'pascal-group:recessed-light',
      resources,
    })

    const localNodes = nodes.filter((node) => node.id.includes(':local:'))
    const groupMembers = nodes
      .filter((node) => node.id === collectionId)
      .flatMap((node) => node.controlGroups)
      .flatMap((group) => group.members)

    expect(localNodes).toHaveLength(2)
    expect(localNodes.every((node) => node.iconOnly)).toBe(true)
    expect(localNodes.map((node) => node.anchorNodeIds[0])).toEqual(itemIds)
    expect(groupMembers.map((member) => member.resourceId)).toEqual(['light.mbrl2', 'light.mbrl3'])
  })

  test('matches fan resources to fan item buttons inside mixed bedroom groups', () => {
    const mixedItemIds = ['item_master_fan', 'item_master_light'] as AnyNodeId[]
    const mixedCollectionId = 'collection_master_mixed' as CollectionId
    const mixedCollection: Collection = {
      controlNodeId: mixedItemIds[0],
      id: mixedCollectionId,
      name: 'Master mixed',
      nodeIds: mixedItemIds,
    }
    const mixedSceneNodes = {
      [mixedItemIds[0]]: {
        asset: {
          interactive: { controls: [{ kind: 'toggle', label: 'Toggle' }] },
          name: 'Ceiling fan',
        },
        id: mixedItemIds[0],
        position: [0, 0, 0],
        type: 'item',
      } as unknown as AnyNode,
      [mixedItemIds[1]]: {
        asset: {
          interactive: { controls: [{ kind: 'toggle', label: 'Toggle' }] },
          name: 'Ceiling Lamp',
        },
        id: mixedItemIds[1],
        position: [1, 0, 0],
        type: 'item',
      } as unknown as AnyNode,
    }
    const resources = [
      pascalGroup('pascal-group:master'),
      light('light.master_lamp'),
      fan('fan.master_ceiling_fan'),
    ]
    const nodes = buildHomeAssistantRoomOverlayNodes({
      bindings: {
        [mixedCollectionId]: {
          aggregation: 'all',
          collectionId: mixedCollectionId,
          presentation: {
            label: 'Master',
            rtsWorldPosition: { x: 1, y: 0, z: 1 },
          },
          primaryResourceId: 'pascal-group:master',
          resources,
        },
      },
      collections: { [mixedCollectionId]: mixedCollection },
      sceneNodes: mixedSceneNodes,
      selectedLevelId: null,
      visibility: DEFAULT_SMART_HOME_OVERLAY_VISIBILITY,
    })

    const fanMember = nodes
      .flatMap((node) => node.controlGroups)
      .flatMap((group) => group.members)
      .find((member) => member.itemId === mixedItemIds[0])

    expect(fanMember?.resourceId).toBe('fan.master_ceiling_fan')
    expect(fanMember?.itemKind).toBe('fan')
  })

  test('renders positioned group controls with local device icon buttons', () => {
    const kitchenItemIds = ['item_kit_p1', 'item_kit_p2', 'item_kit_t1'] as AnyNodeId[]
    const kitchenCollectionId = 'collection_kitchen' as CollectionId
    const kitchenCollection: Collection = {
      controlNodeId: kitchenItemIds[0],
      id: kitchenCollectionId,
      name: 'Kitchen',
      nodeIds: kitchenItemIds,
    }
    const kitchenSceneNodes = Object.fromEntries(
      kitchenItemIds.map((id, index) => [
        id,
        {
          asset: {
            interactive: { controls: [{ kind: 'toggle', label: 'Toggle' }] },
            name: ['KitP1', 'KitP2', 'KitT1'][index],
          },
          id,
          position: [index, 0, 0],
          type: 'item',
        } as unknown as AnyNode,
      ]),
    ) as Record<AnyNodeId, AnyNode>
    const resources = [
      importedGroup('light.kitchen_group', ['light.kitp1', 'light.kitp2', 'light.kitt1']),
      light('light.kitp1'),
      light('light.kitp2'),
      light('light.kitt1'),
    ]

    const nodes = buildHomeAssistantRoomOverlayNodes({
      bindings: {
        [kitchenCollectionId]: {
          aggregation: 'all',
          collectionId: kitchenCollectionId,
          presentation: {
            label: 'Kitchen',
            rtsWorldPosition: { x: 2, y: 0, z: 2 },
          },
          primaryResourceId: 'light.kitchen_group',
          resources,
        },
      },
      collections: { [kitchenCollectionId]: kitchenCollection },
      sceneNodes: kitchenSceneNodes,
      selectedLevelId: null,
      visibility: DEFAULT_SMART_HOME_OVERLAY_VISIBILITY,
    })

    const groupMembers = nodes
      .filter((node) => node.id === kitchenCollectionId)
      .flatMap((node) => node.controlGroups)
      .flatMap((group) => group.members)
    const localMembers = nodes.filter((node) => node.id.includes(':local:'))

    expect(groupMembers.map((member) => member.resourceId)).toEqual([
      'light.kitp1',
      'light.kitp2',
      'light.kitt1',
    ])
    expect(groupMembers.every((member) => member.disabled !== true)).toBe(true)
    expect(localMembers).toHaveLength(3)
    expect(localMembers.every((node) => node.iconOnly)).toBe(true)
    expect(localMembers.map((node) => node.anchorNodeIds[0])).toEqual(kitchenItemIds)
  })

  test('keeps a direct device overlay anchored to its own item when a related group exists', () => {
    const diningItemIds = ['item_din_l1', 'item_din_l2', 'item_din_l3'] as AnyNodeId[]
    const directCollectionId = 'collection_din_l1' as CollectionId
    const groupCollectionId = 'collection_dining_group' as CollectionId
    const diningSceneNodes = Object.fromEntries(
      diningItemIds.map((id, index) => [
        id,
        {
          asset: {
            interactive: { controls: [{ kind: 'toggle', label: 'Toggle' }] },
            name: ['Ceiling Lamp', 'Ceiling Lamp', 'Ceiling Lamp'][index],
          },
          id,
          position: [index, 0, 0],
          type: 'item',
        } as unknown as AnyNode,
      ]),
    ) as Record<AnyNodeId, AnyNode>

    const resources = [
      importedGroup('light.dining_group', ['light.din_l1', 'light.din_l2', 'light.din_l3']),
      { ...light('light.din_l1'), label: 'DinL1' },
      { ...light('light.din_l2'), label: 'DinL2' },
      { ...light('light.din_l3'), label: 'DinL3' },
    ]

    const nodes = buildHomeAssistantRoomOverlayNodes({
      bindings: {
        [directCollectionId]: {
          aggregation: 'single',
          collectionId: directCollectionId,
          primaryResourceId: resources[1]!.id,
          resources: [resources[1]!],
        },
        [groupCollectionId]: {
          aggregation: 'all',
          collectionId: groupCollectionId,
          presentation: {
            label: 'Dining',
            rtsWorldPosition: { x: 2, y: 0, z: 2 },
          },
          primaryResourceId: resources[0]!.id,
          resources,
        },
      },
      collections: {
        [directCollectionId]: {
          controlNodeId: diningItemIds[0],
          id: directCollectionId,
          name: 'Ceiling Lamp',
          nodeIds: diningItemIds,
        },
        [groupCollectionId]: {
          controlNodeId: diningItemIds[0],
          id: groupCollectionId,
          name: 'Dining',
          nodeIds: diningItemIds,
        },
      },
      sceneNodes: diningSceneNodes,
      selectedLevelId: null,
      visibility: DEFAULT_SMART_HOME_OVERLAY_VISIBILITY,
    })

    const directNode = nodes.find((node) => node.id === directCollectionId)
    const directMembers = directNode?.controlGroups.flatMap((group) => group.members) ?? []
    const groupLocalResources = nodes
      .filter((node) => node.id.startsWith(`${groupCollectionId}:local:`))
      .flatMap((node) => node.controlGroups)
      .flatMap((group) => group.members)
      .map((member) => member.resourceId)

    expect(directNode?.iconOnly).toBe(true)
    expect(directNode?.anchorNodeIds).toEqual([diningItemIds[0]])
    expect(directMembers).toHaveLength(1)
    expect(directMembers[0]?.resourceId).toBe('light.din_l1')
    expect(directMembers[0]?.itemId).toBe(diningItemIds[0])
    expect(groupLocalResources).toEqual(['light.din_l2', 'light.din_l3'])
  })
})
