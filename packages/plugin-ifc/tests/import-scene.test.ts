import { describe, expect, it } from 'bun:test'
import type { PascalSceneGraph } from '@pascal-app/ifc-converter'
import { createIfcImportOperations } from '../src/import-scene'

describe('createIfcImportOperations', () => {
  it('gives imported nodes fresh ids and keeps the hierarchy and cross references', () => {
    const graph = {
      rootNodeIds: ['site_1'],
      nodes: {
        site_1: { id: 'site_1', type: 'site', children: ['building_1'] },
        building_1: { id: 'building_1', type: 'building', parentId: 'site_1', children: ['level_1'] },
        level_1: { id: 'level_1', type: 'level', parentId: 'building_1', children: [] },
      },
    } as unknown as PascalSceneGraph

    const operations = createIfcImportOperations(graph, 'abc123')
    const [site, building, level] = operations

    expect(site?.node.id).toBe('site_1_imp_abc123')
    expect(site?.parentId).toBeUndefined()
    expect(building?.node.id).toBe('building_1_imp_abc123')
    expect(building?.parentId).toBe('site_1_imp_abc123')
    expect((site?.node as { children: string[] }).children).toEqual(['building_1_imp_abc123'])
    expect(level?.parentId).toBe('building_1_imp_abc123')
  })

  it('keeps orphaned and unlisted nodes instead of silently dropping them', () => {
    const graph = {
      rootNodeIds: ['site_1'],
      nodes: {
        site_1: { id: 'site_1', type: 'site', children: [] },
        imported_1: { id: 'imported_1', type: 'imported-mesh', metadata: { sourceId: 'site_1' } },
      },
    } as unknown as PascalSceneGraph

    const operations = createIfcImportOperations(graph, 'token')
    expect(operations).toHaveLength(2)
    expect(operations[1]?.parentId).toBeUndefined()
    expect((operations[1]?.node.metadata as { sourceId: string }).sourceId).toBe('site_1_imp_token')
  })
})
