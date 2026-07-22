import { describe, expect, test } from 'bun:test'
import type { CollectionId } from '../schema/collections'
import type { AnyNode, AnyNodeId } from '../schema/types'
import {
  cloneLevelSubtree,
  cloneSceneGraph,
  forkSceneGraph,
  type SceneGraph,
} from './clone-scene-graph'

function makeNode(id: string, type: string, extra: Record<string, unknown> = {}): AnyNode {
  return {
    object: 'node',
    id,
    type,
    parentId: null,
    visible: true,
    metadata: {},
    ...extra,
  } as unknown as AnyNode
}

function makeSceneGraph(): SceneGraph {
  const site = makeNode('site_1', 'site', { children: ['level_1'] })
  const level = makeNode('level_1', 'level', {
    parentId: 'site_1',
    children: ['wall_1', 'scan_1', 'guide_1'],
  })
  const wall = makeNode('wall_1', 'wall', { parentId: 'level_1' })
  const scan = makeNode('scan_1', 'scan', { parentId: 'level_1', url: 'scan.glb' })
  const guide = makeNode('guide_1', 'guide', { parentId: 'level_1', url: 'guide.png' })

  return {
    nodes: {
      ['site_1' as AnyNodeId]: site,
      ['level_1' as AnyNodeId]: level,
      ['wall_1' as AnyNodeId]: wall,
      ['scan_1' as AnyNodeId]: scan,
      ['guide_1' as AnyNodeId]: guide,
    },
    rootNodeIds: ['site_1' as AnyNodeId],
    collections: {
      ['collection_1' as CollectionId]: {
        id: 'collection_1' as CollectionId,
        name: 'References',
        nodeIds: ['scan_1', 'guide_1'] as AnyNodeId[],
      },
    },
    installedPlugins: ['pascal:trees'],
  }
}

describe('forkSceneGraph', () => {
  test('strips scan and guide nodes by default', () => {
    const forked = forkSceneGraph(makeSceneGraph())
    const nodes = Object.values(forked.nodes)

    expect(nodes.some((node) => node.type === 'scan')).toBe(false)
    expect(nodes.some((node) => node.type === 'guide')).toBe(false)
    expect(nodes.some((node) => node.type === 'wall')).toBe(true)
    expect(forked.collections).toEqual({})
    expect(forked.installedPlugins).toEqual(['pascal:trees'])
  })

  test('preserves scan and guide nodes when requested', () => {
    const forked = forkSceneGraph(makeSceneGraph(), { preserveScans: true })
    const nodes = Object.values(forked.nodes)

    expect(nodes.some((node) => node.type === 'scan')).toBe(true)
    expect(nodes.some((node) => node.type === 'guide')).toBe(true)
    expect(nodes.map((node) => node.id)).not.toContain('scan_1')
    expect(nodes.map((node) => node.id)).not.toContain('guide_1')
    expect(
      Object.values(forked.collections ?? {}).flatMap((collection) => collection.nodeIds),
    ).toHaveLength(2)
    expect(forked.installedPlugins).toEqual(['pascal:trees'])
  })
})

describe('construction-dimension clone references', () => {
  function sceneWithControlledDimensions(): SceneGraph {
    const site = makeNode('site_1', 'site', { children: ['level_1'] })
    const level = makeNode('level_1', 'level', {
      parentId: 'site_1',
      children: ['construction-dimension_foundation', 'construction-dimension_floor'],
    })
    const controller = makeNode('construction-dimension_foundation', 'construction-dimension', {
      name: 'Foundation controller',
      parentId: 'level_1',
      anchors: [
        [0, 0, 0],
        [4, 0, 0],
      ],
      controllingDimensionId: null,
    })
    const dependent = makeNode('construction-dimension_floor', 'construction-dimension', {
      name: 'Floor dependent',
      parentId: 'level_1',
      anchors: [
        [0, 0, 0],
        [4, 0, 0],
      ],
      controllingDimensionId: controller.id,
    })
    return {
      nodes: {
        [site.id]: site,
        [level.id]: level,
        [controller.id]: controller,
        [dependent.id]: dependent,
      },
      rootNodeIds: [site.id],
    }
  }

  test('remaps controller IDs in whole-scene clones', () => {
    const cloned = cloneSceneGraph(sceneWithControlledDimensions())
    const dimensions = Object.values(cloned.nodes).filter(
      (node) => node.type === 'construction-dimension',
    )
    const controller = dimensions.find((node) => node.name === 'Foundation controller')
    const dependent = dimensions.find((node) => node.name === 'Floor dependent')

    expect(controller?.type).toBe('construction-dimension')
    expect(dependent?.type).toBe('construction-dimension')
    if (
      controller?.type === 'construction-dimension' &&
      dependent?.type === 'construction-dimension'
    ) {
      expect(dependent.controllingDimensionId).toBe(controller.id)
    }
  })

  test('remaps controller IDs in level-subtree clones', () => {
    const scene = sceneWithControlledDimensions()
    const cloned = cloneLevelSubtree(scene.nodes, 'level_1' as AnyNodeId)
    const dimensions = cloned.clonedNodes.filter((node) => node.type === 'construction-dimension')
    const controller = dimensions.find((node) => node.name === 'Foundation controller')
    const dependent = dimensions.find((node) => node.name === 'Floor dependent')

    expect(controller?.type).toBe('construction-dimension')
    expect(dependent?.type).toBe('construction-dimension')
    if (
      controller?.type === 'construction-dimension' &&
      dependent?.type === 'construction-dimension'
    ) {
      expect(dependent.controllingDimensionId).toBe(controller.id)
    }
  })
})

describe('drawing-sheet clone references', () => {
  test('remaps placed levels and nested sheet identities in whole-scene clones', () => {
    const level = makeNode('level_main', 'level')
    const sheet = makeNode('drawing-sheet_a101', 'drawing-sheet', {
      placedViews: [{ id: 'drawing-view_main', levelId: level.id }],
      generalNoteSetIds: [],
      generalNoteSets: [],
      generalNotes: [],
      keyedNoteDefinitions: [{ id: 'keyed-note_a', key: 'A', text: 'NOTE' }],
      keyedNoteInstances: [
        {
          id: 'keyed-note-instance_a',
          definitionId: 'keyed-note_a',
          placedViewId: 'drawing-view_main',
          position: [1, 1],
        },
      ],
      keyedNoteLegend: [],
      documentMarkers: [],
      schedules: [],
    })
    const cloned = cloneSceneGraph({
      nodes: { [level.id]: level, [sheet.id]: sheet },
      rootNodeIds: [level.id, sheet.id] as AnyNodeId[],
    })
    const clonedLevel = Object.values(cloned.nodes).find((node) => node.type === 'level')
    const clonedSheet = Object.values(cloned.nodes).find((node) => node.type === 'drawing-sheet')

    expect(clonedLevel).toBeDefined()
    expect(clonedSheet?.type).toBe('drawing-sheet')
    if (clonedLevel && clonedSheet?.type === 'drawing-sheet') {
      expect(clonedSheet.placedViews[0]?.levelId).toBe(clonedLevel.id)
      expect(clonedSheet.placedViews[0]?.id).not.toBe('drawing-view_main')
      expect(clonedSheet.keyedNoteInstances[0]?.definitionId).toBe(
        clonedSheet.keyedNoteDefinitions[0]?.id,
      )
      expect(clonedSheet.keyedNoteInstances[0]?.placedViewId).toBe(clonedSheet.placedViews[0]?.id)
    }
  })
})

describe('supportSlabId remap', () => {
  test('cloneSceneGraph remaps supportSlabId to the cloned slab id', () => {
    const level = makeNode('level_1', 'level', { children: ['slab_1', 'item_1'] })
    const slab = makeNode('slab_1', 'slab', { parentId: 'level_1' })
    const item = makeNode('item_1', 'item', { parentId: 'level_1', supportSlabId: 'slab_1' })

    const cloned = cloneSceneGraph({
      nodes: {
        ['level_1' as AnyNodeId]: level,
        ['slab_1' as AnyNodeId]: slab,
        ['item_1' as AnyNodeId]: item,
      },
      rootNodeIds: ['level_1' as AnyNodeId],
    })

    const clonedSlab = Object.values(cloned.nodes).find((node) => node.type === 'slab')!
    const clonedItem = Object.values(cloned.nodes).find((node) => node.type === 'item')!
    expect(clonedSlab.id).not.toBe('slab_1')
    expect((clonedItem as { supportSlabId?: string }).supportSlabId).toBe(clonedSlab.id)
  })

  test('cloneLevelSubtree remaps in-subtree hosts and preserves external references', () => {
    const level = makeNode('level_1', 'level', { children: ['slab_1', 'item_1', 'item_2'] })
    const slab = makeNode('slab_1', 'slab', { parentId: 'level_1' })
    const hosted = makeNode('item_1', 'item', { parentId: 'level_1', supportSlabId: 'slab_1' })
    const external = makeNode('item_2', 'item', {
      parentId: 'level_1',
      supportSlabId: 'slab_external',
    })

    const { clonedNodes, idMap } = cloneLevelSubtree(
      {
        ['level_1' as AnyNodeId]: level,
        ['slab_1' as AnyNodeId]: slab,
        ['item_1' as AnyNodeId]: hosted,
        ['item_2' as AnyNodeId]: external,
      },
      'level_1' as AnyNodeId,
    )

    const clonedHosted = clonedNodes.find((node) => node.id === idMap.get('item_1'))!
    const clonedExternal = clonedNodes.find((node) => node.id === idMap.get('item_2'))!
    expect((clonedHosted as { supportSlabId?: string }).supportSlabId).toBe(idMap.get('slab_1')!)
    expect((clonedExternal as { supportSlabId?: string }).supportSlabId).toBe('slab_external')
  })
})
