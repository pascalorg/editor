import { describe, expect, test } from 'bun:test'
import type { CollectionId } from '../schema/collections'
import type { CommentId, CommentReplyId } from '../schema/comments'
import type { DefinitionId } from '../schema/definitions'
import type { SavedViewId } from '../schema/saved-views'
import type { SceneMaterialId } from '../schema/scene-material'
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
    materials: {
      ['mat_1' as SceneMaterialId]: {
        id: 'mat_1',
        name: 'Oak',
        material: { preset: 'wood' },
      },
    },
    installedPlugins: ['pascal:trees'],
  }
}

describe('scene material palette', () => {
  // Nodes reference materials through `slots` values shaped `scene:mat_…`.
  // Those are opaque strings to the node remapping, so the ids they point at
  // have to survive a clone unchanged or every reference dangles.
  test('cloneSceneGraph carries materials over with their ids intact', () => {
    const source = makeSceneGraph()
    const cloned = cloneSceneGraph(source)

    expect(cloned.materials).toEqual(source.materials)
  })

  test('cloneSceneGraph deep-copies materials', () => {
    const source = makeSceneGraph()
    const cloned = cloneSceneGraph(source)
    const material = cloned.materials?.['mat_1' as SceneMaterialId]
    expect(material).toBeDefined()
    if (!material) return

    material.name = 'Mutated'
    expect(source.materials?.['mat_1' as SceneMaterialId]?.name).toBe('Oak')
  })

  // A palette entry is authored content in its own right. Stripping the scan
  // node that happened to use it must not take the material with it.
  test('forkSceneGraph keeps materials when stripping scans', () => {
    const source = makeSceneGraph()
    const forked = forkSceneGraph(source)

    expect(forked.materials).toEqual(source.materials)
  })
})

describe('component definition clone references', () => {
  function sceneWithDefinition(): SceneGraph {
    const site = makeNode('site_1', 'site', { children: ['level_1'] })
    const level = makeNode('level_1', 'level', {
      parentId: 'site_1',
      children: ['instance_1'],
    })
    const source = makeNode('shelf_source', 'shelf', { children: [] })
    const instance = makeNode('instance_1', 'instance', {
      parentId: 'level_1',
      definitionId: 'definition_balcony',
      position: [2, 0, 3],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    })
    return {
      nodes: {
        [site.id]: site,
        [level.id]: level,
        [source.id]: source,
        [instance.id]: instance,
      },
      rootNodeIds: [site.id],
      definitions: {
        ['definition_balcony' as DefinitionId]: {
          id: 'definition_balcony',
          name: 'Balcony A',
          rootNodeId: source.id,
        },
      },
    }
  }

  test('cloneSceneGraph remaps definition ids, roots, and instance references together', () => {
    const cloned = cloneSceneGraph(sceneWithDefinition())
    const definition = Object.values(cloned.definitions ?? {})[0]!
    const instance = Object.values(cloned.nodes).find((node) => node.type === 'instance')

    expect(definition.id).not.toBe('definition_balcony')
    expect(definition.rootNodeId).not.toBe('shelf_source')
    expect(cloned.nodes[definition.rootNodeId]).toBeDefined()
    expect(instance?.type).toBe('instance')
    if (instance?.type === 'instance') expect(instance.definitionId).toBe(definition.id)
  })

  test('forkSceneGraph carries definitions through its clone boundary', () => {
    const forked = forkSceneGraph(sceneWithDefinition())
    const definition = Object.values(forked.definitions ?? {})[0]!
    const instance = Object.values(forked.nodes).find((node) => node.type === 'instance')

    expect(forked.nodes[definition.rootNodeId]).toBeDefined()
    expect(instance?.type).toBe('instance')
    if (instance?.type === 'instance') expect(instance.definitionId).toBe(definition.id)
  })
})

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

describe('saved view clone references', () => {
  function graphWithSavedView(): SceneGraph {
    const base = makeSceneGraph()
    return {
      ...base,
      nodes: {
        ...base.nodes,
        ['section-plane_1' as AnyNodeId]: makeNode('section-plane_1', 'section-plane', {
          parentId: 'level_1',
          active: true,
        }),
      },
      savedViews: {
        ['saved-view_1' as SavedViewId]: {
          id: 'saved-view_1' as SavedViewId,
          name: 'Entry',
          order: 0,
          camera: {
            position: [10, 10, 10],
            target: [0, 0, 0],
            projection: 'perspective',
          },
          sectionPlaneId: 'section-plane_1' as AnyNodeId,
          collectionStates: {
            ['collection_1' as CollectionId]: { visible: false },
          },
          presentation: { viewMode: 'split' },
        },
      },
    }
  }

  test('cloneSceneGraph mints a fresh view id and keeps the payload', () => {
    const cloned = cloneSceneGraph(graphWithSavedView())
    const views = Object.values(cloned.savedViews ?? {})

    expect(views).toHaveLength(1)
    const view = views[0]
    expect(view).toBeDefined()
    if (!view) return
    expect(view.id).not.toBe('saved-view_1')
    expect(view.id.startsWith('saved-view_')).toBe(true)
    // The record key and the entry's own id must agree, or lookups miss.
    expect(cloned.savedViews?.[view.id]).toBe(view)
    expect(view.name).toBe('Entry')
    expect(view.presentation).toEqual({ viewMode: 'split' })
  })

  test('remaps the section-plane reference onto the cloned node', () => {
    const cloned = cloneSceneGraph(graphWithSavedView())
    const view = Object.values(cloned.savedViews ?? {})[0]

    expect(view).toBeDefined()
    if (!view?.sectionPlaneId) throw new Error('expected a remapped section plane')
    expect(view.sectionPlaneId).not.toBe('section-plane_1')
    // It has to point at a node that actually exists in the clone.
    expect(cloned.nodes[view.sectionPlaneId]?.type).toBe('section-plane')
  })

  test('remaps collection-state keys onto the cloned collections', () => {
    const cloned = cloneSceneGraph(graphWithSavedView())
    const view = Object.values(cloned.savedViews ?? {})[0]
    const clonedCollectionIds = Object.keys(cloned.collections ?? {})

    expect(view).toBeDefined()
    if (!view) return
    const stateKeys = Object.keys(view.collectionStates ?? {})
    expect(stateKeys).toHaveLength(1)
    expect(stateKeys[0]).not.toBe('collection_1')
    expect(clonedCollectionIds).toContain(stateKeys[0] as string)
    expect(view.collectionStates?.[stateKeys[0] as CollectionId]).toEqual({ visible: false })
  })

  test('a view whose section plane did not survive the fork records "no cut"', () => {
    const base = graphWithSavedView()
    // Point the view at the scan node, which `forkSceneGraph` strips.
    const scanView = {
      ...Object.values(base.savedViews ?? {})[0]!,
      sectionPlaneId: 'scan_1' as AnyNodeId,
    }
    const forked = forkSceneGraph({
      ...base,
      savedViews: { [scanView.id]: scanView },
    })

    const view = Object.values(forked.savedViews ?? {})[0]
    expect(view).toBeDefined()
    expect(view?.sectionPlaneId).toBeNull()
  })

  test('forkSceneGraph carries saved views through its clone boundary', () => {
    const forked = forkSceneGraph(graphWithSavedView())
    expect(Object.values(forked.savedViews ?? {})).toHaveLength(1)
  })

  test('a graph without saved views clones without inventing the key', () => {
    const cloned = cloneSceneGraph(makeSceneGraph())
    expect(cloned.savedViews).toBeUndefined()
  })
})

describe('comment clone references', () => {
  function graphWithComments(): SceneGraph {
    const base = makeSceneGraph()
    return {
      ...base,
      comments: {
        ['comment_pinned' as CommentId]: {
          id: 'comment_pinned' as CommentId,
          anchor: { kind: 'node', nodeId: 'wall_1' as AnyNodeId, offset: [0, 1.2, 0] },
          author: { name: 'Ada' },
          body: 'Bu duvar çok ince',
          createdAt: '2026-08-01T09:00:00.000Z',
          levelId: 'level_1' as AnyNodeId,
          replies: [
            {
              id: 'comment-reply_1' as CommentReplyId,
              author: { name: 'Bo' },
              body: '20 cm yapalım',
              createdAt: '2026-08-01T10:00:00.000Z',
            },
          ],
        },
        ['comment_loose' as CommentId]: {
          id: 'comment_loose' as CommentId,
          anchor: { kind: 'point', position: [3, 0, 4] },
          author: { name: 'Ada' },
          body: 'Burada bir giriş olmalı',
          createdAt: '2026-08-02T09:00:00.000Z',
          replies: [],
        },
      },
    }
  }

  test('cloneSceneGraph mints a fresh thread id and keeps the payload', () => {
    const cloned = cloneSceneGraph(graphWithComments())
    const threads = Object.values(cloned.comments ?? {})

    expect(threads).toHaveLength(2)
    for (const thread of threads) {
      expect(thread.id.startsWith('comment_')).toBe(true)
      expect(thread.id).not.toBe('comment_pinned')
      expect(thread.id).not.toBe('comment_loose')
      // The record key and the entry's own id must agree, or lookups miss.
      expect(cloned.comments?.[thread.id]).toBe(thread)
    }

    const pinned = threads.find((thread) => thread.anchor.kind === 'node')
    expect(pinned?.body).toBe('Bu duvar çok ince')
    expect(pinned?.replies).toHaveLength(1)
    expect(pinned?.replies[0]?.body).toBe('20 cm yapalım')
  })

  test('remaps a node anchor and its level onto the cloned nodes', () => {
    const cloned = cloneSceneGraph(graphWithComments())
    const pinned = Object.values(cloned.comments ?? {}).find(
      (thread) => thread.anchor.kind === 'node',
    )

    expect(pinned).toBeDefined()
    if (pinned?.anchor.kind !== 'node') throw new Error('expected a node anchor')
    expect(pinned.anchor.nodeId).not.toBe('wall_1')
    expect(cloned.nodes[pinned.anchor.nodeId]?.type).toBe('wall')
    expect(pinned.anchor.offset).toEqual([0, 1.2, 0])
    expect(pinned.levelId).not.toBe('level_1')
    expect(cloned.nodes[pinned.levelId as AnyNodeId]?.type).toBe('level')
  })

  test('a point anchor survives the clone untouched', () => {
    const cloned = cloneSceneGraph(graphWithComments())
    const loose = Object.values(cloned.comments ?? {}).find(
      (thread) => thread.anchor.kind === 'point',
    )

    if (loose?.anchor.kind !== 'point') throw new Error('expected a point anchor')
    expect(loose.anchor.position).toEqual([3, 0, 4])
  })

  test('a thread pinned to a node the fork stripped is dropped, not left dangling', () => {
    const base = graphWithComments()
    const orphan = {
      ...Object.values(base.comments ?? {})[0]!,
      id: 'comment_onscan' as CommentId,
      anchor: { kind: 'node', nodeId: 'scan_1' as AnyNodeId } as const,
    }
    const forked = forkSceneGraph({
      ...base,
      comments: { ...base.comments, [orphan.id]: orphan },
    })

    const threads = Object.values(forked.comments ?? {})
    expect(threads).toHaveLength(2)
    for (const thread of threads) {
      if (thread.anchor.kind !== 'node') continue
      expect(forked.nodes[thread.anchor.nodeId]).toBeDefined()
    }
  })

  test('forkSceneGraph carries comments through its clone boundary', () => {
    const forked = forkSceneGraph(graphWithComments())
    expect(Object.values(forked.comments ?? {})).toHaveLength(2)
  })

  test('a graph without comments clones without inventing the key', () => {
    const cloned = cloneSceneGraph(makeSceneGraph())
    expect(cloned.comments).toBeUndefined()
  })
})
