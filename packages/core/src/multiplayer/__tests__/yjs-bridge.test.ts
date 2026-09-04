import { describe, it, expect, beforeEach } from 'bun:test'
import * as Y from 'yjs'
import useScene, { clearSceneHistory } from '../../store/use-scene'
import { bindZustandToYjs } from '../yjs-bridge'
import { writeNodeToYMap, readNodeFromYMap } from '../crdt-schema'
import { SiteNode } from '../../schema/nodes/site'
import { BuildingNode } from '../../schema/nodes/building'
import { WallNode } from '../../schema/nodes/wall'
import type { AnyNode, AnyNodeId } from '../../schema/types'

describe('Bidirectional Zustand <-> Yjs Bridge', () => {
  beforeEach(() => {
    clearSceneHistory()
    useScene.getState().setScene({}, [])
  })

  it('should synchronize local Zustand node addition to Y.Doc', () => {
    const doc = new Y.Doc()
    const cleanup = bindZustandToYjs({ doc, sceneStore: useScene })

    const siteNode = SiteNode.parse({
      id: 'site_1',
      children: [],
    })

    useScene.getState().createNode(siteNode)

    const yNodes = doc.getMap<Y.Map<unknown>>('nodes')
    const ySite = yNodes.get('site_1')
    expect(ySite).toBeDefined()
    expect(ySite).toBeInstanceOf(Y.Map)

    const read = readNodeFromYMap(ySite as Y.Map<unknown>)
    expect(read.id).toBe('site_1')
    expect(read.type).toBe('site')

    const yRoots = doc.getArray<string>('rootNodeIds')
    expect(yRoots.toArray()).toContain('site_1')

    cleanup()
  })

  it('should synchronize remote Y.Doc update into Zustand store', () => {
    const doc = new Y.Doc()
    const cleanup = bindZustandToYjs({ doc, sceneStore: useScene })

    // Setup initial site in store and doc
    const siteNode = SiteNode.parse({
      id: 'site_1',
      children: [],
    })
    useScene.getState().createNode(siteNode)

    // Simulate remote building creation
    const bldgNode = BuildingNode.parse({
      id: 'building_1',
      parentId: 'site_1',
      children: [],
    })

    doc.transact(() => {
      const yNodes = doc.getMap<Y.Map<unknown>>('nodes')
      const yBldg = new Y.Map<unknown>()
      yNodes.set('building_1', yBldg)
      writeNodeToYMap(yBldg, bldgNode)

      // Update parent's children array
      const ySite = yNodes.get('site_1')
      if (ySite) {
        writeNodeToYMap(ySite, {
          ...siteNode,
          children: ['building_1'] as any,
        })
      }
    }, 'remote-peer')

    const state = useScene.getState()
    expect(state.nodes.building_1).toBeDefined()
    expect(state.nodes.building_1.id).toBe('building_1')
    expect(state.nodes.building_1.parentId).toBe('site_1')

    cleanup()
  })

  it('should update sub-properties (e.g. metadata) without echo loops', () => {
    const doc = new Y.Doc()
    const cleanup = bindZustandToYjs({ doc, sceneStore: useScene })

    const wallNode = WallNode.parse({
      id: 'wall_1',
      start: [0, 0],
      end: [5, 0],
      height: 3,
      thickness: 0.2,
      metadata: {
        costCode: 'W-01',
      },
    })

    useScene.getState().createNode(wallNode)

    // Update metadata from remote
    doc.transact(() => {
      const yNodes = doc.getMap<Y.Map<unknown>>('nodes')
      const yWall = yNodes.get('wall_1')
      if (yWall) {
        writeNodeToYMap(yWall, {
          ...wallNode,
          metadata: {
            costCode: 'W-02',
            reviewed: true,
          },
        })
      }
    }, 'remote-peer')

    const updated = useScene.getState().nodes.wall_1
    expect(updated?.metadata?.costCode).toBe('W-02')
    expect(updated?.metadata?.reviewed).toBe(true)

    cleanup()
  })

  it('should synchronize remote node deletion cleanly', () => {
    const doc = new Y.Doc()
    const cleanup = bindZustandToYjs({ doc, sceneStore: useScene })

    const wallNode = WallNode.parse({
      id: 'wall_to_delete',
      start: [0, 0],
      end: [5, 0],
      height: 3,
      thickness: 0.2,
    })

    useScene.getState().createNode(wallNode)
    expect(useScene.getState().nodes.wall_to_delete).toBeDefined()

    // Remote deletes wall_to_delete
    doc.transact(() => {
      const yNodes = doc.getMap<Y.Map<unknown>>('nodes')
      yNodes.delete('wall_to_delete')
      const yRoots = doc.getArray<string>('rootNodeIds')
      const idx = yRoots.toArray().indexOf('wall_to_delete')
      if (idx !== -1) {
        yRoots.delete(idx, 1)
      }
    }, 'remote-peer')

    expect(useScene.getState().nodes.wall_to_delete).toBeUndefined()

    cleanup()
  })
})
