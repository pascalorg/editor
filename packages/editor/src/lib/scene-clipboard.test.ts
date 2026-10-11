import { beforeEach, describe, expect, mock, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  CabinetModuleNode,
  type CabinetModuleNode as CabinetModuleNodeType,
  CabinetNode,
  type CabinetNode as CabinetNodeType,
  type CollectionId,
  ColumnNode,
  configureArtifactStore,
  getArtifactStore,
  ItemNode,
  type LevelNode,
  MeasurementNode,
  SceneMaterial,
  type SceneMaterialId,
  SlabNode,
  useScene,
  WallNode,
  WindowNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import {
  bringBuildArtifacts,
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

function copyScriptedWindow(projectId: string | null = 'project_clipboard-source') {
  let text = ''
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      readText: async () => text,
      writeText: async (value: string) => {
        text = value
      },
    },
  })
  const node = WindowNode.parse({
    id: 'window_clipboard-scripted',
    parentId: sourceLevelId,
    source: {
      kind: 'script',
      script: 'a'.repeat(64),
      artifact: 'b'.repeat(64),
      manifest: { bounds: { min: [0, 0, 0], max: [1, 1, 1] }, triangles: 12 },
    },
  })
  useScene.setState((state) => ({
    nodes: {
      ...state.nodes,
      [node.id]: node,
      [sourceLevelId]: makeLevel(sourceLevelId, [node.id]),
    },
  }))
  useViewer.getState().setProjectId(projectId)
  expect(copySelectedNodesToEditorClipboard([node.id])).toBe(true)
  useViewer.getState().setProjectId('project_clipboard-target')
  return node
}

describe('scene clipboard', () => {
  beforeEach(() => {
    seedCabinetRun()
    useScene.temporal.getState().clear()
  })

  test('leaves derived room surfaces out of a group copy while retaining authored slabs', () => {
    const derived = SlabNode.parse({
      parentId: sourceLevelId,
      boundary: 'auto',
      autoFromWalls: true,
      plateRole: 'base',
      polygon: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
    })
    const manual = SlabNode.parse({
      parentId: sourceLevelId,
      polygon: [
        [5, 0],
        [7, 0],
        [7, 2],
        [5, 2],
      ],
    })
    useScene.setState((state) => ({
      nodes: {
        ...state.nodes,
        [derived.id]: derived,
        [manual.id]: manual,
      },
    }))
    expect(copySelectedNodesToEditorClipboard([runId, derived.id, manual.id])).toBe(true)
    expect(getEditorClipboardSnapshot()?.rootIds).toEqual([runId, manual.id])
    expect(getEditorClipboardSnapshot()?.nodes.some((node) => node.id === derived.id)).toBe(false)
    const result = pasteEditorClipboardToLevel(targetLevelId)
    expect(result?.pastedIds).toHaveLength(2)
    expect(
      Object.values(useScene.getState().nodes).filter(
        (node) => node.type === 'slab' && node.parentId === targetLevelId,
      ),
    ).toHaveLength(1)
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

  test('windows pasted with their wall fit under its top, sill at the floor when taller', () => {
    const wall = WallNode.parse({
      id: 'wall_clipboard-low',
      parentId: sourceLevelId,
      start: [0, 0],
      end: [6, 0],
      height: 2.5,
    })
    const fanlight = WindowNode.parse({
      id: 'window_clipboard-fanlight',
      parentId: wall.id,
      wallId: wall.id,
      position: [1, 1.8, 0],
      height: 1.5,
    })
    const scripted = WindowNode.parse({
      id: 'window_clipboard-tall-script',
      parentId: wall.id,
      wallId: wall.id,
      position: [4, 2, 0],
      height: 1,
      source: {
        kind: 'script',
        script: 'a'.repeat(64),
        artifact: 'b'.repeat(64),
        manifest: { bounds: { min: [-0.5, 0, -0.1], max: [0.5, 3, 0.1] }, triangles: 12 },
      },
    })
    useScene.setState((state) => ({
      nodes: {
        ...state.nodes,
        [sourceLevelId]: makeLevel(sourceLevelId, [wall.id]),
        [wall.id]: { ...wall, children: [fanlight.id, scripted.id] },
        [fanlight.id]: fanlight,
        [scripted.id]: scripted,
      },
    }))

    expect(copySelectedNodesToEditorClipboard([wall.id])).toBe(true)
    const pastedWallId = pasteEditorClipboardToLevel(targetLevelId)!.pastedIds[0]!
    const pasted = useScene.getState().nodes[pastedWallId] as WallNode
    const [fanlightY, scriptedY] = pasted.children.map(
      (id) => (useScene.getState().nodes[id as AnyNodeId] as WindowNode).position[1],
    )
    expect(fanlightY).toBeCloseTo(2.5 - 1.5 / 2)
    expect(scriptedY).toBeCloseTo(3 / 2)
  })

  test('a paste keeps collection membership on both sides in one undo step, or drops collections the scene lacks', () => {
    const collectionId = 'collection_clipboard-lighting' as CollectionId
    const lamp = ItemNode.parse({
      id: 'item_clipboard-lamp',
      parentId: sourceLevelId,
      asset: { id: 'lamp', name: 'Lamp', category: 'lighting', thumbnail: '', src: 'asset://lamp' },
      collectionIds: [collectionId],
    })
    const lighting = { id: collectionId, name: 'Lighting', nodeIds: [lamp.id] }
    useScene.setState((state) => ({
      collections: { [collectionId]: lighting },
      nodes: {
        ...state.nodes,
        [sourceLevelId]: makeLevel(sourceLevelId, [lamp.id]),
        [lamp.id]: lamp,
      },
    }))
    expect(copySelectedNodesToEditorClipboard([lamp.id])).toBe(true)

    const pastedId = pasteEditorClipboardToLevel(targetLevelId)!.pastedIds[0]!
    expect(useScene.getState().nodes[pastedId]).toMatchObject({ collectionIds: [collectionId] })
    expect(useScene.getState().collections[collectionId]?.nodeIds).toEqual([lamp.id, pastedId])
    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes[pastedId]).toBeUndefined()
    expect(useScene.getState().collections[collectionId]).toEqual(lighting)

    useScene.setState({ collections: {} })
    const elsewhereId = pasteEditorClipboardToLevel(targetLevelId)!.pastedIds[0]!
    expect(useScene.getState().nodes[elsewhereId]).toMatchObject({ collectionIds: [] })
    expect(useScene.getState().collections).toEqual({})
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

  test('a paste from another project brings its scripted nodes artifacts, or leaves the node out', async () => {
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
    const scripted = (id: string, script: string, artifact: string) =>
      WindowNode.parse({
        id,
        parentId: sourceLevelId,
        position: [0, 1.2, 0],
        source: {
          kind: 'script',
          script: script.repeat(64),
          artifact: artifact.repeat(64),
          manifest: { bounds: { min: [-0.5, 0, -0.1], max: [0.5, 1, 0.1] }, triangles: 12 },
        },
      })
    const readable = scripted('window_clipboard-readable', 'a', 'c')
    const unreadable = scripted('window_clipboard-unreadable', 'b', 'd')
    useScene.setState((state) => ({
      nodes: {
        ...state.nodes,
        [sourceLevelId]: makeLevel(sourceLevelId, [readable.id, unreadable.id]),
        [readable.id]: readable,
        [unreadable.id]: unreadable,
      },
    }))
    useViewer.getState().setProjectId('project_clipboard-source')
    expect(copySelectedNodesToEditorClipboard([readable.id, unreadable.id])).toBe(true)

    useViewer.getState().setProjectId('project_clipboard-target')
    // The source project can no longer be read: neither its geometry nor its code comes.
    const copyFrom = mock(async (_projectId: string, _sha256s: string[]) => [
      unreadable.source!.script,
      unreadable.source!.artifact,
    ])
    const previousStore = getArtifactStore()
    configureArtifactStore({ ...previousStore, copyFrom })
    try {
      const result = await pasteSystemEditorClipboardToLevel(targetLevelId)
      expect(copyFrom).toHaveBeenCalledTimes(1)
      expect(copyFrom.mock.calls[0]![0]).toBe('project_clipboard-source')
      expect(new Set(copyFrom.mock.calls[0]![1])).toEqual(
        new Set([
          readable.source!.script,
          readable.source!.artifact,
          unreadable.source!.script,
          unreadable.source!.artifact,
        ]),
      )
      expect(result?.refusedIds).toEqual([unreadable.id])
      expect(result?.refusal).toBe('no-access')
      expect(result?.pastedIds).toHaveLength(1)
      const pasted = useScene.getState().nodes[result!.pastedIds[0]!]
      expect(pasted?.type === 'window' && pasted.source?.artifact).toBe(readable.source!.artifact)
    } finally {
      configureArtifactStore(previousStore)
      useViewer.getState().setProjectId(null)
    }
  })

  test('navigation during artifact copy does not paste into the next project', async () => {
    copyScriptedWindow()
    const previousStore = getArtifactStore()
    const started = Promise.withResolvers<void>()
    const copied = Promise.withResolvers<string[]>()
    configureArtifactStore({
      ...previousStore,
      copyFrom: async () => {
        started.resolve()
        return copied.promise
      },
    })
    try {
      const pending = pasteSystemEditorClipboardToLevel(targetLevelId)
      await started.promise
      useViewer.getState().setProjectId('project_clipboard-next')
      copied.resolve([])
      expect(await pending).toBeNull()
      expect((useScene.getState().nodes[targetLevelId] as LevelNode).children).toEqual([])
    } finally {
      configureArtifactStore(previousStore)
      useViewer.getState().setProjectId(null)
    }
  })

  test('a local paste refuses missing artifacts and keeps objects whose artifacts are available', async () => {
    const node = copyScriptedWindow()
    const previousStore = getArtifactStore()
    const present = new Set<string>()
    configureArtifactStore({
      ...previousStore,
      copyFrom: undefined,
      url: (sha) => (present.has(sha) ? `artifact://${sha}` : null),
    })
    try {
      const missing = await pasteSystemEditorClipboardToLevel(targetLevelId)
      expect(missing?.refusedIds).toEqual([node.id])
      expect(missing?.pastedIds).toEqual([])
      present.add(node.source!.script)
      present.add(node.source!.artifact)
      const available = await pasteSystemEditorClipboardToLevel(targetLevelId)
      expect(available?.refusedIds).toEqual([])
      expect(available?.pastedIds).toHaveLength(1)
      useScene.temporal.getState().undo()
      expect(useScene.getState().nodes[available!.pastedIds[0]!]).toBeUndefined()
    } finally {
      configureArtifactStore(previousStore)
      useViewer.getState().setProjectId(null)
    }
  })

  test('hosted paste requires artifact origin but does not copy again within the same project', async () => {
    const node = copyScriptedWindow(null)
    const previousStore = getArtifactStore()
    const copyFrom = mock(async () => [])
    configureArtifactStore({ ...previousStore, copyFrom })
    try {
      const missingOrigin = await pasteSystemEditorClipboardToLevel(targetLevelId)
      expect(missingOrigin?.refusedIds).toEqual([node.id])
      expect(missingOrigin?.pastedIds).toEqual([])
      copyScriptedWindow('project_clipboard-target')
      const sameProject = await pasteSystemEditorClipboardToLevel(targetLevelId)
      expect(sameProject?.pastedIds).toHaveLength(1)
      expect(copyFrom).not.toHaveBeenCalled()
    } finally {
      configureArtifactStore(previousStore)
      useViewer.getState().setProjectId(null)
    }
  })

  test('build files verify artifacts even when their origin is absent or names the current project', async () => {
    const node = copyScriptedWindow()
    const previousStore = getArtifactStore()
    const copyFrom = mock(async (_projectId: string, _hashes: string[]) => [node.source!.script])
    configureArtifactStore({ ...previousStore, copyFrom })
    try {
      for (const projectId of [undefined, 'project_clipboard-target', 'project_unreadable']) {
        const result = await bringBuildArtifacts({
          projectId,
          nodes: {
            [sourceLevelId]: makeLevel(sourceLevelId, [node.id]),
            [node.id]: node,
          },
          rootNodeIds: [sourceLevelId],
        })
        expect(copyFrom.mock.calls.at(-1)?.[0]).toBe(projectId ?? 'project_clipboard-target')
        expect(result.refusedIds).toEqual([node.id])
        expect(result.build.nodes[node.id]).toBeUndefined()
        expect((result.build.nodes[sourceLevelId] as LevelNode).children).toEqual([])
      }
      configureArtifactStore({ ...previousStore, copyFrom: async () => [] })
      const available = await bringBuildArtifacts({
        nodes: { [sourceLevelId]: makeLevel(sourceLevelId, [node.id]), [node.id]: node },
        rootNodeIds: [sourceLevelId],
      })
      expect(available.refusedIds).toEqual([])
      expect(available.build.nodes[node.id]).toEqual(node)
    } finally {
      configureArtifactStore(previousStore)
      useViewer.getState().setProjectId(null)
    }
  })

  test('refusing a scripted node terminates even when another clipboard root has a cyclic parent', async () => {
    const scripted = copyScriptedWindow()
    const cyclic = ColumnNode.parse({
      id: 'column_clipboard-cycle',
      parentId: 'column_clipboard-cycle',
    })
    const text = JSON.stringify({
      kind: 'pascal.scene-nodes',
      version: 1,
      payload: {
        ...getEditorClipboardSnapshot(),
        nodes: [scripted, cyclic],
        rootIds: [scripted.id, cyclic.id],
      },
    })
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { readText: async () => text },
    })
    const previousStore = getArtifactStore()
    configureArtifactStore({ ...previousStore, copyFrom: async () => [scripted.source!.script] })
    try {
      const result = await pasteSystemEditorClipboardToLevel(targetLevelId)
      expect(result?.refusedIds).toEqual([scripted.id])
      expect(result?.pastedIds).toHaveLength(1)
      expect(useScene.getState().nodes[result!.pastedIds[0]!]!.parentId).toBe(targetLevelId)
    } finally {
      configureArtifactStore(previousStore)
      useViewer.getState().setProjectId(null)
    }
  })
})
