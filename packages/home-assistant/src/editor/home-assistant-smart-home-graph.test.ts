import { describe, expect, test } from 'bun:test'
import type { Collection, CollectionId } from '@pascal-app/core'
import type {
  HomeAssistantCollectionBinding,
  HomeAssistantResourceBinding,
} from '../home-assistant-binding'
import { buildHomeAssistantSmartHomeGraph } from './home-assistant-smart-home-graph'

const collectionId = 'collection_recessed_light' as CollectionId

function placeholderResource(id: string, label: string): HomeAssistantResourceBinding {
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

describe('buildHomeAssistantSmartHomeGraph', () => {
  test('lists disabled rendered local group pills in the Groups panel graph', () => {
    const collection: Collection = {
      controlNodeId: undefined,
      id: collectionId,
      name: 'Recessed Light',
      nodeIds: ['item_mbrl_1' as never],
    }
    const binding: HomeAssistantCollectionBinding = {
      aggregation: 'single',
      collectionId,
      presentation: {
        label: 'Recessed Light',
      },
      primaryResourceId: 'local.recessed_light',
      resources: [placeholderResource('local.recessed_light', 'Recessed Light')],
    }

    const graph = buildHomeAssistantSmartHomeGraph({
      bindings: { [collectionId]: binding },
      collections: { [collectionId]: collection },
      imports: [],
    })

    expect(graph.groupImports.map((resource) => resource.label)).toEqual(['Recessed Light'])
    expect(graph.groupImports[0]?.id).toBe(`pascal-group:${collectionId}`)
    expect(graph.renderedGroupPillIds.has(`pascal-group:${collectionId}`)).toBe(true)
  })
})
