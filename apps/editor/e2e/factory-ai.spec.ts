import { type APIRequestContext, expect, type Page, test } from '@playwright/test'

type SceneNode = {
  id?: string
  type?: string
  name?: string
  parentId?: string
  children?: string[]
  color?: string
  kind?: string
  shellColor?: string
  material?: { properties?: { color?: string } }
  materialPreset?: string | null
  metadata?: Record<string, unknown>
  asset?: { id?: string }
}

type SceneNodeWithId = SceneNode & { id: string }

type StoredScene = {
  graph?: {
    nodes?: Record<string, SceneNode>
  }
  version?: number
}

const EMPTY_GRAPH = {
  nodes: {},
  rootNodeIds: [],
}
const AI_CHAT_STORAGE_KEY = 'pascal-ai-chat-panel-state:v1'

type FactoryE2eBridge = {
  sceneNodes: () => Record<string, SceneNode>
  selectNode: (nodeId: string) => void
  selectedIds: () => string[]
}

async function readSceneNodes(
  request: APIRequestContext,
  sceneId: string,
): Promise<SceneNodeWithId[]> {
  const response = await request.get(`/api/scenes/${sceneId}`)
  expect(response.ok()).toBe(true)
  const scene = (await response.json()) as StoredScene
  return Object.entries(scene.graph?.nodes ?? {}).map(([id, node]) => ({
    ...node,
    id: node.id ?? id,
  }))
}

async function submitFactoryPrompt(page: Page, prompt: string) {
  const factoryInput = page.getByTestId('factory-chat-input')
  const sendButton = page.getByTestId('factory-chat-send')
  await expect(factoryInput).toBeVisible({ timeout: 30_000 })
  await factoryInput.fill(prompt)
  await expect(sendButton).toBeEnabled({ timeout: 30_000 })
  await sendButton.click()
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
            typeof bridge?.sceneNodes === 'function' &&
            typeof bridge.selectNode === 'function' &&
            typeof bridge.selectedIds === 'function'
          )
        }),
      { timeout: 30_000 },
    )
    .toBe(true)
}

async function readCanvasNodes(page: Page): Promise<SceneNodeWithId[]> {
  await expectFactoryBridge(page)
  return page.evaluate(() => {
    const bridge = (
      window as Window & {
        __pascalFactoryE2e?: FactoryE2eBridge
      }
    ).__pascalFactoryE2e
    return Object.entries(bridge?.sceneNodes() ?? {}).map(([id, node]) => ({
      ...(node as SceneNode),
      id,
    }))
  })
}

async function selectSceneNode(page: Page, nodeId: string) {
  await expectFactoryBridge(page)

  await page.evaluate((id) => {
    const bridge = (
      window as Window & {
        __pascalFactoryE2e?: FactoryE2eBridge
      }
    ).__pascalFactoryE2e
    bridge?.selectNode(id)
  }, nodeId)

  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const bridge = (
            window as Window & {
              __pascalFactoryE2e?: FactoryE2eBridge
            }
          ).__pascalFactoryE2e
          return bridge?.selectedIds() ?? []
        }),
      { timeout: 15_000 },
    )
    .toEqual([nodeId])
}

function nodeDisplayColor(node: SceneNode) {
  return node.material?.properties?.color ?? node.shellColor ?? node.color
}

test('factory chat creates a water electrolysis workshop from native scene patches', async ({
  page,
  request,
}) => {
  const sceneId = `factory-e2e-${Date.now()}-${test.info().parallelIndex}`
  let conversationId = ''
  const consoleErrors: string[] = []
  const legacyFactoryAssetRequests: string[] = []

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(error.message))
  page.on('request', (request) => {
    const url = request.url()
    if (/\/items\/factory-extractor/.test(url)) {
      legacyFactoryAssetRequests.push(url)
    }
  })

  const createResponse = await request.post('/api/scenes', {
    data: {
      id: sceneId,
      name: 'Factory E2E smoke',
      graph: EMPTY_GRAPH,
    },
  })
  expect(createResponse.status()).toBe(201)

  const conversationResponse = await request.post('/api/ai-harness/conversations')
  expect(conversationResponse.ok()).toBe(true)
  const conversationPayload = (await conversationResponse.json()) as { conversationId?: string }
  conversationId = conversationPayload.conversationId ?? ''
  expect(conversationId).toBeTruthy()

  await page.addInitScript(
    ({ key, state }) => window.localStorage.setItem(key, JSON.stringify(state)),
    {
      key: AI_CHAT_STORAGE_KEY,
      state: {
        conversationId,
        messages: [],
        input: '',
        generationMode: 'primitive',
        conversationPurpose: 'factory',
        inputExpanded: false,
        updatedAt: new Date().toISOString(),
      },
    },
  )

  try {
    await page.goto(`/scene/${sceneId}`, { waitUntil: 'domcontentloaded', timeout: 90_000 })

    await submitFactoryPrompt(page, 'create a chemical factory hydrogen electrolysis workshop')
    await expect
      .poll(
        async () => {
          const nodes = await readCanvasNodes(page)
          return {
            hasTank: nodes.some((node) => node.type === 'tank'),
            hasPipe: nodes.some((node) => node.type === 'pipe'),
            hasPipeFitting: nodes.some((node) => node.type === 'pipe-fitting'),
            hasCableTray: nodes.some((node) => node.type === 'cable-tray'),
            hasElectrolyzerAssembly: nodes.some(
              (node) =>
                node.type === 'assembly' &&
                node.metadata?.artifactId === 'ai_geometry_factory_e2e_electrolyzer' &&
                node.metadata?.stationRole === 'electrolyzer',
            ),
            hasCatalogItem: nodes.some(
              (node) =>
                node.type === 'item' &&
                node.metadata?.catalogItemId === 'factory-electric-box' &&
                node.metadata?.processCatalogQualified === true,
            ),
          }
        },
        { timeout: 30_000 },
      )
      .toEqual({
        hasTank: true,
        hasPipe: true,
        hasPipeFitting: true,
        hasCableTray: true,
        hasElectrolyzerAssembly: true,
        hasCatalogItem: true,
      })
    await expect(page.locator('body')).toContainText(/(?:Create|Scene) patches: \d+/)
    await expect(page.locator('body')).not.toContainText(/factory-extractor/)

    const createdNodes = await readCanvasNodes(page)
    const electrolyzerAssembly = createdNodes.find(
      (node) =>
        node.type === 'assembly' &&
        node.metadata?.artifactId === 'ai_geometry_factory_e2e_electrolyzer' &&
        node.metadata?.stationRole === 'electrolyzer',
    )
    expect(electrolyzerAssembly?.id).toBeTruthy()
    expect(electrolyzerAssembly?.children?.length).toBeGreaterThan(0)

    await selectSceneNode(page, electrolyzerAssembly!.id!)
    await submitFactoryPrompt(page, 'make the selected object green')

    await expect
      .poll(
        async () => {
          const nodes = await readCanvasNodes(page)
          const byId = new Map(nodes.map((node) => [node.id, node]))
          const assembly = byId.get(electrolyzerAssembly!.id!)
          const childIds = assembly?.children ?? []
          return {
            childCount: childIds.length,
            greenChildCount: childIds.filter(
              (childId) => nodeDisplayColor(byId.get(childId) ?? {}) === '#22c55e',
            ).length,
          }
        },
        { timeout: 30_000 },
      )
      .toEqual({
        childCount: electrolyzerAssembly!.children!.length,
        greenChildCount: electrolyzerAssembly!.children!.length,
      })

    const tankNodes = await readCanvasNodes(page)
    const tank = tankNodes.find((node) => node.type === 'tank')
    expect(tank?.id).toBeTruthy()
    const targetTankKind = tank?.kind === 'horizontal' ? 'vertical' : 'horizontal'

    await selectSceneNode(page, tank!.id!)
    await submitFactoryPrompt(page, `make the selected tank ${targetTankKind}`)

    await expect
      .poll(
        async () => {
          const nodes = await readCanvasNodes(page)
          return nodes.find((node) => node.id === tank!.id)?.kind
        },
        { timeout: 30_000 },
      )
      .toBe(targetTankKind)

    await expect
      .poll(
        async () => {
          const nodes = await readSceneNodes(request, sceneId)
          const byId = new Map(nodes.map((node) => [node.id, node]))
          const assembly = byId.get(electrolyzerAssembly!.id!)
          const childIds = assembly?.children ?? []
          return {
            greenChildCount: childIds.filter(
              (childId) => nodeDisplayColor(byId.get(childId) ?? {}) === '#22c55e',
            ).length,
            hasCatalogItem: nodes.some(
              (node) =>
                node.type === 'item' &&
                node.metadata?.catalogItemId === 'factory-electric-box' &&
                node.metadata?.processCatalogQualified === true,
            ),
            tankKind: byId.get(tank!.id)?.kind,
          }
        },
        { timeout: 75_000 },
      )
      .toEqual({
        greenChildCount: electrolyzerAssembly!.children!.length,
        hasCatalogItem: true,
        tankKind: targetTankKind,
      })

    expect(legacyFactoryAssetRequests).toEqual([])
    expect(
      consoleErrors.filter((message) =>
        /factory-extractor|Could not load.*factory-extractor/i.test(message),
      ),
    ).toEqual([])
  } finally {
    await request.delete(`/api/scenes/${sceneId}`).catch(() => undefined)
    if (conversationId) {
      await request
        .delete(`/api/ai-harness/conversations/${encodeURIComponent(conversationId)}`)
        .catch(() => undefined)
    }
  }
})
