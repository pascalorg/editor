import { expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  CABINET_METRIC_DEFAULTS,
  CabinetModuleNode,
  CabinetNode,
  type SceneApi,
} from '@pascal-app/core'
import { cabinetDefinition, cabinetModuleDefinition } from '../definition'
import { CABINET_PRESETS, cabinetPresetById } from '../presets'
import { addWallChildAbove } from '../run-ops'

function sceneApiFixture(seed: AnyNode[]): SceneApi {
  const nodes = Object.fromEntries(seed.map((node) => [node.id, node])) as Record<
    AnyNodeId,
    AnyNode
  >

  return {
    get: (id) => nodes[id],
    nodes: () => nodes,
    update: (id, patch) => {
      const current = nodes[id]
      if (current) nodes[id] = { ...current, ...patch } as AnyNode
    },
    upsert: (node, parentId) => {
      nodes[node.id as AnyNodeId] = node
      if (parentId) {
        const parent = nodes[parentId]
        if (parent) {
          nodes[parentId] = {
            ...parent,
            children: [...new Set([...(parent.children ?? []), node.id as AnyNodeId])],
          } as AnyNode
        }
      }
      return node.id as AnyNodeId
    },
    delete: () => {},
    restore: () => {},
    restoreAll: () => {},
    markDirty: () => {},
    pauseHistory: () => {},
    resumeHistory: () => {},
    getSubtree: () => null,
    cloneNodesInto: () => null,
  }
}

test('the default base cabinet preset uses overlay fronts', () => {
  expect(cabinetPresetById('base-door').createPatch().frontOverlay).toBe('full')
})

test('cabinet creation defaults use the metric 600 mm family', () => {
  const run = CabinetNode.parse({})
  const module = CabinetModuleNode.parse({})

  expect(run).toMatchObject({
    depth: CABINET_METRIC_DEFAULTS.depth,
    carcassHeight: CABINET_METRIC_DEFAULTS.carcassHeight,
    plinthHeight: CABINET_METRIC_DEFAULTS.plinthHeight,
    countertopThickness: CABINET_METRIC_DEFAULTS.countertopThickness,
  })
  expect(module).toMatchObject({
    depth: CABINET_METRIC_DEFAULTS.depth,
    carcassHeight: CABINET_METRIC_DEFAULTS.carcassHeight,
    topFinish: 'none',
    topFinishHeight: 0.33,
  })
  expect(cabinetDefinition.defaults()).toMatchObject({
    depth: CABINET_METRIC_DEFAULTS.depth,
    carcassHeight: CABINET_METRIC_DEFAULTS.carcassHeight,
  })
  expect(cabinetModuleDefinition.defaults()).toMatchObject({
    depth: CABINET_METRIC_DEFAULTS.depth,
    carcassHeight: CABINET_METRIC_DEFAULTS.carcassHeight,
  })
  for (const preset of CABINET_PRESETS) {
    expect(preset.createPatch().depth).toBeCloseTo(CABINET_METRIC_DEFAULTS.depth)
  }
})

test('tall modules expose a visible height resize handle', () => {
  const run = CabinetNode.parse({
    id: 'cabinet_height-handle-run',
    children: ['cabinet-module_height-handle-module'],
  })
  const module = CabinetModuleNode.parse({
    id: 'cabinet-module_height-handle-module',
    parentId: run.id,
    cabinetType: 'tall',
  })
  const sceneApi = sceneApiFixture([run as AnyNode, module as AnyNode])
  const handles =
    typeof cabinetModuleDefinition.handles === 'function'
      ? cabinetModuleDefinition.handles(module, sceneApi)
      : cabinetModuleDefinition.handles
  const heightHandle = handles?.find(
    (handle) => handle.kind === 'linear-resize' && handle.axis === 'y',
  )

  expect(heightHandle).toBeDefined()
  expect(heightHandle?.visible?.(module, sceneApi)).not.toBe(false)
})

test('a wall cabinet added from an inset base starts with overlay fronts', () => {
  const run = CabinetNode.parse({
    id: 'cabinet_default-front-run',
    children: ['cabinet-module_default-front-base'],
  })
  const module = CabinetModuleNode.parse({
    id: 'cabinet-module_default-front-base',
    parentId: run.id,
    frontOverlay: 'inset',
  })
  const sceneApi = sceneApiFixture([run as AnyNode, module as AnyNode])

  const wallId = addWallChildAbove({ kind: 'cabinet', module, run, sceneApi })

  expect(wallId).not.toBeNull()
  expect(sceneApi.get<CabinetModuleNode>(wallId!)?.frontOverlay).toBe('full')
})
