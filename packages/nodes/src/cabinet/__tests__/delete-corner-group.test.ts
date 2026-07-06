import { beforeEach, describe, expect, test } from 'bun:test'
import type {
  AnyNode,
  AnyNodeId,
  CabinetModuleNode as CabinetModuleNodeType,
} from '@pascal-app/core'
import { loadPlugin, nodeRegistry } from '../../../../core/src/registry'
import { createSceneApi } from '../../../../core/src/registry/scene-api'
import useScene from '../../../../core/src/store/use-scene'
import { builtinPlugin } from '../../index'
import { addCornerRun, wallBottomHeightForTallAlignment } from '../run-ops'
import { CabinetModuleNode, CabinetNode } from '../schema'

type RafFn = (cb: (t: number) => void) => number
;(globalThis as unknown as { requestAnimationFrame?: RafFn }).requestAnimationFrame ??= ((
  cb: (t: number) => void,
) => {
  cb(0)
  return 0
}) as RafFn
;(globalThis as unknown as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame ??=
  () => {}

function cornerMetadata(node: AnyNode | undefined): Record<string, unknown> {
  const metadata = (node as { metadata?: unknown } | undefined)?.metadata
  return metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>) : {}
}

function seedCornerScene(prefix: string, options: { withWallTop?: boolean } = {}) {
  const levelId = `level_${prefix}` as AnyNodeId
  const runId = `cabinet_${prefix}-run` as AnyNodeId
  const moduleId = `cabinet-module_${prefix}-module` as AnyNodeId
  const wallTopId = `cabinet-module_${prefix}-wall-top` as AnyNodeId

  const level = {
    id: levelId,
    type: 'level',
    object: 'node',
    visible: true,
    name: '',
    metadata: {},
    position: [0, 0, 0],
    rotation: 0,
    level: 0,
    parentId: null,
    children: [runId],
  } as unknown as AnyNode
  const run = CabinetNode.parse({
    id: runId,
    parentId: levelId,
    position: [0, 0, 0],
    rotation: 0,
    children: [moduleId],
  })
  const module = CabinetModuleNode.parse({
    id: moduleId,
    parentId: runId,
    position: [0, 0.1, 0],
    width: 0.9,
    depth: 0.58,
    carcassHeight: 0.72,
    ...(options.withWallTop ? { children: [wallTopId] } : {}),
    stack: [{ id: `door-${prefix}`, type: 'door', shelfCount: 2 }],
  })
  const nodes: Record<string, AnyNode> = {
    [level.id]: level,
    [run.id]: run as AnyNode,
    [module.id]: module as AnyNode,
  }
  if (options.withWallTop) {
    const wallTop = CabinetModuleNode.parse({
      id: wallTopId,
      parentId: moduleId,
      position: [0, wallBottomHeightForTallAlignment() - module.position[1], -0.13],
      width: 0.9,
      depth: 0.32,
      carcassHeight: 0.72,
      stack: [{ id: `door-${prefix}-wall-top`, type: 'door', shelfCount: 1 }],
    })
    nodes[wallTop.id] = wallTop as AnyNode
  }

  useScene.setState({ nodes, rootNodeIds: [level.id] } as never)
  return { levelId, runId, moduleId, wallTopId, run, module }
}

function linkedRunIdsOf(moduleId: AnyNodeId): AnyNodeId[] {
  const link = cornerMetadata(useScene.getState().nodes[moduleId]).cabinetCornerSourceLink as
    | { linkedRunIds?: AnyNodeId[] }
    | undefined
  return link?.linkedRunIds ?? []
}

describe('cabinet corner member deletion', () => {
  beforeEach(async () => {
    if (!nodeRegistry.get('cabinet') || !nodeRegistry.get('cabinet-module')) {
      await loadPlugin(builtinPlugin)
    }
    useScene.setState({ nodes: {}, rootNodeIds: [] } as never)
    useScene.temporal.getState().clear()
  })

  test('deleting one derived leg run removes only that run and unlinks it from the source module', () => {
    const { runId, moduleId, run, module } = seedCornerScene('delete-one-leg')
    const sceneApi = createSceneApi(useScene)
    addCornerRun({ module, run, sceneApi, side: 'right' })

    const legIds = linkedRunIdsOf(moduleId)
    expect(legIds.length).toBeGreaterThan(1)
    const [deletedLegId, ...survivingLegIds] = legIds

    useScene.getState().deleteNode(deletedLegId!)

    const nodes = useScene.getState().nodes
    expect(nodes[deletedLegId!]).toBeUndefined()
    // Everything else survives: source run, source module, the other legs.
    expect(nodes[runId]).toBeDefined()
    expect(nodes[moduleId]).toBeDefined()
    for (const survivorId of survivingLegIds) {
      expect(nodes[survivorId]).toBeDefined()
    }
    // The source module's link no longer references the deleted leg.
    expect(linkedRunIdsOf(moduleId)).toEqual(survivingLegIds)
  })

  test('deleting a module inside a leg run removes only that module', () => {
    const { runId, moduleId, run, module } = seedCornerScene('delete-leg-module')
    const sceneApi = createSceneApi(useScene)
    const derivedModuleId = addCornerRun({ module, run, sceneApi, side: 'right' })
    expect(derivedModuleId).toBeTruthy()

    const legRunId = (
      useScene.getState().nodes[derivedModuleId! as AnyNodeId] as CabinetModuleNodeType
    ).parentId as AnyNodeId

    useScene.getState().deleteNode(derivedModuleId! as AnyNodeId)

    const nodes = useScene.getState().nodes
    expect(nodes[derivedModuleId! as AnyNodeId]).toBeUndefined()
    expect(nodes[legRunId]).toBeDefined()
    expect(nodes[runId]).toBeDefined()
    expect(nodes[moduleId]).toBeDefined()
    expect(linkedRunIdsOf(moduleId)).toContain(legRunId)
  })

  test('deleting the source wall-top removes only the wall-top', () => {
    const { runId, moduleId, wallTopId, run, module } = seedCornerScene('delete-wall-top', {
      withWallTop: true,
    })
    const sceneApi = createSceneApi(useScene)
    addCornerRun({ module, run, sceneApi, side: 'right' })
    const legIds = linkedRunIdsOf(moduleId)

    useScene.getState().deleteNode(wallTopId)

    const nodes = useScene.getState().nodes
    expect(nodes[wallTopId]).toBeUndefined()
    expect(nodes[runId]).toBeDefined()
    expect(nodes[moduleId]).toBeDefined()
    for (const legId of legIds) {
      expect(nodes[legId]).toBeDefined()
    }
    expect(linkedRunIdsOf(moduleId)).toEqual(legIds)
  })

  test('deleting the source module keeps the legs as plain unlinked runs', () => {
    const { runId, moduleId, run, module } = seedCornerScene('delete-source-module')
    const sceneApi = createSceneApi(useScene)
    addCornerRun({ module, run, sceneApi, side: 'right' })
    const legIds = linkedRunIdsOf(moduleId)
    expect(legIds.length).toBeGreaterThan(0)

    useScene.getState().deleteNode(moduleId)

    const nodes = useScene.getState().nodes
    expect(nodes[moduleId]).toBeUndefined()
    expect(nodes[runId]).toBeDefined()
    for (const legId of legIds) {
      expect(nodes[legId]).toBeDefined()
      expect('cabinetCornerDerivedRun' in cornerMetadata(nodes[legId])).toBe(false)
    }
  })

  test('deleting every leg drops the source link entirely', () => {
    const { moduleId, run, module } = seedCornerScene('delete-all-legs')
    const sceneApi = createSceneApi(useScene)
    addCornerRun({ module, run, sceneApi, side: 'right' })
    const legIds = linkedRunIdsOf(moduleId)

    for (const legId of legIds) {
      useScene.getState().deleteNode(legId)
    }

    const metadata = cornerMetadata(useScene.getState().nodes[moduleId])
    expect('cabinetCornerSourceLink' in metadata).toBe(false)
  })

  test('deleting the whole source run removes the run subtree including the legs', () => {
    const { levelId, runId, moduleId, run, module } = seedCornerScene('delete-source-run')
    const sceneApi = createSceneApi(useScene)
    addCornerRun({ module, run, sceneApi, side: 'right' })

    useScene.getState().deleteNode(runId)

    const remaining = Object.values(useScene.getState().nodes).filter(
      (node) => node.type === 'cabinet' || node.type === 'cabinet-module',
    )
    expect(remaining).toEqual([])
    expect(useScene.getState().nodes[levelId]).toBeDefined()
    expect(useScene.getState().nodes[moduleId]).toBeUndefined()
  })
})
