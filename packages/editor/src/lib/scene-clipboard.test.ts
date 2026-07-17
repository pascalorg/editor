import { beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  CabinetModuleNode,
  type CabinetModuleNode as CabinetModuleNodeType,
  CabinetNode,
  type CabinetNode as CabinetNodeType,
  type LevelNode,
  MeasurementNode,
  useScene,
  WallNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import {
  copySelectedNodesToEditorClipboard,
  getEditorClipboardSnapshot,
  pasteEditorClipboardToLevel,
} from './scene-clipboard'

const sourceLevelId = 'level_clipboard-source' as LevelNode['id']
const targetLevelId = 'level_clipboard-target' as LevelNode['id']
const runId = 'cabinet_clipboard-run' as CabinetNodeType['id']
const leftModuleId = 'cabinet-module_clipboard-left' as CabinetModuleNodeType['id']
const rightModuleId = 'cabinet-module_clipboard-right' as CabinetModuleNodeType['id']

function makeLevel(id: AnyNodeId, children: AnyNodeId[] = []): AnyNode {
  return {
    id,
    type: 'level',
    object: 'node',
    visible: true,
    name: '',
    metadata: {},
    position: [0, 0, 0],
    rotation: 0,
    parentId: null,
    level: 0,
    children,
  } as unknown as AnyNode
}

function seedCabinetRun() {
  const sourceLevel = makeLevel(sourceLevelId, [runId])
  const targetLevel = makeLevel(targetLevelId)
  const run = CabinetNode.parse({
    id: runId,
    parentId: sourceLevelId,
    position: [1, 0, 2],
    rotation: 0,
    children: [leftModuleId, rightModuleId],
    withCountertop: true,
    showPlinth: true,
  })
  const leftModule = CabinetModuleNode.parse({
    id: leftModuleId,
    parentId: runId,
    position: [-0.45, 0.1, 0],
    width: 0.9,
    showPlinth: false,
    withCountertop: false,
  })
  const rightModule = CabinetModuleNode.parse({
    id: rightModuleId,
    parentId: runId,
    position: [0.45, 0.1, 0],
    width: 0.9,
    showPlinth: false,
    withCountertop: false,
  })

  useScene.setState({
    nodes: {
      [sourceLevel.id]: sourceLevel,
      [targetLevel.id]: targetLevel,
      [run.id]: run as AnyNode,
      [leftModule.id]: leftModule as AnyNode,
      [rightModule.id]: rightModule as AnyNode,
    },
    rootNodeIds: [sourceLevel.id, targetLevel.id],
  } as never)
  useViewer.getState().setSelection({
    levelId: sourceLevelId,
    selectedIds: [],
  })
}

function isPastedCabinetRun(node: AnyNode): node is CabinetNodeType {
  return node.type === 'cabinet' && node.id !== runId
}

function pastedCabinetRun() {
  return Object.values(useScene.getState().nodes).find(isPastedCabinetRun)
}

describe('scene clipboard', () => {
  beforeEach(() => {
    seedCabinetRun()
    useScene.temporal.getState().clear()
  })

  test('copies a selected cabinet run as one subtree instead of independent modules', () => {
    const copied = copySelectedNodesToEditorClipboard([runId, leftModuleId, rightModuleId])

    expect(copied).toBe(true)
    expect(getEditorClipboardSnapshot()?.rootIds).toEqual([runId])

    const result = pasteEditorClipboardToLevel(targetLevelId)
    expect(result?.pastedIds).toHaveLength(1)

    const pastedRun = pastedCabinetRun()
    expect(pastedRun).toBeDefined()
    expect(pastedRun?.parentId).toBe(targetLevelId)
    expect(pastedRun?.children).toHaveLength(2)

    for (const childId of pastedRun?.children ?? []) {
      const child = useScene.getState().nodes[childId as AnyNodeId]
      expect(child?.type).toBe('cabinet-module')
      expect(child?.parentId).toBe(pastedRun?.id)
    }

    const sourceRun = useScene.getState().nodes[runId]
    expect(sourceRun?.type).toBe('cabinet')
    expect((sourceRun as CabinetNodeType | undefined)?.children).toEqual([
      leftModuleId,
      rightModuleId,
    ] satisfies CabinetModuleNodeType['id'][])
  })

  test('promotes a complete module selection to the cabinet run before copying', () => {
    const copied = copySelectedNodesToEditorClipboard([leftModuleId, rightModuleId])

    expect(copied).toBe(true)
    expect(getEditorClipboardSnapshot()?.rootIds).toEqual([runId])

    const result = pasteEditorClipboardToLevel(targetLevelId)
    expect(result?.pastedIds).toHaveLength(1)
    expect(pastedCabinetRun()?.children).toHaveLength(2)
  })

  test('remaps a measurement association when its host is copied with it', () => {
    const wall = WallNode.parse({
      id: 'wall_clipboard-host',
      type: 'wall',
      parentId: sourceLevelId,
      start: [0, 0],
      end: [3, 0],
    })
    const measurement = MeasurementNode.parse({
      id: 'measurement_clipboard-associated',
      type: 'measurement',
      parentId: sourceLevelId,
      measurement: {
        kind: 'distance',
        points: [
          {
            kind: 'feature',
            reference: { nodeId: wall.id, featureId: 'wall:face:left', parameters: { t: 0 } },
            fallback: [0, 0, 0],
          },
          [3, 0, 0],
        ],
      },
    })
    useScene.setState((state) => ({
      nodes: {
        ...state.nodes,
        [sourceLevelId]: makeLevel(sourceLevelId, [wall.id, measurement.id]),
        [wall.id]: wall,
        [measurement.id]: measurement,
      },
    }))

    expect(copySelectedNodesToEditorClipboard([wall.id, measurement.id])).toBe(true)
    expect(pasteEditorClipboardToLevel(targetLevelId)?.pastedIds).toHaveLength(2)

    const pastedWall = Object.values(useScene.getState().nodes).find(
      (node) => node.type === 'wall' && node.id !== wall.id,
    )
    const pastedMeasurement = Object.values(useScene.getState().nodes).find(
      (node) => node.type === 'measurement' && node.id !== measurement.id,
    )
    expect(pastedWall?.type).toBe('wall')
    expect(pastedMeasurement?.type).toBe('measurement')
    if (
      pastedWall?.type !== 'wall' ||
      pastedMeasurement?.type !== 'measurement' ||
      pastedMeasurement.measurement.kind !== 'distance'
    ) {
      return
    }
    const anchor = pastedMeasurement.measurement.points[0]
    expect(Array.isArray(anchor)).toBe(false)
    if (!Array.isArray(anchor)) expect(anchor.reference.nodeId).toBe(pastedWall.id)
  })
})
