import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  analyzePortConnectivity,
  LevelNode,
  PipeFittingNode,
  registerNode,
  useScene,
} from '@pascal-app/core'
import { collectScenePorts } from '@pascal-app/editor/distribution'
import { pipeFittingDefinition } from '../pipe-fitting/definition'
import { DWV_PORT_SYSTEMS } from '../shared/port-systems'
import { pipeSegmentDefinition } from './definition'
import { pipeUpdatesPreserveGrades } from './grade-operation'
import { type PipeRunMoveKind, planPipeRunMoveFrame, startPipeRunMove } from './run-move'
import { PipeSegmentNode } from './schema'

type Vec3 = [number, number, number]

const LEVEL_ID = 'level_run-move' as AnyNodeId
const SOUTH_ID = 'pipe-segment_south' as AnyNodeId
const ACROSS: PipeRunMoveKind = { axis: 'horizontal', dir: [0, 1] }
const UP: PipeRunMoveKind = { axis: 'y' }

const elbow = (id: string, position: Vec3, rotationY: number) =>
  PipeFittingNode.parse({
    ...pipeFittingDefinition.defaults(),
    id,
    parentId: LEVEL_ID,
    position,
    rotation: [0, rotationY, 0],
  })
const pipe = (id: string, path: Vec3[]) =>
  PipeSegmentNode.parse({ ...pipeSegmentDefinition.defaults(), id, parentId: LEVEL_ID, path })

/** A closed vent loop draining to its north-west corner: the west and north legs fall 8 cm. */
function ventLoop(): Record<string, AnyNode> {
  const nodes = [
    pipe(SOUTH_ID, [
      [0.07, 1, 0],
      [3.93, 1, 0],
    ]),
    elbow('pipe-fitting_se', [4, 1, 0], 0),
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
  const level = LevelNode.parse({
    id: LEVEL_ID,
    level: 0,
    height: 3,
    children: nodes.map((node) => node.id),
  })
  return Object.fromEntries([level, ...nodes].map((node) => [node.id, node]))
}

function arrowMove(kind: PipeRunMoveKind) {
  const nodesById = ventLoop()
  useScene.setState({ nodes: nodesById, rootNodeIds: [LEVEL_ID] } as never)
  const south = nodesById[SOUTH_ID] as PipeSegmentNode
  return {
    nodesById,
    args: {
      pipe: south,
      kind,
      connectivity: analyzePortConnectivity(south as AnyNode, nodesById),
      scenePorts: collectScenePorts({ excludeNodeId: SOUTH_ID, systems: DWV_PORT_SYSTEMS }),
      nodesById,
    },
  }
}

describe('arrow move of a selected pipe run', () => {
  let previous: ReturnType<typeof useScene.getState>['nodes']
  beforeEach(() => {
    previous = useScene.getState().nodes
    registerNode(pipeSegmentDefinition)
    registerNode(pipeFittingDefinition)
  })
  afterEach(() => {
    useScene.setState({ nodes: previous })
  })

  test('a move that would stretch a sloped leg is blocked rather than previewed', () => {
    const { args } = arrowMove(ACROSS)
    for (const delta of [-0.1, 0.2]) {
      expect(planPipeRunMoveFrame({ ...args, delta }).status).toBe('blocked')
    }
  })

  test('an offset move previews the fittings and trims it commits', () => {
    const { args, nodesById } = arrowMove(ACROSS)
    const frame = planPipeRunMoveFrame({ ...args, delta: -0.5 })
    if (frame.status !== 'valid') throw new Error(`expected a valid frame, got ${frame.status}`)
    expect(frame.change.create.length).toBeGreaterThan(0)
    expect(frame.ghost?.tint).toBe('valid')
    expect([...frame.ghost!.fittings, ...frame.ghost!.risers]).toEqual(
      frame.change.create as never[],
    )
    expect(frame.preview).toEqual(frame.change.update)
    expect(pipeUpdatesPreserveGrades(nodesById, frame.change.update)).toBe(true)
  })

  test('release commits the frame on screen, not the refused cursor position', () => {
    const { args } = arrowMove(ACROSS)
    const move = startPipeRunMove(args)
    const shown = move.update(-0.5)
    expect(shown.status).toBe('valid')
    expect(move.update(-0.1).status).toBe('blocked')
    expect(move.update(0.2).status).toBe('blocked')
    expect(move.release()).toBe(shown.status === 'valid' ? shown.change : null)
  })

  test('a lift the offset cannot form shows red and commits nothing', () => {
    const { args } = arrowMove(UP)
    const move = startPipeRunMove(args)
    expect(move.update(0.5).status).toBe('valid')
    const frame = move.update(0.1)
    expect(frame.status).toBe('invalid')
    expect(frame.status === 'invalid' && frame.ghost.tint).toBe('invalid')
    expect(move.release()).toBeNull()
  })

  test('a move back to the start commits nothing', () => {
    const { args } = arrowMove({ axis: 'horizontal', dir: [1, 0] })
    const move = startPipeRunMove(args)
    expect(move.update(0.5).status).toBe('valid')
    expect(move.update(0).status).toBe('valid')
    expect(move.release()).toBeNull()
  })
})
