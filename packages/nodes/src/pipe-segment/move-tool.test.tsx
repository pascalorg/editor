import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  clearSceneHistory,
  emitter,
  LevelNode,
  PipeFittingNode,
  registerNode,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { getMovingNode, useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { act, create } from '@react-three/test-renderer'
import { isValidElement, type ReactNode } from 'react'
import type { Mesh, MeshBasicMaterial } from 'three'
import { pipeFittingDefinition } from '../pipe-fitting/definition'
import { INVALID_GHOST_COLOR } from '../shared/ghost-materials'
import { pipeSegmentDefinition } from './definition'
import { MovePipeSegmentTool } from './move-tool'
import { PipeSegmentNode } from './schema'
import { pipeGrade } from './slope'

type Vec3 = [number, number, number]
type Renderer = Awaited<ReturnType<typeof create>>

const LEVEL_ID = 'level_pipe-move' as AnyNodeId
const SOUTH_ID = 'pipe-segment_south' as AnyNodeId
const SOUTH_EAST_ID = 'pipe-fitting_se' as AnyNodeId
const GHOST_HEX = 0x81_8c_f8

function elbow(id: string, position: Vec3, rotationY: number) {
  return PipeFittingNode.parse({
    ...pipeFittingDefinition.defaults(),
    id,
    parentId: LEVEL_ID,
    position,
    rotation: [0, rotationY, 0],
  })
}

function pipe(id: string, path: Vec3[]) {
  return PipeSegmentNode.parse({
    ...pipeSegmentDefinition.defaults(),
    id,
    parentId: LEVEL_ID,
    path,
  })
}

// The south leg runs level along x from the south-west corner to the south-east elbow.
const southLeg = () =>
  pipe(SOUTH_ID, [
    [0.07, 1, 0],
    [3.93, 1, 0],
  ])
const southEastElbow = () => elbow(SOUTH_EAST_ID, [4, 1, 0], 0)

/** An open branch: the south-east elbow turns into a free run falling 8 cm along z. */
function slopedBranch(): AnyNode[] {
  return [
    southLeg(),
    southEastElbow(),
    pipe('pipe-segment_branch', [
      [4, 1, 0.07],
      [4, 0.92, 3.93],
    ]),
  ]
}

/** A closed vent loop draining to its north-west corner: the west and north legs fall 8 cm. */
function ventLoop(): AnyNode[] {
  return [
    southLeg(),
    southEastElbow(),
    pipe('pipe-segment_east', [
      [4, 1, 0.07],
      [4, 1, 3.93],
    ]),
    elbow('pipe-fitting_ne', [4, 1, 4], -Math.PI / 2),
    pipe('pipe-segment_north', [
      [0.07, 0.92, 4],
      [3.93, 1, 4],
    ]),
    elbow('pipe-fitting_nw', [0, 0.92, 4], Math.PI),
    pipe('pipe-segment_west', [
      [0, 1, 0.07],
      [0, 0.92, 3.93],
    ]),
    elbow('pipe-fitting_sw', [0, 1, 0], Math.PI / 2),
  ]
}

function loadScene(nodes: AnyNode[]) {
  const level = LevelNode.parse({
    id: LEVEL_ID,
    level: 0,
    height: 3,
    children: nodes.map((node) => node.id),
  })
  useScene.setState({
    nodes: Object.fromEntries([level, ...nodes].map((node) => [node.id, node])),
    rootNodeIds: [LEVEL_ID],
    dirtyNodes: new Set<AnyNodeId>(),
    collections: {},
    materials: {},
    readOnly: false,
  } as never)
  clearSceneHistory()
}

let notices: ReactNode[] = []
let html: ReturnType<typeof spyOn>

beforeEach(() => {
  registerNode(pipeSegmentDefinition)
  registerNode(pipeFittingDefinition)
  // Snapping off: the drag delta is exactly the cursor offset.
  const modes = useEditor.getState().snappingModeByContext
  useEditor.setState({
    mode: 'select',
    magneticSnap: false,
    snappingModeByContext: Object.fromEntries(
      Object.keys(modes).map((context) => [context, 'off']),
    ),
  } as never)
  notices = []
  // The refusal notice is a DOM label; there is no DOM here.
  html = spyOn(
    Html as unknown as { render: (props: { children: ReactNode }) => ReactNode },
    'render',
  ).mockImplementation((props) => {
    notices.push(props.children)
    return null
  })
})

afterEach(() => {
  html.mockRestore()
  useLiveNodeOverrides.getState().clearAll()
  clearSceneHistory()
})

async function armMove(id: AnyNodeId) {
  const node = useScene.getState().nodes[id]!
  useEditor.getState().setMovingNode(node)
  useViewer.setState({
    selection: { buildingId: null, levelId: LEVEL_ID, zoneId: null, selectedIds: [id] },
  } as never)
  let renderer: Renderer | null = null
  await act(async () => {
    renderer = await create(<MovePipeSegmentTool node={node} />)
  })
  // The tool ignores clicks in its first 150 ms (the click that armed it).
  await new Promise((resolve) => setTimeout(resolve, 160))
  return renderer!
}

/** Moves the cursor so the south leg's centre (2, 0) lands at (x, z). */
async function moveTo(x: number, z: number) {
  await act(async () => {
    emitter.emit('grid:move', {
      position: [x, 0, z],
      localPosition: [x, 0, z],
      nativeEvent: {},
    } as never)
  })
}

async function click() {
  const stopPropagation = mock(() => {})
  await act(async () => {
    emitter.emit('grid:click', {
      position: [0, 0, 0],
      localPosition: [0, 0, 0],
      nativeEvent: { stopPropagation },
    } as never)
  })
  return stopPropagation
}

function ghostColors(renderer: Renderer) {
  return renderer.scene
    .findAll((node) => (node.instance as Mesh).geometry?.type === 'CylinderGeometry')
    .map((node) => ((node.instance as Mesh).material as MeshBasicMaterial).color.getHex())
}

function noticeText() {
  const notice = notices.at(-1)
  return isValidElement<{ children?: ReactNode }>(notice) ? String(notice.props.children) : null
}

function expectPoint(actual: readonly number[] | undefined, expected: Vec3) {
  expect(actual).toHaveLength(3)
  for (const [axis, value] of expected.entries()) expect(actual![axis]).toBeCloseTo(value, 9)
}

describe('pipe run move', () => {
  test('a move that keeps every connected grade lands with its followers in one undo step', async () => {
    loadScene(slopedBranch())
    const before = structuredClone(useScene.getState().nodes)
    const renderer = await armMove(SOUTH_ID)
    try {
      await moveTo(2, 0.5)
      expect(ghostColors(renderer)).toEqual([GHOST_HEX])
      expect(notices).toEqual([])
      expect(await click()).toHaveBeenCalledTimes(1)
    } finally {
      await act(async () => renderer.unmount())
    }

    const nodes = useScene.getState().nodes
    const moved = nodes[SOUTH_ID] as PipeSegmentNode
    expectPoint(moved.path[0], [0.07, 1, 0.5])
    expectPoint(moved.path[1], [3.93, 1, 0.5])
    expectPoint((nodes[SOUTH_EAST_ID] as PipeFittingNode).position, [4, 1, 0.5])
    const branch = (nodes['pipe-segment_branch' as AnyNodeId] as PipeSegmentNode).path
    expectPoint(branch[0], [4, 1, 0.57])
    expect(pipeGrade(branch[0]!, branch[1]!)).toBeCloseTo(
      pipeGrade([4, 1, 0.07], [4, 0.92, 3.93])!,
      9,
    )
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    expect(useScene.temporal.getState().isTracking).toBe(true)

    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes).toEqual(before)
  })

  test('a move that would regrade a connected pipe stays live, says why, and cancels cleanly', async () => {
    loadScene(ventLoop())
    const before = structuredClone(useScene.getState().nodes)
    const renderer = await armMove(SOUTH_ID)
    try {
      // Every loop leg is held at both ends, so carrying the south leg north
      // tilts the sloped west leg between its fixed corner heights.
      await moveTo(2, 0.5)
      expect(ghostColors(renderer)).toEqual([INVALID_GHOST_COLOR])
      expect(noticeText()).toContain('would change a connected pipe’s grade')

      const stopPropagation = await click()
      expect(stopPropagation).toHaveBeenCalledTimes(1)
      expect(useScene.getState().nodes).toEqual(before)
      expect(getMovingNode()?.id).toBe(SOUTH_ID)
      // The drag still owns history until it is placed or cancelled.
      expect(useScene.temporal.getState().isTracking).toBe(false)

      notices = []
      await moveTo(2, 0)
      expect(ghostColors(renderer)).toEqual([GHOST_HEX])
      expect(notices).toEqual([])

      await act(async () => {
        emitter.emit('tool:cancel')
      })
      expect(getMovingNode()).toBeNull()
    } finally {
      await act(async () => renderer.unmount())
    }

    expect(useScene.getState().nodes).toEqual(before)
    expect(useScene.temporal.getState().isTracking).toBe(true)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    expect(useLiveNodeOverrides.getState().overrides.size).toBe(0)
  })
})
