import fs from 'node:fs/promises'
import { inflateSync } from 'node:zlib'
import { type APIRequestContext, expect, type Page, test } from '@playwright/test'

type Severity = 'error' | 'warning' | 'info'

type RenderQualityIssue = {
  code: string
  severity: Severity
  message: string
  url?: string
  stationId?: string
}

type SceneNode = {
  id?: string
  name?: string
  type?: string
  children?: string[]
  metadata?: Record<string, unknown>
  asset?: { id?: string; src?: string }
}

type FactoryE2eBridge = {
  sceneNodes: () => Record<string, SceneNode>
  applyFactoryRun: (data: unknown) => string[]
  cameraView: (view: 'isometric' | 'top' | 'side') => void
  selectNode: (nodeId: string) => void
  selectedIds: () => string[]
}

type RunPayload = {
  id?: string
  conversationId?: string
  status?: string
  error?: string
  result?: {
    qualityReport?: {
      score?: number
      passed?: boolean
      summary?: string
      issues?: unknown[]
    }
  }
}

function slimSceneNode(id: string, value: unknown): SceneNode {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const metadata =
    record.metadata && typeof record.metadata === 'object' && !Array.isArray(record.metadata)
      ? (record.metadata as Record<string, unknown>)
      : undefined
  const asset =
    record.asset && typeof record.asset === 'object' && !Array.isArray(record.asset)
      ? (record.asset as { id?: string; src?: string })
      : undefined
  return {
    id,
    type: typeof record.type === 'string' ? record.type : undefined,
    name: typeof record.name === 'string' ? record.name : undefined,
    children: Array.isArray(record.children) ? record.children.map(String) : undefined,
    metadata,
    asset,
  }
}

type PngMetrics = {
  width: number
  height: number
  sampledPixelCount: number
  uniqueColorBuckets: number
  nonTransparentRatio: number
  lumaStdDev: number
}

type FactoryRenderQualityReport = {
  score: number
  passed: boolean
  summary: string
  mode: RenderQaMode
  prompt: string
  sceneId: string
  conversationId: string
  runId?: string
  screenshotPath: string
  canvasScreenshotPath: string
  viewScreenshots: Array<{
    view: string
    canvasScreenshotPath: string
    metrics: PngMetrics
  }>
  issueCount: Record<Severity, number>
  checks: {
    runStatus?: string
    staticQualityScore?: number
    staticQualityPassed?: boolean
    sceneNodeCount: number
    renderableNodeCount: number
    keyStationCount: number
    keyStationPresentCount: number
    primitiveAssemblyCount: number
    catalogItemCount: number
    pipeCount: number
    cableTrayCount: number
    canvasNonBlank: boolean
    canvasMetrics: PngMetrics
    canvasMetricsByView: Record<string, PngMetrics>
    consoleErrorCount: number
    pageErrorCount: number
    assetRequestErrorCount: number
    requestFailureCount: number
  }
  issues: RenderQualityIssue[]
}

const AI_CHAT_STORAGE_KEY = 'pascal-ai-chat-panel-state:v1'
const EMPTY_GRAPH = {
  nodes: {},
  rootNodeIds: [],
}
type RenderQaMode = 'smoke' | 'full'
const RENDER_QA_MODE: RenderQaMode =
  process.env.FACTORY_RENDER_QA_MODE === 'full' ? 'full' : 'smoke'
const PROMPT =
  process.env.FACTORY_RENDER_QA_PROMPT ?? '\u751f\u6210\u4e00\u4e2a\u6c34\u6ce5\u5de5\u5382'
const KEY_STATIONS = [
  {
    id: 'preheater_tower',
    label: 'Preheater Tower',
    aliases: [
      'preheater_tower',
      'cement.preheater_tower',
      'preheater_tower_body',
      'Preheater Tower',
      '\u9884\u70ed\u5668\u5854',
      '\u9884\u70ed\u5854',
      '\u9884\u70ed\u5668',
    ],
  },
  {
    id: 'rotary_kiln',
    label: 'Rotary Kiln',
    aliases: [
      'rotary_kiln',
      'cement.rotary_kiln',
      'kiln_shell',
      'Rotary Kiln',
      '\u56de\u8f6c\u7a91',
    ],
  },
  {
    id: 'kiln_hood',
    label: 'Kiln Hood',
    aliases: [
      'kiln_hood',
      'cement.kiln_hood',
      'kiln_hood_shell',
      'Kiln Hood',
      '\u7a91\u5934\u7f69',
      '\u7a91\u5934',
    ],
  },
  {
    id: 'grate_cooler',
    label: 'Grate Cooler',
    aliases: [
      'grate_cooler',
      'cement.grate_cooler',
      'grate_bed',
      'Grate Cooler',
      'Clinker Cooler',
      '\u7be6\u51b7\u673a',
      '\u51b7\u5374\u673a',
    ],
  },
]
const RUN_TIMEOUT_MS = RENDER_QA_MODE === 'full' ? 600_000 : 120_000
const TEST_TIMEOUT_MS = RENDER_QA_MODE === 'full' ? 720_000 : 240_000

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
            typeof bridge.applyFactoryRun === 'function' &&
            typeof bridge.selectNode === 'function' &&
            typeof bridge.selectedIds === 'function'
          )
        }),
      { timeout: 30_000 },
    )
    .toBe(true)
}

async function readCanvasNodes(page: Page): Promise<SceneNode[]> {
  await expectFactoryBridge(page)
  return page.evaluate(() => {
    const bridge = (
      window as Window & {
        __pascalFactoryE2e?: FactoryE2eBridge
      }
    ).__pascalFactoryE2e
    return Object.entries(bridge?.sceneNodes() ?? {}).map(([id, node]) => {
      const record = node && typeof node === 'object' ? (node as Record<string, unknown>) : {}
      const metadata =
        record.metadata && typeof record.metadata === 'object' && !Array.isArray(record.metadata)
          ? (record.metadata as Record<string, unknown>)
          : undefined
      const asset =
        record.asset && typeof record.asset === 'object' && !Array.isArray(record.asset)
          ? (record.asset as { id?: string; src?: string })
          : undefined
      return {
        id,
        type: typeof record.type === 'string' ? record.type : undefined,
        name: typeof record.name === 'string' ? record.name : undefined,
        children: Array.isArray(record.children) ? record.children.map(String) : undefined,
        metadata,
        asset,
      }
    })
  })
}

function sceneNodesFromRunResult(data: unknown): SceneNode[] {
  const result = data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
  const patches = Array.isArray(result.patches) ? result.patches : []
  return patches
    .map((patch): SceneNode | undefined => {
      if (!patch || typeof patch !== 'object') return undefined
      const record = patch as Record<string, unknown>
      if (record.op !== 'create') return undefined
      const node = record.node
      if (!node || typeof node !== 'object') return undefined
      const nodeRecord = node as Record<string, unknown>
      const id = typeof nodeRecord.id === 'string' ? nodeRecord.id : undefined
      if (!id) return undefined
      return slimSceneNode(id, node)
    })
    .filter((node): node is SceneNode => Boolean(node))
}

async function applyFactoryRunToCanvas(page: Page, data: unknown) {
  await expectFactoryBridge(page)
  return page.evaluate((payload) => {
    const bridge = (
      window as Window & {
        __pascalFactoryE2e?: FactoryE2eBridge
      }
    ).__pascalFactoryE2e
    return bridge?.applyFactoryRun(payload) ?? []
  }, data)
}

async function setFactoryCameraView(page: Page, view: 'isometric' | 'top' | 'side') {
  await expectFactoryBridge(page)
  await page.evaluate((nextView) => {
    const bridge = (
      window as Window & {
        __pascalFactoryE2e?: FactoryE2eBridge
      }
    ).__pascalFactoryE2e
    bridge?.cameraView(nextView)
  }, view)
  await page.waitForTimeout(900)
}

async function loadRun(request: APIRequestContext, runId: string) {
  const response = await request
    .get(`/api/ai-harness/runs/${encodeURIComponent(runId)}`)
    .catch(() => null)
  if (!response) return undefined
  expect(response.ok()).toBe(true)
  const payload = (await response.json()) as { run?: RunPayload }
  return payload.run
}

async function createFactoryRun(request: APIRequestContext, conversationId: string) {
  const response = await request.post('/api/ai-harness/runs', {
    data: {
      conversationId,
      mode: 'factory',
      prompt: PROMPT,
      params: RENDER_QA_MODE === 'smoke' ? { e2eSmoke: true } : {},
    },
  })
  expect(response.ok()).toBe(true)
  const payload = (await response.json()) as { runId?: string }
  expect(payload.runId).toBeTruthy()
  return payload.runId!
}

function isTrackedAssetUrl(url: string) {
  return /\/items\/|\.glb(?:[?#]|$)|\.gltf(?:[?#]|$)|\/assets\//i.test(url)
}

function isRendererError(message: string) {
  if (/^Failed to load resource:/i.test(message)) return false
  return /\[viewer\]|webgpu|three|gltf|glb|could not load|renderer/i.test(message)
}

function readUInt32(buffer: Buffer, offset: number) {
  return buffer.readUInt32BE(offset)
}

function paeth(left: number, up: number, upLeft: number) {
  const p = left + up - upLeft
  const pa = Math.abs(p - left)
  const pb = Math.abs(p - up)
  const pc = Math.abs(p - upLeft)
  if (pa <= pb && pa <= pc) return left
  return pb <= pc ? up : upLeft
}

function pngMetrics(buffer: Buffer): PngMetrics {
  if (buffer.subarray(0, 8).compare(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) !== 0) {
    throw new Error('screenshot is not a PNG')
  }

  let offset = 8
  let width = 0
  let height = 0
  let colorType = 0
  let bitDepth = 0
  const idat: Buffer[] = []
  while (offset < buffer.length) {
    const length = readUInt32(buffer, offset)
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii')
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = readUInt32(data, 0)
      height = readUInt32(data, 4)
      bitDepth = data[8] ?? 0
      colorType = data[9] ?? 0
      if ((data[12] ?? 0) !== 0) throw new Error('interlaced PNG screenshots are not supported')
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + length
  }

  if (bitDepth !== 8) throw new Error(`unsupported PNG bit depth ${bitDepth}`)
  const channels =
    colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 0 ? 1 : 0
  if (!channels) throw new Error(`unsupported PNG color type ${colorType}`)

  const inflated = inflateSync(Buffer.concat(idat))
  const rowBytes = width * channels
  let inputOffset = 0
  let previous = Buffer.alloc(rowBytes)
  const buckets = new Set<string>()
  let sampledPixelCount = 0
  let nonTransparent = 0
  let lumaSum = 0
  let lumaSquaredSum = 0
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 80_000)))

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[inputOffset] ?? 0
    inputOffset += 1
    const raw = Buffer.from(inflated.subarray(inputOffset, inputOffset + rowBytes))
    inputOffset += rowBytes
    const row = Buffer.alloc(rowBytes)
    for (let x = 0; x < rowBytes; x += 1) {
      const left = x >= channels ? (row[x - channels] ?? 0) : 0
      const up = previous[x] ?? 0
      const upLeft = x >= channels ? (previous[x - channels] ?? 0) : 0
      const value = raw[x] ?? 0
      row[x] =
        filter === 0
          ? value
          : filter === 1
            ? (value + left) & 255
            : filter === 2
              ? (value + up) & 255
              : filter === 3
                ? (value + Math.floor((left + up) / 2)) & 255
                : filter === 4
                  ? (value + paeth(left, up, upLeft)) & 255
                  : value
    }
    previous = row

    if (y % step !== 0) continue
    for (let x = 0; x < width; x += step) {
      const pixelOffset = x * channels
      const r = row[pixelOffset] ?? 0
      const g = colorType === 0 || colorType === 4 ? r : (row[pixelOffset + 1] ?? 0)
      const b = colorType === 0 || colorType === 4 ? r : (row[pixelOffset + 2] ?? 0)
      const alpha =
        colorType === 6
          ? (row[pixelOffset + 3] ?? 255)
          : colorType === 4
            ? (row[pixelOffset + 1] ?? 255)
            : 255
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
      sampledPixelCount += 1
      if (alpha > 16) nonTransparent += 1
      lumaSum += luma
      lumaSquaredSum += luma * luma
      buckets.add(`${r >> 4},${g >> 4},${b >> 4},${alpha >> 4}`)
    }
  }

  const mean = sampledPixelCount > 0 ? lumaSum / sampledPixelCount : 0
  const variance =
    sampledPixelCount > 0 ? Math.max(0, lumaSquaredSum / sampledPixelCount - mean * mean) : 0
  return {
    width,
    height,
    sampledPixelCount,
    uniqueColorBuckets: buckets.size,
    nonTransparentRatio: sampledPixelCount > 0 ? nonTransparent / sampledPixelCount : 0,
    lumaStdDev: Math.sqrt(variance),
  }
}

function sceneStats(nodes: SceneNode[], visibleText: string) {
  const stationMarkers = new Set(
    nodes.flatMap((node) =>
      [
        node.name,
        node.metadata?.stationId,
        node.metadata?.factoryStationId,
        node.metadata?.stationRole,
        node.metadata?.factoryStationRole,
        node.metadata?.stationLabel,
        node.metadata?.stationDisplayLabel,
        node.metadata?.equipmentRole,
        node.metadata?.sourceTool,
      ].filter((value): value is string => typeof value === 'string' && value.length > 0),
    ),
  )
  for (const node of nodes) {
    const contract = node.metadata?.equipmentContract
    if (!contract || typeof contract !== 'object' || Array.isArray(contract)) continue
    const contractRecord = contract as Record<string, unknown>
    for (const value of [
      contractRecord.profileId,
      contractRecord.equipmentFamily,
      contractRecord.scaleClass,
    ]) {
      if (typeof value === 'string' && value.length > 0) stationMarkers.add(value)
    }
  }
  const normalizedStationMarkers = [...stationMarkers].map((marker) => marker.toLowerCase())
  const normalizedVisibleText = visibleText.toLowerCase()
  const keyStationPresent = KEY_STATIONS.filter(
    (station) =>
      stationMarkers.has(station.id) ||
      station.aliases.some((alias) => {
        const normalizedAlias = alias.toLowerCase()
        return (
          normalizedStationMarkers.some((marker) => marker.includes(normalizedAlias)) ||
          normalizedVisibleText.includes(normalizedAlias)
        )
      }),
  )
  const renderableNodes = nodes.filter((node) => node.type && node.type !== 'zone')
  return {
    sceneNodeCount: nodes.length,
    renderableNodeCount: renderableNodes.length,
    keyStationPresent,
    primitiveAssemblyCount: nodes.filter(
      (node) => node.type === 'assembly' && node.metadata?.generatedBy === 'factory-agent',
    ).length,
    catalogItemCount: nodes.filter((node) => node.type === 'item').length,
    pipeCount: nodes.filter((node) => node.type === 'pipe').length,
    cableTrayCount: nodes.filter((node) => node.type === 'cable-tray').length,
  }
}

function addIssue(
  issues: RenderQualityIssue[],
  severity: Severity,
  code: string,
  message: string,
  extra: Omit<RenderQualityIssue, 'severity' | 'code' | 'message'> = {},
) {
  issues.push({ severity, code, message, ...extra })
}

function buildReport(input: {
  prompt: string
  sceneId: string
  conversationId: string
  run?: RunPayload
  screenshotPath: string
  canvasScreenshotPath: string
  viewScreenshots: FactoryRenderQualityReport['viewScreenshots']
  nodes: SceneNode[]
  canvasMetrics: PngMetrics
  consoleErrors: string[]
  pageErrors: string[]
  assetRequestErrors: Array<{ url: string; status?: number; error?: string }>
  requestFailures: Array<{ url: string; error?: string }>
  visibleText: string
}): FactoryRenderQualityReport {
  const issues: RenderQualityIssue[] = []
  const stats = sceneStats(input.nodes, input.visibleText)
  const canvasNonBlank =
    input.canvasMetrics.nonTransparentRatio > 0.95 &&
    input.canvasMetrics.uniqueColorBuckets >= 10 &&
    input.canvasMetrics.lumaStdDev >= 3
  const staticQuality = input.run?.result?.qualityReport

  if (!input.run) {
    addIssue(issues, 'error', 'factory_run_missing', 'No factory run was found.')
  } else if (input.run.status !== 'succeeded') {
    addIssue(
      issues,
      'error',
      'factory_run_failed',
      `Factory run ended with status ${input.run.status ?? 'unknown'}.`,
    )
  }
  if (staticQuality && staticQuality.passed !== true) {
    addIssue(
      issues,
      'error',
      'static_quality_failed',
      staticQuality.summary ?? 'Static factory quality report did not pass.',
    )
  }
  if (stats.sceneNodeCount < 25) {
    addIssue(
      issues,
      'error',
      'scene_nodes_missing',
      `Only ${stats.sceneNodeCount} scene nodes were present after generation.`,
    )
  }
  for (const station of KEY_STATIONS) {
    if (!stats.keyStationPresent.some((present) => present.id === station.id)) {
      addIssue(
        issues,
        'warning',
        'key_station_missing',
        `Key station ${station.label} is missing.`,
        {
          stationId: station.id,
        },
      )
    }
  }
  if (!canvasNonBlank) {
    addIssue(
      issues,
      'error',
      'canvas_blank_or_low_variance',
      `Canvas screenshot has low variance: ${input.canvasMetrics.uniqueColorBuckets} color buckets, luma stddev ${input.canvasMetrics.lumaStdDev.toFixed(2)}.`,
    )
  }
  for (const view of input.viewScreenshots) {
    const viewNonBlank =
      view.metrics.nonTransparentRatio > 0.95 &&
      view.metrics.uniqueColorBuckets >= 10 &&
      view.metrics.lumaStdDev >= 3
    if (!viewNonBlank) {
      addIssue(
        issues,
        'error',
        'canvas_view_blank_or_low_variance',
        `Canvas ${view.view} screenshot has low variance: ${view.metrics.uniqueColorBuckets} color buckets, luma stddev ${view.metrics.lumaStdDev.toFixed(2)}.`,
      )
    }
  }
  for (const error of input.assetRequestErrors) {
    addIssue(
      issues,
      'error',
      'asset_request_failed',
      error.status ? `Asset request failed with HTTP ${error.status}.` : 'Asset request failed.',
      { url: error.url },
    )
  }
  for (const failure of input.requestFailures.filter((failure) => isTrackedAssetUrl(failure.url))) {
    addIssue(issues, 'error', 'asset_request_failed', failure.error ?? 'Asset request failed.', {
      url: failure.url,
    })
  }
  for (const message of input.consoleErrors.filter(isRendererError)) {
    addIssue(issues, 'warning', 'renderer_console_error', message)
  }
  for (const message of input.pageErrors) {
    addIssue(issues, 'error', 'page_error', message)
  }

  const issueCount = {
    error: issues.filter((issue) => issue.severity === 'error').length,
    warning: issues.filter((issue) => issue.severity === 'warning').length,
    info: issues.filter((issue) => issue.severity === 'info').length,
  }
  const score = Math.max(0, 100 - issueCount.error * 25 - issueCount.warning * 6 - issueCount.info)
  const passed = issueCount.error === 0 && score >= 70
  return {
    score,
    passed,
    summary: passed
      ? issueCount.warning > 0
        ? `Factory render quality passed with warnings (${score}/100).`
        : `Factory render quality passed (${score}/100).`
      : `Factory render quality needs review (${score}/100).`,
    mode: RENDER_QA_MODE,
    prompt: input.prompt,
    sceneId: input.sceneId,
    conversationId: input.conversationId,
    ...(input.run?.id ? { runId: input.run.id } : {}),
    screenshotPath: input.screenshotPath,
    canvasScreenshotPath: input.canvasScreenshotPath,
    viewScreenshots: input.viewScreenshots,
    issueCount,
    checks: {
      runStatus: input.run?.status,
      staticQualityScore: staticQuality?.score,
      staticQualityPassed: staticQuality?.passed,
      sceneNodeCount: stats.sceneNodeCount,
      renderableNodeCount: stats.renderableNodeCount,
      keyStationCount: KEY_STATIONS.length,
      keyStationPresentCount: stats.keyStationPresent.length,
      primitiveAssemblyCount: stats.primitiveAssemblyCount,
      catalogItemCount: stats.catalogItemCount,
      pipeCount: stats.pipeCount,
      cableTrayCount: stats.cableTrayCount,
      canvasNonBlank,
      canvasMetrics: input.canvasMetrics,
      canvasMetricsByView: Object.fromEntries(
        input.viewScreenshots.map((view) => [view.view, view.metrics]),
      ),
      consoleErrorCount: input.consoleErrors.length,
      pageErrorCount: input.pageErrors.length,
      assetRequestErrorCount: input.assetRequestErrors.length,
      requestFailureCount: input.requestFailures.length,
    },
    issues,
  }
}

test('factory render QA scores generated cement plant after canvas render', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(TEST_TIMEOUT_MS)
  const sceneId = `factory-render-qa-${Date.now()}-${test.info().parallelIndex}`
  let conversationId = ''
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  const assetRequestErrors: Array<{ url: string; status?: number; error?: string }> = []
  const requestFailures: Array<{ url: string; error?: string }> = []

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('requestfailed', (failedRequest) => {
    requestFailures.push({
      url: failedRequest.url(),
      error: failedRequest.failure()?.errorText,
    })
  })
  page.on('response', (response) => {
    if (response.status() < 400 || !isTrackedAssetUrl(response.url())) return
    assetRequestErrors.push({ url: response.url(), status: response.status() })
  })

  const createResponse = await request.post('/api/scenes', {
    data: {
      id: sceneId,
      name: 'Factory render QA smoke',
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
    await page.goto(`/scene/${sceneId}?factoryE2e=1`, {
      waitUntil: 'domcontentloaded',
      timeout: 90_000,
    })
    await expectFactoryBridge(page)
    const runId = await createFactoryRun(request, conversationId)
    let run: RunPayload | undefined
    await expect
      .poll(
        async () => {
          run = await loadRun(request, runId)
          return run?.status
        },
        { timeout: RUN_TIMEOUT_MS },
      )
      .toBe('succeeded')

    const appliedNodeIds = await applyFactoryRunToCanvas(page, run?.result)
    expect(appliedNodeIds.length).toBeGreaterThanOrEqual(25)
    const canvasNodeCount = await expect
      .poll(async () => (await readCanvasNodes(page)).length, { timeout: 30_000 })
      .toBeGreaterThanOrEqual(25)
      .then(() => readCanvasNodes(page).then((nodes) => nodes.length))
      .catch(() => 0)
    await page.waitForTimeout(2_000)

    const canvasNodes = canvasNodeCount >= 25 ? await readCanvasNodes(page) : []
    const nodes = canvasNodes.length >= 25 ? canvasNodes : sceneNodesFromRunResult(run?.result)
    expect(nodes.length).toBeGreaterThanOrEqual(25)
    const canvas = page.locator('canvas').first()
    await expect(canvas).toBeVisible({ timeout: 30_000 })
    const canvasScreenshotPath = testInfo.outputPath(
      `factory-render-quality-${RENDER_QA_MODE}-canvas.png`,
    )
    const screenshotPath = testInfo.outputPath(`factory-render-quality-${RENDER_QA_MODE}-page.png`)
    const reportPath = testInfo.outputPath(`factory-render-quality-${RENDER_QA_MODE}-report.json`)
    const canvasBuffer = await canvas.screenshot({ path: canvasScreenshotPath })
    await page.screenshot({ path: screenshotPath, fullPage: true })
    const viewScreenshots: FactoryRenderQualityReport['viewScreenshots'] = [
      {
        view: 'isometric',
        canvasScreenshotPath,
        metrics: pngMetrics(canvasBuffer),
      },
    ]
    for (const view of ['top', 'side'] as const) {
      await setFactoryCameraView(page, view)
      const viewCanvasScreenshotPath = testInfo.outputPath(
        `factory-render-quality-${RENDER_QA_MODE}-${view}-canvas.png`,
      )
      const viewCanvasBuffer = await canvas.screenshot({ path: viewCanvasScreenshotPath })
      viewScreenshots.push({
        view,
        canvasScreenshotPath: viewCanvasScreenshotPath,
        metrics: pngMetrics(viewCanvasBuffer),
      })
    }

    const report = buildReport({
      prompt: PROMPT,
      sceneId,
      conversationId,
      run,
      screenshotPath,
      canvasScreenshotPath,
      viewScreenshots,
      nodes,
      canvasMetrics: viewScreenshots[0]?.metrics ?? pngMetrics(canvasBuffer),
      consoleErrors,
      pageErrors,
      assetRequestErrors,
      requestFailures,
      visibleText: await page.locator('body').innerText(),
    })
    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    console.log(JSON.stringify(report, null, 2))
    await testInfo.attach('factory-render-quality-report', {
      path: reportPath,
      contentType: 'application/json',
    })
    await testInfo.attach('factory-render-quality-canvas', {
      path: canvasScreenshotPath,
      contentType: 'image/png',
    })
    for (const view of viewScreenshots.slice(1)) {
      await testInfo.attach(`factory-render-quality-${view.view}-canvas`, {
        path: view.canvasScreenshotPath,
        contentType: 'image/png',
      })
    }

    expect(report.passed, JSON.stringify(report.issues, null, 2)).toBe(true)
  } finally {
    await request.delete(`/api/scenes/${sceneId}`).catch(() => undefined)
    if (conversationId) {
      await request
        .delete(`/api/ai-harness/conversations/${encodeURIComponent(conversationId)}`)
        .catch(() => undefined)
    }
  }
})
