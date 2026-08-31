import { beforeEach, describe, expect, test } from 'bun:test'
import { type AnyNode, getRoofSegmentSurfaceY, type RoofSegmentNode } from '../schema'
import useScene from './use-scene'

describe('scene window migrations', () => {
  beforeEach(() => {
    useScene.setState({
      nodes: {},
      rootNodeIds: [],
      dirtyNodes: new Set(),
      collections: {},
    } as never)
    useScene.temporal.getState().clear()
  })

  test('fills schema defaults on windows saved before a field existed', () => {
    // Mirrors real legacy scenes (e.g. windows persisted without
    // columnRatios/rowRatios/frameThickness): the mesh builder reads those
    // unconditionally, so a missing array crashed the viewer every frame.
    useScene.getState().setScene(
      {
        site_test: {
          object: 'node',
          id: 'site_test',
          type: 'site',
          parentId: null,
          visible: true,
          metadata: {},
          children: ['building_test'],
        },
        building_test: {
          object: 'node',
          id: 'building_test',
          type: 'building',
          parentId: 'site_test',
          visible: true,
          metadata: {},
          children: ['level_test'],
        },
        level_test: {
          object: 'node',
          id: 'level_test',
          type: 'level',
          parentId: 'building_test',
          visible: true,
          metadata: {},
          children: ['wall_test'],
          level: 0,
        },
        wall_test: {
          object: 'node',
          id: 'wall_test',
          type: 'wall',
          parentId: 'level_test',
          visible: true,
          metadata: {},
          children: ['window_test'],
          start: [0, 0],
          end: [4, 0],
          height: 2.5,
          thickness: 0.2,
        },
        window_test: {
          object: 'node',
          id: 'window_test',
          type: 'window',
          parentId: 'wall_test',
          visible: true,
          metadata: {},
          wallId: 'wall_test',
          position: [1, 1, 0],
          width: 1.2,
          height: 1.5,
          windowType: 'fixed',
        },
      } as unknown as Record<string, AnyNode>,
      ['site_test'] as never,
    )

    const window = useScene.getState().nodes.window_test as Extract<AnyNode, { type: 'window' }>
    expect(window).toBeDefined()
    // Schema defaults land on load…
    expect(window.columnRatios).toEqual([1])
    expect(window.rowRatios).toEqual([1])
    expect(window.frameThickness).toBe(0.05)
    expect(window.sill).toBe(true)
    // …and authored fields survive.
    expect(window.width).toBe(1.2)
    expect(window.height).toBe(1.5)
    expect(window.wallId).toBe('wall_test')
  })

  test('promotes a legacy dormer window into a hosted window child', () => {
    useScene.getState().setScene(
      {
        dormer_test: {
          object: 'node',
          id: 'dormer_test',
          type: 'dormer',
          parentId: null,
          visible: true,
          metadata: {},
          roofSegmentId: 'segment_test',
          width: 3,
          depth: 2,
          wallSkirtHeight: 2.5,
          windowWidth: 0.8,
          windowHeight: 1.2,
          windowOffsetX: 0.4,
          windowOffsetY: 1,
          windowColumns: 2,
          windowRows: 3,
        },
      } as unknown as Record<string, AnyNode>,
      ['dormer_test'] as never,
    )

    const dormer = useScene.getState().nodes.dormer_test as Extract<AnyNode, { type: 'dormer' }>
    const childId = dormer.children[0]
    const window = useScene.getState().nodes[childId] as Extract<AnyNode, { type: 'window' }>

    expect(childId).toMatch(/^window_test_default/)
    expect(window.parentId).toBe('dormer_test')
    expect(window.dormerId).toBe('dormer_test')
    expect(window.dormerFace).toBe('front')
    expect(window.position).toEqual([0.4, -0.25, 0])
    expect(window.columnRatios).toEqual([1, 1])
    expect(window.rowRatios).toEqual([1, 1, 1])
  })

  test('puts the promoted window on the exposed dormer face', () => {
    const segment = {
      object: 'node',
      id: 'rseg_test',
      type: 'roof-segment',
      parentId: null,
      visible: true,
      metadata: {},
      children: ['dormer_test'],
      position: [0, 0, 0],
      rotation: 0,
      roofType: 'gable',
      width: 8,
      depth: 6,
      wallHeight: 0.5,
      pitch: 40,
      wallThickness: 0.1,
      deckThickness: 0.1,
      overhang: 0.3,
      shingleThickness: 0.05,
    } as RoofSegmentNode
    const dormerY = getRoofSegmentSurfaceY(segment, 0, -1.5)

    useScene.getState().setScene(
      {
        rseg_test: segment,
        dormer_test: {
          object: 'node',
          id: 'dormer_test',
          type: 'dormer',
          parentId: 'rseg_test',
          visible: true,
          metadata: {},
          roofSegmentId: 'rseg_test',
          position: [0, dormerY, -1.5],
          rotation: 0,
        },
      } as unknown as Record<string, AnyNode>,
      ['rseg_test'] as never,
    )

    const dormer = useScene.getState().nodes.dormer_test as Extract<AnyNode, { type: 'dormer' }>
    const window = useScene.getState().nodes[dormer.children[0]] as Extract<
      AnyNode,
      { type: 'window' }
    >
    expect(window.dormerFace).toBe('back')
  })

  test('does not recreate an intentionally empty dormer window list', () => {
    useScene.getState().setScene(
      {
        dormer_test: {
          object: 'node',
          id: 'dormer_test',
          type: 'dormer',
          parentId: null,
          visible: true,
          metadata: {},
          children: [],
        },
      } as unknown as Record<string, AnyNode>,
      ['dormer_test'] as never,
    )

    const dormer = useScene.getState().nodes.dormer_test as Extract<AnyNode, { type: 'dormer' }>
    expect(dormer.children).toEqual([])
  })
})
