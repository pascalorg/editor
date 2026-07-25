import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeDefinition,
  type AnyNodeId,
  CabinetModuleNode,
  type CabinetModuleNode as CabinetModuleNodeType,
  CabinetNode,
  type CabinetNode as CabinetNodeType,
  type LevelNode,
  MeasurementNode,
  nodeRegistry,
  registerNode,
  SceneMaterial,
  type SceneMaterialId,
  useScene,
  WallNode,
  WindowNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { z } from 'zod'
import {
  copySelectedNodesToEditorClipboard,
  getEditorClipboardSnapshot,
  pasteEditorClipboardToLevel,
  pasteSystemEditorClipboardToLevel,
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
    materials: {},
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

  // The plugin-kind test registers a definition; drop it so it can't leak into
  // any other test's registry lookups.
  afterEach(() => {
    nodeRegistry._reset()
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

  test('detaches a standalone copied opening so its move tool can rehost it', () => {
    const wall = WallNode.parse({
      id: 'wall_clipboard-window-host',
      parentId: sourceLevelId,
      start: [0, 0],
      end: [3, 0],
    })
    const window = WindowNode.parse({
      id: 'window_clipboard-standalone',
      parentId: wall.id,
      wallId: wall.id,
      position: [1.5, 1.2, 0],
    })
    useScene.setState((state) => ({
      nodes: {
        ...state.nodes,
        [sourceLevelId]: makeLevel(sourceLevelId, [wall.id]),
        [wall.id]: { ...wall, children: [window.id] },
        [window.id]: window,
      },
    }))

    expect(copySelectedNodesToEditorClipboard([window.id])).toBe(true)
    const result = pasteEditorClipboardToLevel(targetLevelId)
    expect(result?.pastedIds).toHaveLength(1)

    const pastedWindow = result?.pastedIds[0]
      ? useScene.getState().nodes[result.pastedIds[0]]
      : undefined
    expect(pastedWindow?.type).toBe('window')
    if (pastedWindow?.type === 'window') {
      expect(pastedWindow.parentId).toBe(targetLevelId)
      expect(pastedWindow.wallId).toBeUndefined()
      expect(pastedWindow.roofSegmentId).toBeUndefined()
    }
  })

  test('round-trips nodes and custom scene materials through the browser clipboard', async () => {
    let systemClipboardText = ''
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        readText: async () => systemClipboardText,
        writeText: async (text: string) => {
          systemClipboardText = text
        },
      },
    })

    const materialId = 'mat_clipboard-blue' as SceneMaterialId
    const material = SceneMaterial.parse({
      id: materialId,
      name: 'Clipboard blue',
      material: { properties: { color: '#2266dd' } },
    })
    const wall = WallNode.parse({
      id: 'wall_clipboard-material',
      parentId: sourceLevelId,
      start: [0, 0],
      end: [3, 0],
      slots: { exterior: `scene:${materialId}` },
    })
    useScene.setState((state) => ({
      materials: { [materialId]: material },
      nodes: {
        ...state.nodes,
        [sourceLevelId]: makeLevel(sourceLevelId, [wall.id]),
        [wall.id]: wall,
      },
    }))

    expect(copySelectedNodesToEditorClipboard([wall.id])).toBe(true)
    expect(systemClipboardText).toContain('pascal.scene-nodes')

    useScene.setState({
      materials: {},
      nodes: {
        [targetLevelId]: makeLevel(targetLevelId),
      },
      rootNodeIds: [targetLevelId],
    } as never)
    useViewer.getState().setSelection({ levelId: targetLevelId, selectedIds: [] })

    const result = await pasteSystemEditorClipboardToLevel()
    expect(result?.pastedIds).toHaveLength(1)
    expect(result?.createdMaterialIds).toEqual([materialId])
    expect(useScene.getState().materials[materialId]).toEqual(material)

    const pastedWall = Object.values(useScene.getState().nodes).find((node) => node.type === 'wall')
    expect(pastedWall?.type).toBe('wall')
    if (pastedWall?.type === 'wall') {
      expect(pastedWall.slots?.exterior).toBe(`scene:${materialId}`)
    }
  })

  test('duplicates a plugin-contributed kind that AnyNode cannot describe', () => {
    // `AnyNode` is a hand-maintained union of built-in kinds, so a plugin kind
    // can never be a member of it — the registry validates those against
    // `def.schema` instead. Registering one here reproduces exactly what a
    // plugin does at load time; before the registry fallback this copy threw
    // `invalid_union / no matching discriminator` and duplicate silently failed
    // for every plugin, including the first-party trees pack.
    const PluginNode = z.object({
      object: z.literal('node').default('node'),
      id: z.string(),
      type: z.literal('warehouse:pallet').default('warehouse:pallet'),
      name: z.string().optional(),
      parentId: z.string().nullable().default(null),
      visible: z.boolean().optional().default(true),
      metadata: z.json().optional().default({}),
      position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
      rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
      preset: z.string().default('epal-1'),
    })
    registerNode({
      kind: 'warehouse:pallet',
      schemaVersion: 1,
      schema: PluginNode,
      category: 'furnish',
      defaults: () => ({}),
      capabilities: { duplicable: true, deletable: true },
    } as unknown as AnyNodeDefinition)

    const pluginNodeId = 'warehouse-pallet_clipboard' as AnyNodeId
    const pluginNode = PluginNode.parse({
      id: pluginNodeId,
      parentId: sourceLevelId,
      position: [2, 0, 1],
      preset: 'epal-2',
    }) as unknown as AnyNode
    useScene.setState((state) => ({
      nodes: {
        ...state.nodes,
        [sourceLevelId]: makeLevel(sourceLevelId, [pluginNodeId]),
        [pluginNodeId]: pluginNode,
      },
    }))

    expect(copySelectedNodesToEditorClipboard([pluginNodeId])).toBe(true)

    const result = pasteEditorClipboardToLevel(targetLevelId)
    expect(result?.pastedIds).toHaveLength(1)

    const pastedId = result?.pastedIds[0]
    const pasted = pastedId ? useScene.getState().nodes[pastedId] : undefined
    expect(pasted?.type).toBe('warehouse:pallet')
    expect(pasted?.id).not.toBe(pluginNodeId)
    expect(pasted?.parentId).toBe(targetLevelId)
    // The registry schema — not `AnyNode` — is what validated it, so kind-owned
    // fields have to survive the round trip.
    expect((pasted as unknown as { preset?: string } | undefined)?.preset).toBe('epal-2')
  })

  test('waits for an in-flight copy before reading the browser clipboard', async () => {
    let systemClipboardText = 'older clipboard contents'
    let finishWrite!: () => void
    const readText = mock(async () => systemClipboardText)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        readText,
        writeText: (text: string) =>
          new Promise<void>((resolve) => {
            finishWrite = () => {
              systemClipboardText = text
              resolve()
            }
          }),
      },
    })

    expect(copySelectedNodesToEditorClipboard([runId])).toBe(true)
    const paste = pasteSystemEditorClipboardToLevel(targetLevelId)
    await Promise.resolve()
    expect(readText).not.toHaveBeenCalled()

    finishWrite()
    const result = await paste
    expect(readText).toHaveBeenCalledTimes(1)
    expect(result?.pastedIds).toHaveLength(1)
  })
})
