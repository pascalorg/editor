import { describe, expect, test } from 'bun:test'
import type {
  AnyNode,
  AnyNodeId,
  BeamNode as BeamNodeType,
  EditorApi,
  HandleDescriptor,
  LinearResizeHandle,
  SceneApi,
  TapActionHandle,
} from '@pascal-app/core'
import { beamDefinition } from './definition'
import { BeamNode } from './schema'

function beamFixture(): { beam: BeamNodeType; sceneApi: SceneApi } {
  const beam = BeamNode.parse({
    id: 'beam_handles',
    parentId: 'level_main',
    start: [0, 0],
    end: [4, 0],
    width: 0.3,
    depth: 0.6,
    elevation: 3,
  })
  const nodes: Record<AnyNodeId, AnyNode> = { [beam.id]: beam }
  const sceneApi = {
    get: <N extends AnyNode = AnyNode>(id: AnyNodeId) => nodes[id] as N | undefined,
    nodes: () => nodes,
    update: (id: AnyNodeId, patch: Partial<AnyNode>) => {
      nodes[id] = { ...nodes[id], ...patch } as AnyNode
    },
    markDirty: () => {},
  } as SceneApi
  return { beam, sceneApi }
}

const editorApi: EditorApi = {
  engageMove: () => {},
  engageMoveDrag: () => {},
  engageEndpointMove: () => {},
  engageControlPointMove: () => {},
  engageTangentMove: () => {},
}

const buildHandles = beamDefinition.handles as (
  node: BeamNodeType,
  sceneApi: SceneApi,
) => HandleDescriptor<BeamNodeType>[]

describe('beam 3D handles', () => {
  test('emits the five handle set: depth arrow, two side moves, two corner pickers', () => {
    const { beam, sceneApi } = beamFixture()
    const handles = buildHandles(beam, sceneApi)

    expect(handles).toHaveLength(5)
    expect(handles.map((handle) => handle.kind).sort()).toEqual([
      'linear-resize',
      'tap-action',
      'tap-action',
      'tap-action',
      'tap-action',
    ])

    const depth = handles.find(
      (handle): handle is LinearResizeHandle<BeamNodeType> => handle.kind === 'linear-resize',
    )!
    expect(depth.axis).toBe('y')
    expect(depth.anchor).toBe('min')
    expect(depth.min).toBe(0.2)
    expect(depth.measureLabel).toBe('depth')
    expect(depth.currentValue(beam)).toBeCloseTo(0.6)
    // Depth arrow grows upward from the soffit, over the beam midpoint.
    const depthPos = depth.placement.position(beam)
    expect(depthPos[0]).toBeCloseTo(2)
    expect(depthPos[1]).toBeCloseTo(3 + 0.6 + 0.45)
    expect(depthPos[2]).toBeCloseTo(0)

    const pickers = handles.filter(
      (handle): handle is TapActionHandle<BeamNodeType> =>
        handle.kind === 'tap-action' && handle.shape === 'corner-picker',
    )
    expect(pickers).toHaveLength(2)
    const sideMoves = handles.filter(
      (handle): handle is TapActionHandle<BeamNodeType> =>
        handle.kind === 'tap-action' && handle.shape !== 'corner-picker',
    )
    expect(sideMoves).toHaveLength(2)
  })

  test('depth apply grows the beam depth and floors at the minimum', () => {
    const { beam, sceneApi } = beamFixture()
    const depth = buildHandles(beam, sceneApi).find(
      (handle): handle is LinearResizeHandle<BeamNodeType> => handle.kind === 'linear-resize',
    )!

    const grown = depth.apply(beam, 0.9, sceneApi)
    expect(grown.depth).toBeCloseTo(0.9)

    const floored = depth.apply(beam, 0.05, sceneApi)
    expect(floored.depth).toBeCloseTo(0.05) // apply is raw; `min` gates the drag
  })

  test('corner pickers sit on the endpoints and route to the matching endpoint drag', () => {
    const { beam, sceneApi } = beamFixture()
    const pickers = buildHandles(beam, sceneApi).filter(
      (handle): handle is TapActionHandle<BeamNodeType> =>
        handle.kind === 'tap-action' && handle.shape === 'corner-picker',
    )

    const startPicker = pickers.find(
      (handle) =>
        handle.placement.position(beam)[0] === 0 && handle.placement.position(beam)[2] === 0,
    )!
    const endPicker = pickers.find(
      (handle) =>
        handle.placement.position(beam)[0] === 4 && handle.placement.position(beam)[2] === 0,
    )!
    // Leader spans the beam depth; disc sits at the soffit.
    expect(startPicker.nodeHeight?.(beam)).toBeCloseTo(0.6)
    expect(startPicker.placement.position(beam)[1]).toBeCloseTo(3)
    expect(endPicker.placement.position(beam)[1]).toBeCloseTo(3)

    const engaged: Array<{ node: AnyNode; endpoint?: 'start' | 'end' }> = []
    const editor: EditorApi = {
      ...editorApi,
      engageEndpointMove: (node, endpoint) => engaged.push({ node, endpoint }),
    }
    startPicker.onActivate(beam, sceneApi, editor)
    endPicker.onActivate(beam, sceneApi, editor)
    expect(engaged.map((entry) => entry.endpoint)).toEqual(['start', 'end'])
  })

  test('side-move arrows clear the body width and hand the beam to its move tool', () => {
    const { beam, sceneApi } = beamFixture()
    const sideMoves = buildHandles(beam, sceneApi).filter(
      (handle): handle is TapActionHandle<BeamNodeType> =>
        handle.kind === 'tap-action' && handle.shape !== 'corner-picker',
    )
    const front = sideMoves.find((handle) => handle.placement.position(beam)[2] > 0)!
    const back = sideMoves.find((handle) => handle.placement.position(beam)[2] < 0)!
    const offset = Math.max(0.3 / 2 + 0.27, 0.33)
    expect(front.placement.position(beam)[2]).toBeCloseTo(offset)
    expect(back.placement.position(beam)[2]).toBeCloseTo(-offset)
    // Both arrows sit at the body's mid-height.
    expect(front.placement.position(beam)[1]).toBeCloseTo(3 + 0.3)
    expect(back.placement.position(beam)[1]).toBeCloseTo(3 + 0.3)

    const engaged: AnyNode[] = []
    const editor: EditorApi = { ...editorApi, engageMove: (node) => engaged.push(node) }
    front.onActivate(beam, sceneApi, editor)
    expect(engaged).toHaveLength(1)
    expect(engaged[0]?.id).toBe(beam.id)
  })
})
