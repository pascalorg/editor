import { describe, expect, test } from 'bun:test'
import type { AnyNode } from '@pascal-app/core'
import { buildSceneStructure, suggestSceneStructureMode } from './scene-structure'

function node(input: Record<string, unknown>): AnyNode {
  return {
    object: 'node',
    visible: true,
    parentId: null,
    metadata: {},
    ...input,
  } as unknown as AnyNode
}

describe('scene structure', () => {
  test('suggests process mode for industry pack generated factories', () => {
    const nodes = {
      site_1: node({ id: 'site_1', type: 'site', children: ['building_1'] }),
      building_1: node({
        id: 'building_1',
        type: 'building',
        children: ['level_1'],
        parentId: 'site_1',
      }),
      level_1: node({
        id: 'level_1',
        type: 'level',
        children: ['zone_tower', 'assembly_tower', 'pipe_tee'],
        parentId: 'building_1',
        level: 0,
      }),
      zone_tower: node({
        id: 'zone_tower',
        type: 'zone',
        name: 'Atmospheric distillation zone',
        parentId: 'level_1',
        metadata: {
          processId: 'refinery_basic_complex',
          processDisplayLabel: 'Refinery',
          stationId: 'atmospheric_distillation',
        },
      }),
      assembly_tower: node({
        id: 'assembly_tower',
        type: 'assembly',
        name: 'Atmospheric distillation unit',
        parentId: 'level_1',
        children: ['box_shell', 'box_ladder'],
        metadata: {
          processId: 'refinery_basic_complex',
          processDisplayLabel: 'Refinery',
          processLabel: 'Refinery basic complex',
          stationId: 'atmospheric_distillation',
          equipmentRole: 'distillation',
          sourcePack: { id: 'industry.refinery.basic', version: '0.1.0' },
          equipmentAssembly: {
            recipeId: 'factory:distillation-column',
            profileId: 'refinery.atmospheric_distillation_unit',
            equipmentFamily: 'column',
          },
        },
      }),
      pipe_tee: node({
        id: 'pipe_tee',
        type: 'pipe-fitting',
        name: 'Atmospheric branch tee',
        parentId: 'level_1',
        metadata: {
          processId: 'refinery_basic_complex',
          processDisplayLabel: 'Refinery',
          stationId: 'atmospheric_distillation',
        },
      }),
      box_shell: node({
        id: 'box_shell',
        type: 'box',
        parentId: 'assembly_tower',
        metadata: {
          processId: 'refinery_basic_complex',
          stationId: 'atmospheric_distillation',
          semanticRole: 'distillation_column_shell',
        },
      }),
      box_ladder: node({
        id: 'box_ladder',
        type: 'box',
        parentId: 'assembly_tower',
        metadata: {
          processId: 'refinery_basic_complex',
          stationId: 'atmospheric_distillation',
          semanticRole: 'helical_ladder',
        },
      }),
    }

    const tree = buildSceneStructure({ nodes, rootNodeIds: ['site_1'] })

    expect(suggestSceneStructureMode(nodes)).toBe('process')
    expect(tree.mode).toBe('process')
    expect(tree.groups).toHaveLength(1)
    expect(tree.groups[0]?.label).toBe('Refinery')
    expect(tree.groups[0]?.detail).toBe('industry.refinery.basic@0.1.0')
    expect(tree.groups[0]?.items).toHaveLength(1)
    expect(tree.groups[0]?.items[0]).toMatchObject({
      nodeId: 'assembly_tower',
      label: 'Atmospheric distillation unit',
      detail: 'station: atmospheric_distillation',
      badge: 'distillation',
    })
  })

  test('keeps building projects available as elevation groups', () => {
    const nodes = {
      site_1: node({ id: 'site_1', type: 'site', children: ['building_1'] }),
      building_1: node({
        id: 'building_1',
        type: 'building',
        children: ['level_0', 'level_1'],
        parentId: 'site_1',
      }),
      level_0: node({
        id: 'level_0',
        type: 'level',
        name: 'Ground',
        children: ['wall_1'],
        parentId: 'building_1',
        level: 0,
      }),
      level_1: node({
        id: 'level_1',
        type: 'level',
        name: 'Mezzanine',
        children: ['item_1'],
        parentId: 'building_1',
        level: 1,
      }),
      wall_1: node({ id: 'wall_1', type: 'wall', name: 'North wall', parentId: 'level_0' }),
      item_1: node({ id: 'item_1', type: 'item', name: 'Desk', parentId: 'level_1' }),
    }

    const tree = buildSceneStructure({ nodes, rootNodeIds: ['site_1'], mode: 'elevation' })

    expect(suggestSceneStructureMode(nodes)).toBe('elevation')
    expect(tree.groups.map((group) => group.label)).toEqual(['Ground', 'Mezzanine'])
    expect(tree.groups.find((group) => group.id === 'level_0')?.items[0]?.nodeId).toBe('wall_1')
    expect(tree.groups.find((group) => group.id === 'level_1')?.items[0]?.nodeId).toBe('item_1')
  })

  test('groups semantic equipment by system and asset source', () => {
    const nodes = {
      assembly_pump: node({
        id: 'assembly_pump',
        type: 'assembly',
        name: 'Feed pump',
        metadata: {
          processId: 'chemical_transfer',
          stationId: 'feed_pump',
          equipmentAssembly: {
            equipmentFamily: 'pump',
            profileId: 'generic.centrifugal_pump',
          },
        },
      }),
      pipe_1: node({ id: 'pipe_1', type: 'pipe', name: 'Transfer pipe' }),
      item_catalog: node({
        id: 'item_catalog',
        type: 'item',
        name: 'Catalog valve',
        metadata: { catalogItemId: 'valve.glb' },
      }),
      item_image: node({
        id: 'item_image',
        type: 'item',
        name: 'Image generated pump',
        metadata: {
          assetSource: {
            kind: 'image-to-3d',
            assetId: 'image-to-3d-pump',
            provider: 'fal',
          },
        },
      }),
      item_articraft: node({
        id: 'item_articraft',
        type: 'item',
        name: 'Joint crane',
        metadata: {
          assetSource: {
            kind: 'articraft',
            assetId: 'articraft-rec_crane',
            recordId: 'rec_crane',
          },
        },
      }),
    }

    const systems = buildSceneStructure({ nodes, mode: 'system' })
    const sources = buildSceneStructure({ nodes, mode: 'asset-source' })

    expect(systems.groups.map((group) => group.label)).toContain('pump equipment')
    expect(systems.groups.map((group) => group.label)).toContain('Piping')
    expect(sources.groups.map((group) => group.label)).toContain('Industry packs')
    expect(sources.groups.map((group) => group.label)).toContain('Catalog assets')
    expect(sources.groups.map((group) => group.label)).toContain('Image-generated assets')
    expect(sources.groups.map((group) => group.label)).toContain('Joint assets')
    expect(sources.groups.find((group) => group.id === 'image-to-3d')?.items[0]?.detail).toBe(
      'fal · image-to-3d-pump',
    )
    expect(sources.groups.find((group) => group.id === 'articraft')?.items[0]?.detail).toBe(
      'Articraft · rec_crane',
    )
  })
})
