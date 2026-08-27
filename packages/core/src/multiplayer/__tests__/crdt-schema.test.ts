import { describe, it, expect } from 'bun:test'
import * as Y from 'yjs'
import {
  initializeSceneDoc,
  writeNodeToYMap,
  readNodeFromYMap,
  reconcileYArray,
  snapshotToYDoc,
  yDocToSnapshot,
} from '../crdt-schema'
import type { AnyNode } from '../../schema/types'
import type { SceneSnapshot } from '../../store/history-control'

describe('CRDT Schema & Serialization', () => {
  it('should initialize typed CRDT structures on a Y.Doc', () => {
    const doc = new Y.Doc()
    const schema = initializeSceneDoc(doc)

    expect(schema.nodes).toBeInstanceOf(Y.Map)
    expect(schema.rootNodeIds).toBeInstanceOf(Y.Array)
    expect(schema.materials).toBeInstanceOf(Y.Map)
    expect(schema.collections).toBeInstanceOf(Y.Map)
    expect(schema.installedPlugins).toBeInstanceOf(Y.Array)
    expect(schema.sceneMetadata).toBeInstanceOf(Y.Map)
  })

  it('should write and read nodes with sub-properties (slots, metadata)', () => {
    const doc = new Y.Doc()
    const yNodes = doc.getMap<Y.Map<unknown>>('nodes')
    let yNode: Y.Map<unknown>

    doc.transact(() => {
      yNode = new Y.Map<unknown>()
      yNodes.set('wall_1', yNode)
    })

    const wallNode: AnyNode = {
      id: 'wall_1' as any,
      type: 'wall' as any,
      object: 'node' as any,
      parentId: 'level_1' as any,
      start: [0, 0],
      end: [10, 0],
      height: 3,
      thickness: 0.2,
      slots: {
        interior: 'scene:mat_white',
        exterior: 'scene:mat_brick',
      },
      metadata: {
        costCode: 'W-100',
        phase: 2,
      },
    }

    doc.transact(() => {
      writeNodeToYMap(yNode, wallNode)
    })

    // Check nested structures
    const ySlots = yNode.get('slots')
    expect(ySlots).toBeInstanceOf(Y.Map)
    expect((ySlots as Y.Map<unknown>).get('interior')).toBe('scene:mat_white')

    const readBack = readNodeFromYMap(yNode)
    expect(readBack.id).toBe('wall_1')
    expect(readBack.type).toBe('wall')
    expect(readBack.slots?.interior).toBe('scene:mat_white')
    expect(readBack.slots?.exterior).toBe('scene:mat_brick')
    expect(readBack.metadata?.costCode).toBe('W-100')
    expect(readBack.metadata?.phase).toBe(2)
  })

  it('should handle property updates and field removals in writeNodeToYMap', () => {
    const doc = new Y.Doc()
    const yNodes = doc.getMap<Y.Map<unknown>>('nodes')
    let yNode: Y.Map<unknown>

    doc.transact(() => {
      yNode = new Y.Map<unknown>()
      yNodes.set('item_1', yNode)
    })

    const nodeV1: AnyNode = {
      id: 'item_1' as any,
      type: 'item' as any,
      object: 'node' as any,
      parentId: 'level_1' as any,
      position: [1, 2, 3],
      metadata: {
        color: 'red',
        tag: 'furniture',
      },
    }

    doc.transact(() => {
      writeNodeToYMap(yNode, nodeV1)
    })

    const nodeV2: AnyNode = {
      id: 'item_1' as any,
      type: 'item' as any,
      object: 'node' as any,
      parentId: 'level_1' as any,
      position: [5, 2, 3],
      metadata: {
        color: 'blue',
      },
    }

    doc.transact(() => {
      writeNodeToYMap(yNode, nodeV2)
    })

    const readBack = readNodeFromYMap(yNode)
    expect(readBack.position).toEqual([5, 2, 3])
    expect(readBack.metadata?.color).toBe('blue')
    expect(readBack.metadata?.tag).toBeUndefined()
  })

  it('should reconcile Y.Array non-destructively', () => {
    const doc = new Y.Doc()
    const yArray = doc.getArray<string>('test_array')

    yArray.insert(0, ['node_1', 'node_2', 'node_3'])

    // Target has node_2 removed and node_4 added at the end
    reconcileYArray(yArray, ['node_1', 'node_3', 'node_4'])
    expect(yArray.toArray()).toEqual(['node_1', 'node_3', 'node_4'])

    // Target with reordered elements
    reconcileYArray(yArray, ['node_4', 'node_1', 'node_3'])
    expect(yArray.toArray()).toEqual(['node_4', 'node_1', 'node_3'])
  })

  it('should perform full round-trip snapshotToYDoc and yDocToSnapshot', () => {
    const doc = new Y.Doc()
    const snapshot: SceneSnapshot = {
      nodes: {
        site_1: {
          id: 'site_1' as any,
          type: 'site' as any,
          object: 'node' as any,
          parentId: null,
          children: ['bldg_1'] as any,
        } as AnyNode,
        bldg_1: {
          id: 'bldg_1' as any,
          type: 'building' as any,
          object: 'node' as any,
          parentId: 'site_1' as any,
          children: [] as any,
        } as AnyNode,
      },
      rootNodeIds: ['site_1' as any],
      materials: {
        'mat_1': { id: 'mat_1', name: 'Material 1', color: '#ff0000' } as any,
      },
      collections: {
        'col_1': { id: 'col_1', name: 'Collection 1', nodeIds: ['site_1'] } as any,
      },
      installedPlugins: ['plugin-warehouse'],
    }

    snapshotToYDoc(snapshot, doc)
    const retrieved = yDocToSnapshot(doc)

    expect(retrieved.rootNodeIds).toEqual(['site_1' as any])
    expect(retrieved.nodes.site_1.id).toBe('site_1' as any)
    expect(retrieved.nodes.bldg_1.parentId).toBe('site_1' as any)
    expect(retrieved.materials.mat_1.name).toBe('Material 1')
    expect(retrieved.collections.col_1.name).toBe('Collection 1')
    expect(retrieved.installedPlugins).toEqual(['plugin-warehouse'])
  })
})
