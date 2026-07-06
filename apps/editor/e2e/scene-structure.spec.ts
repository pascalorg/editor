import { expect, type Page, test } from '@playwright/test'

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
  applyFactoryRun: (data: unknown) => {
    changePreview?: {
      beforeNodeCount: number
      afterNodeCount: number
    }
    nodeIds: string[]
  }
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

async function expectFactoryBridge(page: Page) {
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
            typeof bridge?.sceneNodes === 'function' && typeof bridge.applyFactoryRun === 'function'
          )
        }),
      { timeout: 30_000 },
    )
    .toBe(true)
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

const articraftIds = {
  site: 'site_articraft_joint_e2e',
  building: 'building_articraft_joint_e2e',
  level: 'level_articraft_joint_e2e',
  root: 'assembly_articraft_crane_e2e',
  slewing: 'box_articraft_slewing_e2e',
  trolley: 'box_articraft_trolley_e2e',
} as const

function articraftJointGraph() {
  const nodes: Record<string, SceneNode> = {
    [articraftIds.site]: {
      object: 'node',
      id: articraftIds.site,
      type: 'site',
      name: 'Articraft site',
      parentId: null,
      children: [articraftIds.building],
      visible: true,
      metadata: {},
    },
    [articraftIds.building]: {
      object: 'node',
      id: articraftIds.building,
      type: 'building',
      name: 'Articraft plot',
      parentId: articraftIds.site,
      children: [articraftIds.level],
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      visible: true,
      metadata: {},
    },
    [articraftIds.level]: {
      object: 'node',
      id: articraftIds.level,
      type: 'level',
      name: 'Ground',
      parentId: articraftIds.building,
      children: [articraftIds.root],
      visible: true,
      metadata: {},
    },
    [articraftIds.root]: {
      object: 'node',
      id: articraftIds.root,
      type: 'assembly',
      name: 'Joint crane root',
      parentId: articraftIds.level,
      children: [articraftIds.slewing, articraftIds.trolley],
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      visible: true,
      metadata: {
        assetSource: {
          kind: 'articraft',
          assetId: 'articraft-rec_crane',
          recordId: 'rec_crane',
        },
        articraft: {
          recordId: 'rec_crane',
          recordPath: 'articraft/records/rec_crane',
          prompt: 'joint crane',
        },
      },
    },
    [articraftIds.slewing]: {
      object: 'node',
      id: articraftIds.slewing,
      type: 'box',
      name: 'Slewing unit',
      parentId: articraftIds.root,
      position: [0, 1, 0],
      rotation: [0, 0.4, 0],
      visible: true,
      metadata: {
        articraft: { recordId: 'rec_crane' },
        articraftJoint: {
          jointName: 'slewing_unit',
          jointType: 'revolute',
          axis: [0, 1, 0],
          limits: { lower: -1, upper: 1 },
          currentValue: 0.4,
          restRotation: [0, 0, 0],
          restPosition: [0, 1, 0],
        },
      },
    },
    [articraftIds.trolley]: {
      object: 'node',
      id: articraftIds.trolley,
      type: 'box',
      name: 'Trolley',
      parentId: articraftIds.root,
      position: [1, 1, 0],
      rotation: [0, 0, 0],
      visible: true,
      metadata: {
        articraft: { recordId: 'rec_crane' },
        articraftJoint: {
          jointName: 'upperworks_trolley_travel',
          jointType: 'prismatic',
          axis: [1, 0, 0],
          limits: { lower: 0, upper: 4 },
          currentValue: 1,
          restRotation: [0, 0, 0],
          restPosition: [0, 1, 0],
        },
      },
    },
  }

  return {
    nodes,
    rootNodeIds: [articraftIds.site],
  }
}

test('scene structure defaults factory scenes to system and preserves equipment/data/source modes', async ({
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
      window.localStorage.setItem(
        'pascal-editor-ui-preferences',
        JSON.stringify({ state: { activeSidebarPanel: 'site' }, version: 0 }),
      )
    })
    await page.goto(`/scene/${sceneId}?factoryE2e=1`, {
      waitUntil: 'domcontentloaded',
      timeout: 120_000,
    })

    await page.getByTestId('sidebar-tab-site').click()
    await expect(page.getByTestId('sidebar-tab-site')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('scene-structure-panel')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('scene-structure-mode-auto')).toContainText('Auto: System')
    await expect(page.getByTestId('scene-structure-summary')).toContainText('3 objects / 3 groups')
    await expect(page.getByText('Atmospheric distillation unit')).toBeVisible()
    await expect(page.getByText('Product tank farm')).toBeVisible()
    await expect(page.getByTestId('canvas-lens-toolbar')).toHaveCount(0)
    await expect(page.getByTestId(`equipment-lens-card-${ids.tower}`)).toHaveCount(0)

    await page.getByTestId('viewer-display-menu').click()
    await page.getByTestId('viewer-display-equipment-overlay').click()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId(`equipment-lens-card-${ids.tower}`)).toBeVisible()
    await expect(page.getByTestId(`equipment-lens-card-${ids.tank}`)).toBeVisible()
    await expect(page.getByTestId(`equipment-lens-part-${ids.tower}-vessel_shell`)).toBeVisible()
    await expect(page.getByTestId(`equipment-lens-ports-${ids.tank}`)).toContainText('2 ports')

    await page.locator(`[data-scene-structure-node-id="${ids.tower}"]`).click()
    await expect(page.locator(`[data-scene-structure-node-id="${ids.tower}"]`)).toHaveAttribute(
      'data-scene-structure-selected',
      'true',
    )
    await expect(page.getByRole('heading', { name: 'Atmospheric distillation unit' })).toBeVisible()
    await expect(page.getByTestId('semantic-inspector-equipment')).toBeVisible()
    await expect(page.getByTestId('semantic-inspector-equipment')).toContainText('column')
    await expect(page.getByTestId('semantic-inspector-equipment-params')).toContainText(
      'Shell opacity',
    )
    await expect(page.getByTestId('semantic-inspector-equipment-param-shellOpacity')).toBeVisible()
    await expect(page.getByTestId(`semantic-inspector-part-vessel_shell`)).toBeVisible()
    await expect(page.getByTestId('semantic-inspector-part-vessel_shell-controls')).toContainText(
      'Part material',
    )
    await expect(page.getByTestId('semantic-inspector-part-vessel_shell-opacity')).toContainText(
      'Opacity',
    )
    await page.getByRole('button', { name: '连接与来源' }).click()
    await expect(page.getByTestId('semantic-inspector-port-inlet')).toContainText('crude')
    await expect(page.getByTestId('semantic-inspector-port-outlet')).toContainText('product')
    await expect(page.getByTestId('semantic-inspector-port-outlet-connection-0')).toContainText(
      'Product tank farm',
    )
    await expect(page.getByTestId('semantic-inspector-port-outlet-connection-0')).toContainText(
      'pipe_transfer_e2e',
    )
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
    await expect(page.getByTestId('semantic-inspector-source')).toContainText(
      'industry.refinery.basic@0.2.0',
    )

    await page.locator(`[data-scene-structure-node-id="${ids.tank}"]`).click()
    await expect(page.locator(`[data-scene-structure-node-id="${ids.tank}"]`)).toHaveAttribute(
      'data-scene-structure-selected',
      'true',
    )
    await expect(page.getByRole('heading', { name: 'Product tank farm' })).toBeVisible()

    await page.getByTestId('viewer-display-menu').click()
    await page.getByTestId('viewer-display-data-binding-overlay').click()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId(`data-lens-card-${ids.tower}`)).toBeVisible()
    await expect(page.getByTestId(`data-lens-card-${ids.tank}`)).toBeVisible()
    await expect(page.getByTestId(`data-lens-status-${ids.tower}`)).toContainText('1 binding')
    await expect(page.getByTestId(`data-lens-binding-${ids.tower}`)).toContainText(
      'color: machine.temperature',
    )
    await expect(page.getByTestId(`data-lens-value-${ids.tower}`)).toContainText('28')
    await expect(page.getByTestId(`data-lens-status-${ids.tank}`)).toContainText('Ready to bind')

    await page.getByTestId('scene-structure-mode-asset-source').click()
    await expect(page.getByTestId('scene-structure-summary')).toContainText('3 objects / 1 groups')
    await expect(page.getByText('Industry packs')).toBeVisible()

    await page.getByTestId('scene-structure-mode-elevation').click()
    await expect(page.getByTestId('scene-structure-summary')).toContainText('3 objects / 1 groups')
    await expect(page.getByText('Ground').first()).toBeVisible()

    await page.getByTestId('scene-structure-mode-auto').click()
    await expect(page.getByTestId('scene-structure-mode-auto')).toContainText('Auto: System')
    await expect(page.getByTestId('scene-structure-summary')).toContainText('3 objects / 3 groups')
  } finally {
    await request.delete(`/api/scenes/${sceneId}`).catch(() => undefined)
  }
})

test('AI data binding applies semantic tank level and appears in binding labels and Inspector', async ({
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
    await page.getByTestId('viewer-display-menu').click()
    await page.getByTestId('viewer-display-data-binding-overlay').click()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId(`data-lens-card-${ids.tank}`)).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId(`data-lens-status-${ids.tank}`)).toContainText('1 binding')
    await expect(page.getByTestId(`data-lens-binding-${ids.tank}`)).toContainText(
      'level: refinery.tank.level',
    )
    await expect(page.getByTestId(`data-lens-value-${ids.tank}`)).toContainText('62')

    await page.getByTestId(`data-lens-card-${ids.tank}`).click()
    await expect(page.getByRole('heading', { name: 'Product tank farm' })).toBeVisible()
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

test('Articraft joint assets expose asset-level joint controls in Inspector', async ({
  page,
  request,
}) => {
  const sceneId = `scene-structure-articraft-joints-${Date.now()}-${test.info().parallelIndex}`
  const createResponse = await request.post('/api/scenes', {
    data: {
      id: sceneId,
      name: 'Scene Articraft Joints E2E',
      graph: articraftJointGraph(),
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
    await expectFactoryBridge(page)

    await page.evaluate((nodeId) => {
      const bridge = (
        window as Window & {
          __pascalFactoryE2e?: FactoryE2eBridge
        }
      ).__pascalFactoryE2e
      bridge?.selectNode(nodeId)
    }, articraftIds.root)

    await expect(page.getByRole('heading', { name: 'Joint crane root' })).toBeVisible({
      timeout: 30_000,
    })
    await expect
      .poll(
        () =>
          page.evaluate((ids) => {
            const bridge = (
              window as Window & {
                __pascalFactoryE2e?: FactoryE2eBridge
              }
            ).__pascalFactoryE2e
            const nodes = (bridge?.sceneNodes() ?? {}) as Record<string, SceneNode>
            return {
              rootRecordId: (nodes[ids.root]?.metadata?.articraft as { recordId?: string })
                ?.recordId,
              slewingRecordId: (nodes[ids.slewing]?.metadata?.articraft as { recordId?: string })
                ?.recordId,
              slewingJointName: (
                nodes[ids.slewing]?.metadata?.articraftJoint as { jointName?: string }
              )?.jointName,
              trolleyJointName: (
                nodes[ids.trolley]?.metadata?.articraftJoint as { jointName?: string }
              )?.jointName,
            }
          }, articraftIds),
        { timeout: 10_000 },
      )
      .toEqual({
        rootRecordId: 'rec_crane',
        slewingRecordId: 'rec_crane',
        slewingJointName: 'slewing_unit',
        trolleyJointName: 'upperworks_trolley_travel',
      })
    const jointSection = page.getByRole('button', { name: 'Articraft 关节控制' })
    await expect(jointSection).toHaveCount(1, { timeout: 10_000 })
    await jointSection.scrollIntoViewIfNeeded()
    await jointSection.click()
    await expect(page.getByTestId('articraft-joint-list')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId(`articraft-joint-control-${articraftIds.slewing}`)).toContainText(
      'slewing_unit',
    )
    await expect(page.getByTestId(`articraft-joint-control-${articraftIds.trolley}`)).toContainText(
      'upperworks_trolley_travel',
    )

    await page.getByTestId(`articraft-joint-reset-${articraftIds.slewing}`).click()
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
            const joint = node?.metadata?.articraftJoint as { currentValue?: number } | undefined
            return {
              currentValue: joint?.currentValue,
              rotationY: node?.rotation?.[1],
            }
          }, articraftIds.slewing),
        { timeout: 10_000 },
      )
      .toEqual({
        currentValue: 0,
        rotationY: 0,
      })
  } finally {
    await request.delete(`/api/scenes/${sceneId}`).catch(() => undefined)
  }
})

test('station rerun result replaces the semantic assembly on the canvas', async ({
  page,
  request,
}) => {
  const sceneId = `scene-structure-station-rerun-${Date.now()}-${test.info().parallelIndex}`
  const createResponse = await request.post('/api/scenes', {
    data: {
      id: sceneId,
      name: 'Scene Station Rerun E2E',
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
    await expectFactoryBridge(page)

    const rerunShellId = 'box_product_tank_shell_rerun_e2e'
    const appliedIds = await page.evaluate(
      ({ tankId, rerunShellId }) => {
        const bridge = (
          window as Window & {
            __pascalFactoryE2e?: FactoryE2eBridge
          }
        ).__pascalFactoryE2e
        return (
          bridge?.applyFactoryRun({
            workflowRerun: {
              sourceRunId: 'run_source_e2e',
              stageId: 'equipment-compiler',
              stationId: 'product_storage_tank',
            },
            qualityReport: { passed: true },
            patches: [
              {
                op: 'create',
                parentId: 'level_from_source_run',
                node: {
                  object: 'node',
                  id: tankId,
                  type: 'assembly',
                  name: 'Product tank farm rerun',
                  parentId: 'level_from_source_run',
                  children: [rerunShellId],
                  position: [5, 0, 0],
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
                      ports: [{ id: 'inlet', medium: 'product', side: 'west' }],
                    },
                  },
                },
              },
              {
                op: 'create',
                parentId: tankId,
                node: {
                  object: 'node',
                  id: rerunShellId,
                  type: 'box',
                  name: 'Tank shell rerun',
                  parentId: tankId,
                  position: [0, 1.2, 0],
                  rotation: [0, 0, 0],
                  visible: true,
                  metadata: {
                    processId: 'refinery_basic_complex',
                    stationId: 'product_storage_tank',
                    semanticRole: 'vessel_shell',
                  },
                },
              },
            ],
          }) ?? { nodeIds: [] }
        )
      },
      { tankId: ids.tank, rerunShellId },
    )

    expect(appliedIds.nodeIds).toEqual(expect.arrayContaining([ids.tank, rerunShellId]))
    expect(appliedIds.changePreview?.afterNodeCount).toBeGreaterThanOrEqual(
      appliedIds.changePreview?.beforeNodeCount ?? 0,
    )
    await expect
      .poll(
        () =>
          page.evaluate(
            ({ levelId, tankId, oldShellId, rerunShellId }) => {
              const bridge = (
                window as Window & {
                  __pascalFactoryE2e?: FactoryE2eBridge
                }
              ).__pascalFactoryE2e
              const nodes = (bridge?.sceneNodes() ?? {}) as Record<string, SceneNode>
              const level = nodes[levelId]
              const tank = nodes[tankId]
              const rerunShell = nodes[rerunShellId]
              const stationRoots = Object.values(nodes).filter(
                (node) =>
                  node.metadata?.stationId === 'product_storage_tank' &&
                  nodes[String(node.parentId)]?.metadata?.stationId !== 'product_storage_tank',
              )
              return {
                levelChildren: level?.children ?? [],
                tankName: tank?.name,
                tankParentId: tank?.parentId,
                tankChildren: tank?.children ?? [],
                oldShellExists: Boolean(nodes[oldShellId]),
                rerunShellParentId: rerunShell?.parentId,
                stationRootIds: stationRoots.map((node) => node.id).sort(),
              }
            },
            {
              levelId: ids.level,
              tankId: ids.tank,
              oldShellId: ids.tankShell,
              rerunShellId,
            },
          ),
        { timeout: 30_000 },
      )
      .toEqual({
        levelChildren: expect.arrayContaining([ids.tower, ids.pipe, ids.tank]),
        tankName: 'Product tank farm rerun',
        tankParentId: ids.level,
        tankChildren: [rerunShellId],
        oldShellExists: false,
        rerunShellParentId: ids.tank,
        stationRootIds: [ids.tank],
      })
  } finally {
    await request.delete(`/api/scenes/${sceneId}`).catch(() => undefined)
  }
})

test('dragging a fixed live data field onto a data binding label binds semantic equipment', async ({
  page,
  request,
}) => {
  const sceneId = `scene-structure-drag-data-binding-${Date.now()}-${test.info().parallelIndex}`
  const createResponse = await request.post('/api/scenes', {
    data: {
      id: sceneId,
      name: 'Scene Drag Data Binding E2E',
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
            return typeof bridge?.sceneNodes === 'function'
          }),
        { timeout: 30_000 },
      )
      .toBe(true)

    await page.getByTestId('sidebar-tab-site').click()
    await page.getByTestId('viewer-display-menu').click()
    await page.getByTestId('viewer-display-data-binding-overlay').click()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId(`data-lens-card-${ids.tank}`)).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId(`data-lens-status-${ids.tank}`)).toContainText('Ready to bind')

    await page.evaluate(
      ({ path, targetTestId }) => {
        const target = document.querySelector<HTMLElement>(`[data-testid="${targetTestId}"]`)
        if (!target) throw new Error('Missing drop target')
        const dataTransfer = new DataTransfer()
        dataTransfer.setData('application/x-pascal-live-data-path', path)
        dataTransfer.setData('text/plain', path)
        target.dispatchEvent(
          new DragEvent('dragover', {
            bubbles: true,
            cancelable: true,
            dataTransfer,
          }),
        )
        target.dispatchEvent(
          new DragEvent('drop', {
            bubbles: true,
            cancelable: true,
            dataTransfer,
          }),
        )
      },
      {
        path: 'refinery.tank.level',
        targetTestId: `data-lens-card-${ids.tank}`,
      },
    )

    await expect(page.getByTestId(`data-lens-status-${ids.tank}`)).toContainText('1 binding')
    await expect(page.getByTestId(`data-lens-binding-${ids.tank}`)).toContainText(
      'level: refinery.tank.level',
    )
    await expect(page.getByTestId(`data-lens-value-${ids.tank}`)).toContainText('62')

    await page.getByTestId(`data-lens-card-${ids.tank}`).click()
    await expect(page.getByRole('heading', { name: 'Product tank farm' })).toBeVisible()
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
