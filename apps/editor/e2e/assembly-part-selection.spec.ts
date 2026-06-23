import { expect, type Page, test } from '@playwright/test'

type SceneNode = {
  id?: string
  type?: string
  name?: string
  parentId?: string | null
  children?: string[]
  position?: [number, number, number]
  rotation?: [number, number, number]
  radius?: number
  height?: number
  radialSegments?: number
  length?: number
  width?: number
  materialPreset?: string
  metadata?: Record<string, unknown>
}

type FactoryE2eBridge = {
  cameraView: (view: 'isometric' | 'top' | 'side') => void
  clearSelection: () => void
  sceneNodes: () => Record<string, SceneNode>
  selectNode: (nodeId: string) => void
  setSelectMode: () => void
  selectedIds: () => string[]
  viewerFlags: () => { cameraDragging: boolean; inputDragging: boolean; spacePanning: boolean }
}

const AI_CHAT_STORAGE_KEY = 'pascal-ai-chat-panel-state:v1'

const ids = {
  building: 'building_part_select_e2e',
  level: 'level_part_select_e2e',
  assembly: 'assembly_rotary_kiln_e2e',
  shell: 'cylinder_rotary_kiln_shell_e2e',
  inlet: 'cylinder_rotary_kiln_inlet_e2e',
  outlet: 'cylinder_rotary_kiln_outlet_e2e',
  pier: 'box_rotary_kiln_pier_e2e',
} as const

function rotaryKilnGraph() {
  const nodes: Record<string, SceneNode> = {
    [ids.building]: {
      object: 'node',
      id: ids.building,
      type: 'building',
      name: 'E2E building',
      parentId: null,
      children: [ids.level],
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      visible: true,
      metadata: {},
    } as SceneNode,
    [ids.level]: {
      object: 'node',
      id: ids.level,
      type: 'level',
      name: 'E2E level',
      parentId: ids.building,
      children: [ids.assembly],
      level: 0,
      visible: true,
      metadata: {},
    } as SceneNode,
    [ids.assembly]: {
      object: 'node',
      id: ids.assembly,
      type: 'assembly',
      name: 'Rotary kiln',
      parentId: ids.level,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      children: [ids.shell, ids.inlet, ids.outlet, ids.pier],
      visible: true,
      metadata: { stationRole: 'rotary_kiln', artifactId: 'assembly-part-selection-e2e' },
    } as SceneNode,
    [ids.shell]: {
      object: 'node',
      id: ids.shell,
      type: 'cylinder',
      name: 'Kiln shell',
      parentId: ids.assembly,
      position: [0, 2, 0],
      rotation: [0, 0, Math.PI / 2],
      radius: 0.7,
      height: 6,
      radialSegments: 32,
      visible: true,
      materialPreset: 'metal',
      metadata: { semanticRole: 'kiln_shell' },
    } as SceneNode,
    [ids.inlet]: {
      object: 'node',
      id: ids.inlet,
      type: 'cylinder',
      name: 'Kiln inlet ring',
      parentId: ids.assembly,
      position: [-3.4, 2, 0],
      rotation: [0, 0, Math.PI / 2],
      radius: 0.7,
      height: 0.4,
      radialSegments: 32,
      visible: true,
      materialPreset: 'metal',
      metadata: { semanticRole: 'kiln_inlet_ring' },
    } as SceneNode,
    [ids.outlet]: {
      object: 'node',
      id: ids.outlet,
      type: 'cylinder',
      name: 'Kiln outlet ring',
      parentId: ids.assembly,
      position: [3.4, 2, 0],
      rotation: [0, 0, Math.PI / 2],
      radius: 0.7,
      height: 0.4,
      radialSegments: 32,
      visible: true,
      materialPreset: 'metal',
      metadata: { semanticRole: 'kiln_outlet_ring' },
    } as SceneNode,
    [ids.pier]: {
      object: 'node',
      id: ids.pier,
      type: 'box',
      name: 'Support pier',
      parentId: ids.assembly,
      position: [0, 0.45, 0],
      rotation: [0, 0, 0],
      length: 4.2,
      width: 1.4,
      height: 0.9,
      visible: true,
      materialPreset: 'concrete',
      metadata: { semanticRole: 'support_pier' },
    } as SceneNode,
  }

  return {
    nodes,
    rootNodeIds: [ids.building],
  }
}

async function seedAiPanel(page: Page) {
  await page.addInitScript(
    ({ key, state }) => window.localStorage.setItem(key, JSON.stringify(state)),
    {
      key: AI_CHAT_STORAGE_KEY,
      state: {
        conversationId: 'assembly-part-selection-e2e',
        messages: [],
        input: '',
        generationMode: 'primitive',
        conversationPurpose: 'factory',
        inputExpanded: false,
        updatedAt: new Date().toISOString(),
      },
    },
  )
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
            typeof bridge?.cameraView === 'function' &&
            typeof bridge.clearSelection === 'function' &&
            typeof bridge.sceneNodes === 'function' &&
            typeof bridge.selectNode === 'function' &&
            typeof bridge.setSelectMode === 'function' &&
            typeof bridge.selectedIds === 'function' &&
            typeof bridge.viewerFlags === 'function'
          )
        }),
      { timeout: 30_000 },
    )
    .toBe(true)
}

async function selectedIds(page: Page) {
  await expectFactoryBridge(page)
  return page.evaluate(() => {
    const bridge = (
      window as Window & {
        __pascalFactoryE2e?: FactoryE2eBridge
      }
    ).__pascalFactoryE2e
    return bridge?.selectedIds() ?? []
  })
}

async function setIsometricView(page: Page) {
  await expectFactoryBridge(page)
  await page.evaluate(() => {
    const bridge = (
      window as Window & {
        __pascalFactoryE2e?: FactoryE2eBridge
      }
    ).__pascalFactoryE2e
    bridge?.cameraView('isometric')
  })
}

async function activateSelectTool(page: Page) {
  await expectFactoryBridge(page)
  await page.evaluate(() => {
    const bridge = (
      window as Window & {
        __pascalFactoryE2e?: FactoryE2eBridge
      }
    ).__pascalFactoryE2e
    bridge?.setSelectMode()
  })
}

async function waitViewerInputIdle(page: Page) {
  await expectFactoryBridge(page)
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const bridge = (
            window as Window & {
              __pascalFactoryE2e?: FactoryE2eBridge
            }
          ).__pascalFactoryE2e
          return bridge?.viewerFlags() ?? null
        }),
      { timeout: 15_000 },
    )
    .toEqual({ cameraDragging: false, inputDragging: false, spacePanning: false })
}

async function selectNode(page: Page, nodeId: string) {
  await expectFactoryBridge(page)
  await page.evaluate((id) => {
    const bridge = (
      window as Window & {
        __pascalFactoryE2e?: FactoryE2eBridge
      }
    ).__pascalFactoryE2e
    bridge?.selectNode(id)
  }, nodeId)
  await expect.poll(() => selectedIds(page), { timeout: 15_000 }).toEqual([nodeId])
}

async function clearSelection(page: Page) {
  await expectFactoryBridge(page)
  await page.evaluate(() => {
    const bridge = (
      window as Window & {
        __pascalFactoryE2e?: FactoryE2eBridge
      }
    ).__pascalFactoryE2e
    bridge?.clearSelection()
  })
  await expect.poll(() => selectedIds(page), { timeout: 15_000 }).toEqual([])
}

type ScreenPoint = { x: number; y: number }

function kilnShellCandidatePoints(page: Page): ScreenPoint[] {
  const viewport = page.viewportSize() ?? { width: 1280, height: 720 }
  return [
    { x: viewport.width * 0.64, y: viewport.height * 0.4 },
    { x: viewport.width * 0.64, y: viewport.height * 0.44 },
    { x: viewport.width * 0.68, y: viewport.height * 0.39 },
    { x: viewport.width * 0.6, y: viewport.height * 0.39 },
    { x: viewport.width * 0.7, y: viewport.height * 0.44 },
    { x: viewport.width * 0.58, y: viewport.height * 0.44 },
  ]
}

async function clickKilnShell(page: Page, mode: 'click' | 'double', point?: ScreenPoint) {
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30_000 })
  const { x, y } = point ?? kilnShellCandidatePoints(page)[0]!
  if (mode === 'double') {
    await page.mouse.dblclick(x, y)
  } else {
    await page.mouse.click(x, y)
  }
}

async function clickKilnShellUntilSelected(page: Page, expectedId: string) {
  for (const point of kilnShellCandidatePoints(page)) {
    await clickKilnShell(page, 'click', point)
    await page.waitForTimeout(250)
    const selected = await selectedIds(page)
    if (selected.length === 1 && selected[0] === expectedId) return point
  }
  expect(await selectedIds(page)).toEqual([expectedId])
  return kilnShellCandidatePoints(page)[0]!
}

test('assembly rotary kiln parts can be selected by double-click and edit-parts mode', async ({
  page,
  request,
}) => {
  const sceneId = `assembly-part-selection-${Date.now()}-${test.info().parallelIndex}`
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(error.message))

  const createResponse = await request.post('/api/scenes', {
    data: {
      id: sceneId,
      name: 'Assembly part selection E2E',
      graph: rotaryKilnGraph(),
    },
  })
  expect(createResponse.status()).toBe(201)

  await seedAiPanel(page)

  try {
    await page.goto(`/scene/${sceneId}?factoryE2e=1`, {
      waitUntil: 'domcontentloaded',
      timeout: 180_000,
    })
    await expectFactoryBridge(page)
    await setIsometricView(page)
    await activateSelectTool(page)
    await page
      .getByText(/Rendering/i)
      .waitFor({ state: 'hidden', timeout: 60_000 })
      .catch(() => undefined)
    await waitViewerInputIdle(page)
    await page.waitForTimeout(500)

    const kilnPoint = await clickKilnShellUntilSelected(page, ids.assembly)
    await clearSelection(page)
    await page.keyboard.down('Space')
    try {
      await clickKilnShell(page, 'click', kilnPoint)
    } finally {
      await page.keyboard.up('Space')
    }
    await page.waitForTimeout(250)
    await expect.poll(() => selectedIds(page), { timeout: 5_000 }).toEqual([])

    const activeKilnPoint = await clickKilnShellUntilSelected(page, ids.assembly)
    await clickKilnShell(page, 'double', activeKilnPoint)
    await expect.poll(() => selectedIds(page), { timeout: 15_000 }).toEqual([ids.shell])

    await selectNode(page, ids.assembly)
    await activateSelectTool(page)
    await expect(page.getByRole('heading', { name: 'Rotary kiln' })).toBeVisible({
      timeout: 15_000,
    })
    await page.getByRole('button', { name: '\u7ec4\u5408' }).click()
    await page.getByRole('button', { name: '\u7f16\u8f91\u90e8\u4ef6' }).click()
    await expect.poll(() => selectedIds(page), { timeout: 15_000 }).toEqual([ids.assembly])

    await clickKilnShell(page, 'click', kilnPoint)
    await expect.poll(() => selectedIds(page), { timeout: 15_000 }).toEqual([ids.shell])
  } finally {
    await request.delete(`/api/scenes/${sceneId}`).catch(() => undefined)
  }

  expect(
    consoleErrors.filter(
      (line) => !line.includes('favicon') && !line.includes('ERR_CONNECTION_RESET'),
    ),
  ).toEqual([])
})
