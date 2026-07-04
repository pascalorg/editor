import { expect, test } from '@playwright/test'

type SceneNode = {
  object?: 'node'
  id?: string
  type?: string
  name?: string
  parentId?: string | null
  children?: string[]
  position?: [number, number, number]
  rotation?: [number, number, number]
  start?: [number, number]
  end?: [number, number]
  diameter?: number
  elevation?: number
  visible?: boolean
  metadata?: Record<string, unknown>
}

type FactoryE2eBridge = {
  sceneNodes: () => Record<string, SceneNode>
  selectNode: (nodeId: string) => void
  setPreviewMode: (enabled: boolean) => void
  resetLiveDataSource: () => void
  reseedFixedLiveDataSource: () => void
  liveDataValue: (path: string) => unknown
  nodeTransform: (nodeId: string) => {
    position: [number, number, number]
    rotation: [number, number, number]
    scale: [number, number, number]
    visible: boolean
  } | null
}

const ids = {
  site: 'site_scene_structure_e2e',
  building: 'building_scene_structure_e2e',
  level: 'level_scene_structure_e2e',
  tower: 'assembly_atmospheric_tower_e2e',
  tank: 'assembly_product_tank_e2e',
  towerShell: 'box_atmospheric_tower_shell_e2e',
  tankShell: 'box_product_tank_shell_e2e',
  pipe: 'pipe_transfer_e2e',
} as const

function refineryStructureGraph() {
  const nodes: Record<string, SceneNode> = {
    [ids.site]: {
      object: 'node',
      id: ids.site,
      type: 'site',
      name: 'Refinery site',
      parentId: null,
      children: [ids.building],
      visible: true,
      metadata: {},
    },
    [ids.building]: {
      object: 'node',
      id: ids.building,
      type: 'building',
      name: 'Refinery plot',
      parentId: ids.site,
      children: [ids.level],
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      visible: true,
      metadata: {},
    },
    [ids.level]: {
      object: 'node',
      id: ids.level,
      type: 'level',
      name: 'Ground',
      parentId: ids.building,
      children: [ids.tower, ids.tank, ids.pipe],
      visible: true,
      metadata: {},
    },
    [ids.tower]: {
      object: 'node',
      id: ids.tower,
      type: 'assembly',
      name: 'Atmospheric distillation unit',
      parentId: ids.level,
      children: [ids.towerShell],
      position: [-4, 0, 0],
      rotation: [0, 0, 0],
      visible: true,
      metadata: {
        processId: 'refinery_basic_complex',
        processDisplayLabel: 'Refinery',
        stationId: 'atmospheric_distillation',
        equipmentRole: 'distillation',
        liveDataBinding: {
          enabled: true,
          dataKey: 'machine.temperature',
          effect: 'color',
        },
        sourcePack: { id: 'industry.refinery.basic', version: '0.2.0' },
        equipmentAssembly: {
          kind: 'semantic-assembly',
          recipeId: 'factory:distillation-column',
          profileId: 'refinery.atmospheric_distillation_unit',
          equipmentFamily: 'column',
          params: { shellOpacity: 0.65 },
          editableParams: [
            {
              key: 'shellOpacity',
              label: 'Shell opacity',
              kind: 'number',
              min: 0.1,
              max: 1,
              step: 0.01,
              precision: 2,
              effects: [
                { kind: 'set-param' },
                {
                  kind: 'set-part-material',
                  partRole: 'vessel_shell',
                  property: 'opacity',
                  transparentWhenBelowOne: true,
                },
              ],
            },
          ],
          editablePartRoles: ['vessel_shell'],
          ports: [
            { id: 'inlet', medium: 'crude', side: 'west' },
            { id: 'outlet', medium: 'product', side: 'east' },
          ],
        },
      },
    },
    [ids.towerShell]: {
      object: 'node',
      id: ids.towerShell,
      type: 'box',
      name: 'Tower shell',
      parentId: ids.tower,
      position: [0, 3, 0],
      rotation: [0, 0, 0],
      visible: true,
      metadata: {
        processId: 'refinery_basic_complex',
        stationId: 'atmospheric_distillation',
        semanticRole: 'vessel_shell',
      },
    },
    [ids.tank]: {
      object: 'node',
      id: ids.tank,
      type: 'assembly',
      name: 'Product tank farm',
      parentId: ids.level,
      children: [ids.tankShell],
      position: [4, 0, 0],
      rotation: [0, 0, 0],
      visible: true,
      metadata: {
        processId: 'refinery_basic_complex',
        processDisplayLabel: 'Refinery',
        stationId: 'product_storage_tank',
        equipmentRole: 'storage',
        sourcePack: { id: 'industry.refinery.basic', version: '0.2.0' },
        equipmentAssembly: {
          kind: 'semantic-assembly',
          recipeId: 'factory:storage-tank',
          profileId: 'refinery.product_storage_tank',
          equipmentFamily: 'tank',
          editablePartRoles: ['vessel_shell', 'liquid_volume'],
          ports: [
            { id: 'inlet', medium: 'product', side: 'west' },
            { id: 'outlet', medium: 'product', side: 'east' },
          ],
        },
      },
    },
    [ids.tankShell]: {
      object: 'node',
      id: ids.tankShell,
      type: 'box',
      name: 'Tank shell',
      parentId: ids.tank,
      position: [0, 1, 0],
      rotation: [0, 0, 0],
      visible: true,
      metadata: {
        processId: 'refinery_basic_complex',
        stationId: 'product_storage_tank',
        semanticRole: 'vessel_shell',
      },
    },
    [ids.pipe]: {
      object: 'node',
      id: ids.pipe,
      type: 'pipe',
      name: 'Transfer pipe',
      parentId: ids.level,
      start: [-2, 0],
      end: [2, 0],
      diameter: 0.2,
      elevation: 1.2,
      visible: true,
      metadata: {
        processId: 'refinery_basic_complex',
        processDisplayLabel: 'Refinery',
        fromStationId: 'atmospheric_distillation',
        toStationId: 'product_storage_tank',
        fromPortId: 'outlet',
        toPortId: 'inlet',
        medium: 'material',
        visualKind: 'pipe',
      },
    },
  }

  return {
    nodes,
    rootNodeIds: [ids.site],
  }
}

test('scene structure defaults factory scenes to process and preserves elevation/source modes', async ({
  page,
  request,
}) => {
  const sceneId = `scene-structure-${Date.now()}-${test.info().parallelIndex}`
  const createResponse = await request.post('/api/scenes', {
    data: {
      id: sceneId,
      name: 'Scene Structure E2E',
      graph: refineryStructureGraph(),
    },
  })
  expect(createResponse.status()).toBe(201)

  try {
    await page.addInitScript(() => {
      window.localStorage.clear()
    })
    await page.goto(`/scene/${sceneId}?factoryE2e=1`, {
      waitUntil: 'domcontentloaded',
      timeout: 120_000,
    })

    await page.getByTestId('sidebar-tab-site').click()
    await expect(page.getByTestId('sidebar-tab-site')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('scene-structure-panel')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('scene-structure-mode-auto')).toContainText('Auto: Process')
    await expect(page.getByTestId('scene-structure-summary')).toContainText('2 objects / 1 groups')
    await expect(page.getByText('Atmospheric distillation unit')).toBeVisible()
    await expect(page.getByText('Product tank farm')).toBeVisible()
    await expect(page.getByTestId('canvas-lens-toolbar')).toBeVisible()
    await expect(page.getByTestId('canvas-lens-layout')).toHaveAttribute('aria-pressed', 'true')

    await page.getByTestId('canvas-lens-process').click()
    await expect(page.getByTestId('canvas-lens-process')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('scene-structure-summary')).toContainText('2 objects / 1 groups')
    await expect(page.getByTestId(`process-lens-station-${ids.tower}`)).toBeVisible()
    await expect(page.getByTestId(`process-lens-port-${ids.tower}-inlet`)).toBeVisible()
    await expect(page.getByTestId(`process-lens-port-${ids.tower}-outlet`)).toBeVisible()
    await expect(page.getByTestId(`process-lens-port-${ids.tank}-inlet`)).toBeVisible()
    await expect(page.getByTestId(`process-lens-route-${ids.tower}-${ids.tank}`)).toBeVisible()

    await page.getByTestId(`process-lens-station-${ids.tower}`).click()
    await expect(page.locator(`[data-scene-structure-node-id="${ids.tower}"]`)).toHaveAttribute(
      'data-scene-structure-selected',
      'true',
    )
    await expect(page.getByRole('heading', { name: 'Atmospheric distillation unit' })).toBeVisible()
    await page.getByRole('button', { name: 'Semantic Inspector' }).click()
    if (!(await page.getByTestId('semantic-inspector-tab-data').isVisible())) {
      await page.getByRole('button', { name: 'Semantic Inspector' }).click()
    }
    await expect(page.getByTestId('semantic-inspector-equipment')).toBeVisible()
    await expect(page.getByTestId('semantic-inspector-equipment')).toContainText('column')
    await expect(page.getByTestId('semantic-inspector-equipment-params')).toContainText(
      'Shell opacity',
    )
    await expect(page.getByTestId('semantic-inspector-equipment-param-shellOpacity')).toBeVisible()
    await page.getByTestId('semantic-inspector-tab-parts').click()
    await expect(page.getByTestId(`semantic-inspector-part-vessel_shell`)).toBeVisible()
    await expect(page.getByTestId('semantic-inspector-part-vessel_shell-controls')).toContainText(
      'Part material',
    )
    await expect(page.getByTestId('semantic-inspector-part-vessel_shell-opacity')).toContainText(
      'Opacity',
    )
    await page.getByTestId('semantic-inspector-tab-ports').click()
    await expect(page.getByTestId('semantic-inspector-port-inlet')).toContainText('crude')
    await expect(page.getByTestId('semantic-inspector-port-outlet')).toContainText('product')
    await expect(page.getByTestId('semantic-inspector-port-outlet-connection-0')).toContainText(
      'Product tank farm',
    )
    await expect(page.getByTestId('semantic-inspector-port-outlet-connection-0')).toContainText(
      'pipe_transfer_e2e',
    )
    await page.getByTestId('semantic-inspector-tab-data').click()
    await expect(page.getByTestId('semantic-inspector-data-binding')).toContainText(
      'color: machine.temperature',
    )
    await expect(page.getByTestId('semantic-inspector-data-source')).toContainText(
      'fixed:factory-demo',
    )
    await expect(page.getByTestId('semantic-inspector-data-value')).toContainText(
      'machine.temperature',
    )
    await expect(page.getByTestId('semantic-inspector-data-value')).toContainText('28')
    await page.getByTestId('semantic-inspector-tab-source').click()
    await expect(page.getByTestId('semantic-inspector-source')).toContainText(
      'industry.refinery.basic@0.2.0',
    )

    await page.getByTestId('canvas-lens-equipment').click()
    await expect(page.getByTestId('canvas-lens-equipment')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId(`process-lens-station-${ids.tower}`)).toBeHidden()
    await expect(page.getByTestId(`equipment-lens-card-${ids.tower}`)).toBeVisible()
    await expect(page.getByTestId(`equipment-lens-card-${ids.tank}`)).toBeVisible()
    await expect(page.getByTestId(`equipment-lens-part-${ids.tower}-vessel_shell`)).toBeVisible()
    await expect(page.getByTestId(`equipment-lens-ports-${ids.tank}`)).toContainText('2 ports')

    await page.getByTestId(`equipment-lens-card-${ids.tank}`).click()
    await expect(page.locator(`[data-scene-structure-node-id="${ids.tank}"]`)).toHaveAttribute(
      'data-scene-structure-selected',
      'true',
    )
    await expect(page.getByRole('heading', { name: 'Product tank farm' })).toBeVisible()

    await page.getByTestId('canvas-lens-data').click()
    await expect(page.getByTestId('canvas-lens-data')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId(`process-lens-station-${ids.tower}`)).toBeHidden()
    await expect(page.getByTestId(`process-lens-route-${ids.tower}-${ids.tank}`)).toBeHidden()
    await expect(page.getByTestId(`equipment-lens-card-${ids.tank}`)).toBeHidden()
    await expect(page.getByTestId(`data-lens-card-${ids.tower}`)).toBeVisible()
    await expect(page.getByTestId(`data-lens-card-${ids.tank}`)).toBeVisible()
    await expect(page.getByTestId(`data-lens-status-${ids.tower}`)).toContainText('1 binding')
    await expect(page.getByTestId(`data-lens-binding-${ids.tower}`)).toContainText(
      'color: machine.temperature',
    )
    await expect(page.getByTestId(`data-lens-value-${ids.tower}`)).toContainText('28')
    await expect(page.getByTestId(`data-lens-status-${ids.tank}`)).toContainText('Ready to bind')
    await expect(page.locator(`[data-scene-structure-node-id="${ids.tower}"]`)).not.toHaveAttribute(
      'data-scene-structure-selected',
      'true',
    )
    await expect(page.locator(`[data-scene-structure-node-id="${ids.tank}"]`)).toHaveAttribute(
      'data-scene-structure-selected',
      'true',
    )

    await page.getByTestId('scene-structure-mode-asset-source').click()
    await expect(page.getByTestId('scene-structure-summary')).toContainText('3 objects / 1 groups')
    await expect(page.getByText('Industry packs')).toBeVisible()

    await page.getByTestId('scene-structure-mode-elevation').click()
    await expect(page.getByTestId('scene-structure-summary')).toContainText('3 objects / 1 groups')
    await expect(page.getByText('Ground').first()).toBeVisible()

    await page.getByTestId('scene-structure-mode-auto').click()
    await expect(page.getByTestId('scene-structure-mode-auto')).toContainText('Auto: Process')
    await expect(page.getByTestId('scene-structure-summary')).toContainText('2 objects / 1 groups')
  } finally {
    await request.delete(`/api/scenes/${sceneId}`).catch(() => undefined)
  }
})

test('AI data binding applies semantic tank level and appears in Data Lens and Inspector', async ({
  page,
  request,
}) => {
  const sceneId = `scene-structure-data-binding-${Date.now()}-${test.info().parallelIndex}`
  const createResponse = await request.post('/api/scenes', {
    data: {
      id: sceneId,
      name: 'Scene Data Binding E2E',
      graph: refineryStructureGraph(),
    },
  })
  expect(createResponse.status()).toBe(201)

  try {
    await page.addInitScript(() => {
      window.localStorage.clear()
    })
    await page.goto(`/scene/${sceneId}?factoryE2e=1`, {
      waitUntil: 'domcontentloaded',
      timeout: 120_000,
    })
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 })
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const bridge = (
              window as Window & {
                __pascalFactoryE2e?: Partial<FactoryE2eBridge>
              }
            ).__pascalFactoryE2e
            return (
              typeof bridge?.sceneNodes === 'function' &&
              typeof bridge.selectNode === 'function' &&
              typeof bridge.liveDataValue === 'function'
            )
          }),
        { timeout: 30_000 },
      )
      .toBe(true)

    await page.evaluate((nodeId) => {
      const bridge = (
        window as Window & {
          __pascalFactoryE2e?: FactoryE2eBridge
        }
      ).__pascalFactoryE2e
      bridge?.selectNode(nodeId)
    }, ids.tank)

    await page.getByTestId('sidebar-tab-ai').click()
    await expect(page.getByTestId('factory-chat-input')).toBeVisible({ timeout: 30_000 })
    await page.getByTestId('factory-chat-input').fill('bind selected tank level to live data')
    await page.getByTestId('factory-chat-send').click()

    await expect(page.getByTestId('generation-plan-preview-bind-live-data')).toBeVisible({
      timeout: 30_000,
    })
    await page.getByTestId('generation-plan-preview-apply-bind-live-data').click()
    await expect(page.getByText('Bound Product tank farm Tank liquid level')).toBeVisible({
      timeout: 30_000,
    })

    await expect
      .poll(
        () =>
          page.evaluate((nodeId) => {
            const bridge = (
              window as Window & {
                __pascalFactoryE2e?: FactoryE2eBridge
              }
            ).__pascalFactoryE2e
            const nodes = (bridge?.sceneNodes() ?? {}) as Record<string, SceneNode>
            const node = nodes[nodeId]
            const bindings = node?.metadata?.dynamicBindings as Array<Record<string, unknown>>
            return bindings?.map((binding) => ({
              id: binding.id,
              type: binding.type,
              path: binding.path,
            }))
          }, ids.tank),
        { timeout: 30_000 },
      )
      .toContainEqual({
        id: `semantic_live_${ids.tank}_tank-level`,
        type: 'level',
        path: 'refinery.tank.level',
      })

    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const bridge = (
              window as Window & {
                __pascalFactoryE2e?: FactoryE2eBridge
              }
            ).__pascalFactoryE2e
            return bridge?.liveDataValue('refinery.tank.level')
          }),
        { timeout: 10_000 },
      )
      .toBe(62)

    await page.evaluate(() => {
      const bridge = (
        window as Window & {
          __pascalFactoryE2e?: FactoryE2eBridge
        }
      ).__pascalFactoryE2e
      bridge?.resetLiveDataSource()
    })
    await expect
      .poll(
        () =>
          page.evaluate((nodeId) => {
            const bridge = (
              window as Window & {
                __pascalFactoryE2e?: FactoryE2eBridge
              }
            ).__pascalFactoryE2e
            const nodes = (bridge?.sceneNodes() ?? {}) as Record<string, SceneNode>
            const bindings = nodes[nodeId]?.metadata?.dynamicBindings as
              | Array<Record<string, unknown>>
              | undefined
            return {
              value: bridge?.liveDataValue('refinery.tank.level'),
              bindingCount: bindings?.length ?? 0,
              hasTankLevel: Boolean(
                bindings?.some(
                  (binding) =>
                    binding.id === `semantic_live_${nodeId}_tank-level` &&
                    binding.path === 'refinery.tank.level',
                ),
              ),
            }
          }, ids.tank),
        { timeout: 10_000 },
      )
      .toEqual({
        value: undefined,
        bindingCount: 1,
        hasTankLevel: true,
      })

    await page.evaluate(() => {
      const bridge = (
        window as Window & {
          __pascalFactoryE2e?: FactoryE2eBridge
        }
      ).__pascalFactoryE2e
      bridge?.reseedFixedLiveDataSource()
    })
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const bridge = (
              window as Window & {
                __pascalFactoryE2e?: FactoryE2eBridge
              }
            ).__pascalFactoryE2e
            return bridge?.liveDataValue('refinery.tank.level')
          }),
        { timeout: 10_000 },
      )
      .toBe(62)

    await page.getByTestId('sidebar-tab-site').click()
    await page.getByTestId('canvas-lens-data').click()
    await expect(page.getByTestId(`data-lens-card-${ids.tank}`)).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId(`data-lens-status-${ids.tank}`)).toContainText('1 binding')
    await expect(page.getByTestId(`data-lens-binding-${ids.tank}`)).toContainText(
      'level: refinery.tank.level',
    )
    await expect(page.getByTestId(`data-lens-value-${ids.tank}`)).toContainText('62')

    await page.getByTestId(`data-lens-card-${ids.tank}`).click()
    await expect(page.getByRole('heading', { name: 'Product tank farm' })).toBeVisible()
    await page.getByRole('button', { name: 'Semantic Inspector' }).click()
    if (!(await page.getByTestId('semantic-inspector-tab-data').isVisible())) {
      await page.getByRole('button', { name: 'Semantic Inspector' }).click()
    }
    await page.getByTestId('semantic-inspector-tab-data').click()
    await expect(page.getByTestId('semantic-inspector-data-binding')).toContainText(
      'level: refinery.tank.level',
    )
    await expect(page.getByTestId('semantic-inspector-data-value')).toContainText(
      'refinery.tank.level',
    )
    await expect(page.getByTestId('semantic-inspector-data-value')).toContainText('62')
  } finally {
    await request.delete(`/api/scenes/${sceneId}`).catch(() => undefined)
  }
})
