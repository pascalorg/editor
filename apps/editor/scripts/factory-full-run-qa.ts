import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { inflateSync } from 'node:zlib'
import { applyFactoryScenePatchesToGraph } from '../../../packages/editor/src/lib/factory-scene-patch-apply'
import { findRepoRoot, sanitizeSegment } from '../lib/generated-assets/manifest'

type Severity = 'error' | 'warning' | 'info'
type CameraView = 'isometric' | 'top' | 'side'

export type FactoryFullRunQaOptions = {
  prompt: string
  baseUrl: string
  outputDir?: string
  conversationId: string
  sceneId?: string
  mode: 'smoke' | 'full'
  views: CameraView[]
  keyStationIds: string[]
  keepScene: boolean
  timeoutMs: number
}

export type PngMetrics = {
  width: number
  height: number
  sampledPixelCount: number
  uniqueColorBuckets: number
  nonTransparentRatio: number
  lumaStdDev: number
}

type VisualSmokeIssue = {
  severity: Severity
  code: string
  message: string
  view?: string
}

type SceneNode = {
  id?: string
  type?: string
  name?: string
  parentId?: string | null
  children?: string[]
  metadata?: Record<string, unknown>
}

type RunPayload = {
  id?: string
  status?: string
  prompt?: string
  result?: {
    patches?: unknown[]
    qualityReport?: {
      score?: number
      passed?: boolean
      issues?: unknown[]
      metrics?: Record<string, unknown>
    }
  }
}

type CanvasShot = {
  view: CameraView
  path: string
  sha256: string
  metrics: PngMetrics
}

type VisualSmokeReport = {
  createdAt: string
  prompt: string
  mode: 'smoke' | 'full'
  baseUrl: string
  sceneId: string
  sceneUrl: string
  runId?: string
  outputDir: string
  passed: boolean
  score: number
  issueCount: Record<Severity, number>
  checks: {
    runStatus?: string
    staticQualityPassed?: boolean
    staticQualityScore?: number
    patchCount: number
    nodeCount: number
    rootNodeCount: number
    stationAssemblyCount: number
    keyStationIds: string[]
    presentKeyStationIds: string[]
    canvasCount: number
    canvasScreenshots: CanvasShot[]
    viewsDistinct: boolean
    consoleErrorCount: number
    pageErrorCount: number
    requestFailureCount: number
  }
  files: {
    run: string
    sceneGraph: string
    report: string
    screenshots: Record<string, string>
  }
  issues: VisualSmokeIssue[]
}

const DEFAULT_PROMPT = '\u751f\u6210\u4e00\u4e2a\u6c34\u6ce5\u5de5\u5382'
const DEFAULT_KEY_STATIONS = [
  'preheater_tower',
  'rotary_kiln',
  'kiln_hood',
  'grate_cooler',
  'clinker_crusher',
  'process_stack',
]

function usage() {
  return [
    'Usage: bun apps/editor/scripts/factory-full-run-qa.ts [options]',
    '',
    'Options:',
    '  --prompt <text>          Factory prompt. Default: 生成一个水泥工厂',
    '  --base-url <url>         Running editor URL. Default: http://localhost:3002',
    '  --out-dir <path>         Artifact output directory.',
    '  --conversation-id <id>   Conversation id for the run.',
    '  --scene-id <id>          Scene id to create.',
    '  --mode <smoke|full>      Use e2e smoke generation or full generation. Default: full',
    '  --view <name>            Repeatable: isometric, top, side. Default: all three',
    '  --key-station <id>       Repeatable station ids expected in the generated graph.',
    '  --delete-scene           Delete the temporary scene after screenshots.',
    '  --timeout-ms <n>         Run timeout. Default: 600000',
    '  --help                   Show this help.',
  ].join('\n')
}

export function parseFactoryFullRunQaArgs(argv: string[]): FactoryFullRunQaOptions {
  let prompt = DEFAULT_PROMPT
  let baseUrl = process.env.FACTORY_RENDER_QA_BASE_URL ?? 'http://localhost:3002'
  let outputDir: string | undefined
  let conversationId = `factory-full-run-qa-${Date.now()}`
  let sceneId: string | undefined
  let mode: 'smoke' | 'full' = 'full'
  let keepScene = true
  let timeoutMs = 600_000
  const views: CameraView[] = []
  const keyStationIds: string[] = []

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg) continue
    if (arg === '--help' || arg === '-h') {
      console.log(usage())
      process.exit(0)
    }
    if (arg === '--prompt') {
      prompt = argv[++index] ?? prompt
      continue
    }
    if (arg === '--base-url') {
      baseUrl = argv[++index] ?? baseUrl
      continue
    }
    if (arg === '--out-dir') {
      outputDir = argv[++index]
      continue
    }
    if (arg === '--conversation-id') {
      conversationId = argv[++index] ?? conversationId
      continue
    }
    if (arg === '--scene-id') {
      sceneId = argv[++index]
      continue
    }
    if (arg === '--mode') {
      const value = argv[++index]
      if (value !== 'smoke' && value !== 'full') throw new Error(`Invalid --mode ${value}`)
      mode = value
      continue
    }
    if (arg === '--view') {
      const value = argv[++index]
      if (value !== 'isometric' && value !== 'top' && value !== 'side') {
        throw new Error(`Invalid --view ${value}`)
      }
      views.push(value)
      continue
    }
    if (arg === '--key-station') {
      const value = argv[++index]
      if (value) keyStationIds.push(value)
      continue
    }
    if (arg === '--delete-scene') {
      keepScene = false
      continue
    }
    if (arg === '--timeout-ms') {
      const value = Number.parseInt(argv[++index] ?? '', 10)
      if (!Number.isFinite(value) || value <= 0) throw new Error('Invalid --timeout-ms')
      timeoutMs = value
      continue
    }
    throw new Error(`Unknown option ${arg}`)
  }

  return {
    prompt,
    baseUrl: baseUrl.replace(/\/$/, ''),
    ...(outputDir ? { outputDir } : {}),
    conversationId,
    ...(sceneId ? { sceneId } : {}),
    mode,
    views: views.length ? views : ['isometric', 'top', 'side'],
    keyStationIds: keyStationIds.length ? keyStationIds : DEFAULT_KEY_STATIONS,
    keepScene,
    timeoutMs,
  }
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

export function pngMetrics(buffer: Buffer): PngMetrics {
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

function addIssue(
  issues: VisualSmokeIssue[],
  severity: Severity,
  code: string,
  message: string,
  view?: string,
) {
  issues.push({ severity, code, message, ...(view ? { view } : {}) })
}

function isCanvasNonBlank(metrics: PngMetrics) {
  return (
    metrics.nonTransparentRatio > 0.95 &&
    metrics.uniqueColorBuckets >= 10 &&
    metrics.lumaStdDev >= 3
  )
}

function isTrackedRenderRequest(message: string) {
  return /\/items\/|\/assets\/|\.glb(?:[?#]|$)|\.gltf(?:[?#]|$)|\/api\/scenes\//i.test(message)
}

function isRendererConsoleError(message: string) {
  if (/^Failed to load resource:/i.test(message)) return false
  return /404|not found|webgl|webgpu|three|renderer|could not load/i.test(message)
}

function stationAssemblyIds(nodes: SceneNode[]) {
  return nodes
    .filter((node) => node.type === 'assembly' && typeof node.metadata?.stationId === 'string')
    .map((node) => String(node.metadata?.stationId))
}

export function buildVisualSmokeReport(input: {
  options: FactoryFullRunQaOptions
  run: RunPayload
  sceneId: string
  outputDir: string
  reportPath: string
  runPath: string
  sceneGraphPath: string
  nodes: SceneNode[]
  rootNodeCount: number
  canvasCount: number
  canvasScreenshots: CanvasShot[]
  consoleErrors: string[]
  pageErrors: string[]
  requestFailures: string[]
}): VisualSmokeReport {
  const issues: VisualSmokeIssue[] = []
  const patches = input.run.result?.patches ?? []
  const quality = input.run.result?.qualityReport
  const stationIds = stationAssemblyIds(input.nodes)
  const presentKeyStationIds = input.options.keyStationIds.filter((id) => stationIds.includes(id))
  const viewsDistinct = new Set(input.canvasScreenshots.map((shot) => shot.sha256)).size > 1

  if (input.run.status !== 'succeeded') {
    addIssue(issues, 'error', 'factory_run_failed', `Factory run status is ${input.run.status}`)
  }
  if (quality && quality.passed !== true) {
    addIssue(issues, 'error', 'static_quality_failed', 'Factory quality report did not pass.')
  }
  if (patches.length < 25) {
    addIssue(issues, 'error', 'patches_too_few', `Only ${patches.length} patches were generated.`)
  }
  if (input.nodes.length < 25) {
    addIssue(issues, 'error', 'scene_nodes_too_few', `Only ${input.nodes.length} nodes exist.`)
  }
  for (const stationId of input.options.keyStationIds) {
    if (!presentKeyStationIds.includes(stationId)) {
      addIssue(issues, 'warning', 'key_station_missing', `Missing key station ${stationId}.`)
    }
  }
  if (input.canvasCount <= 0) {
    addIssue(issues, 'error', 'canvas_missing', 'No canvas was found on the scene page.')
  }
  for (const shot of input.canvasScreenshots) {
    if (!isCanvasNonBlank(shot.metrics)) {
      addIssue(
        issues,
        'error',
        'canvas_blank_or_low_variance',
        `Canvas ${shot.view} has ${shot.metrics.uniqueColorBuckets} color buckets and luma stddev ${shot.metrics.lumaStdDev.toFixed(2)}.`,
        shot.view,
      )
    }
  }
  if (input.canvasScreenshots.length > 1 && !viewsDistinct) {
    addIssue(issues, 'warning', 'views_not_distinct', 'All captured view screenshots are identical.')
  }
  for (const message of input.pageErrors) {
    addIssue(issues, 'error', 'page_error', message)
  }
  for (const message of input.consoleErrors) {
    if (isRendererConsoleError(message)) {
      addIssue(issues, 'warning', 'console_error', message)
    }
  }
  for (const message of input.requestFailures) {
    if (isTrackedRenderRequest(message)) {
      addIssue(issues, 'warning', 'request_failed', message)
    }
  }

  const issueCount = {
    error: issues.filter((issue) => issue.severity === 'error').length,
    warning: issues.filter((issue) => issue.severity === 'warning').length,
    info: issues.filter((issue) => issue.severity === 'info').length,
  }
  const score = Math.max(0, 100 - issueCount.error * 25 - issueCount.warning * 6 - issueCount.info)
  const passed = issueCount.error === 0 && score >= 70
  return {
    createdAt: new Date().toISOString(),
    prompt: input.options.prompt,
    mode: input.options.mode,
    baseUrl: input.options.baseUrl,
    sceneId: input.sceneId,
    sceneUrl: `${input.options.baseUrl}/scene/${input.sceneId}?factoryE2e=1`,
    ...(input.run.id ? { runId: input.run.id } : {}),
    outputDir: input.outputDir,
    passed,
    score,
    issueCount,
    checks: {
      runStatus: input.run.status,
      staticQualityPassed: quality?.passed,
      staticQualityScore: quality?.score,
      patchCount: patches.length,
      nodeCount: input.nodes.length,
      rootNodeCount: input.rootNodeCount,
      stationAssemblyCount: stationIds.length,
      keyStationIds: input.options.keyStationIds,
      presentKeyStationIds,
      canvasCount: input.canvasCount,
      canvasScreenshots: input.canvasScreenshots,
      viewsDistinct,
      consoleErrorCount: input.consoleErrors.length,
      pageErrorCount: input.pageErrors.length,
      requestFailureCount: input.requestFailures.length,
    },
    files: {
      run: input.runPath,
      sceneGraph: input.sceneGraphPath,
      report: input.reportPath,
      screenshots: Object.fromEntries(
        input.canvasScreenshots.map((shot) => [shot.view, shot.path]),
      ),
    },
    issues,
  }
}

async function postJson<T>(url: string, data: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(data),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`${response.status} ${text}`)
  return JSON.parse(text) as T
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' })
  const text = await response.text()
  if (!response.ok) throw new Error(`${response.status} ${text}`)
  return JSON.parse(text) as T
}

async function createFactoryRun(options: FactoryFullRunQaOptions) {
  const payload = await postJson<{ runId: string }>(`${options.baseUrl}/api/ai-harness/runs`, {
    mode: 'factory',
    prompt: options.prompt,
    conversationId: options.conversationId,
    params: options.mode === 'smoke' ? { e2eSmoke: true } : { e2eSmoke: false },
  })
  return payload.runId
}

async function waitForRun(options: FactoryFullRunQaOptions, runId: string): Promise<RunPayload> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < options.timeoutMs) {
    const payload = await getJson<{ run?: RunPayload }>(
      `${options.baseUrl}/api/ai-harness/runs/${encodeURIComponent(runId)}`,
    )
    const run = payload.run
    if (run && ['succeeded', 'failed', 'cancelled'].includes(run.status ?? '')) return run
    await new Promise((resolve) => setTimeout(resolve, 2_000))
  }
  throw new Error(`Factory run ${runId} timed out after ${options.timeoutMs}ms`)
}

async function saveScene(options: FactoryFullRunQaOptions, sceneId: string, graph: unknown) {
  const payload = await postJson<{ id: string }>(`${options.baseUrl}/api/scenes`, {
    id: sceneId,
    name: `Factory full-run QA: ${options.prompt}`,
    projectId: null,
    graph,
    thumbnailUrl: null,
  })
  return payload.id
}

async function deleteScene(options: FactoryFullRunQaOptions, sceneId: string) {
  await fetch(`${options.baseUrl}/api/scenes/${encodeURIComponent(sceneId)}`, {
    method: 'DELETE',
  }).catch(() => undefined)
}

async function screenshotViews(input: {
  options: FactoryFullRunQaOptions
  sceneId: string
  outputDir: string
}) {
  const repoRoot = await findRepoRoot()
  const helperPath = path.join(repoRoot, 'apps/editor/scripts/render-factory-full-run-qa.mjs')
  const resultPath = path.join(input.outputDir, 'screenshot-result.json')
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      'node',
      [
        helperPath,
        input.options.baseUrl,
        input.sceneId,
        input.outputDir,
        JSON.stringify(input.options.views),
      ],
      { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(stderr.trim() || stdout.trim() || `renderer exited with code ${code}`))
    })
  })
  const result = JSON.parse(await fs.readFile(resultPath, 'utf8')) as {
    canvasCount: number
    shots: Array<{ view: CameraView; path: string; sha256: string }>
    consoleErrors?: string[]
    pageErrors?: string[]
    requestFailures?: string[]
  }
  const canvasScreenshots: CanvasShot[] = []
  for (const shot of result.shots) {
    const buffer = await fs.readFile(shot.path)
    canvasScreenshots.push({
      view: shot.view,
      path: shot.path,
      sha256: shot.sha256 || crypto.createHash('sha256').update(buffer).digest('hex'),
      metrics: pngMetrics(buffer),
    })
  }
  return {
    canvasCount: result.canvasCount,
    canvasScreenshots,
    consoleErrors: result.consoleErrors ?? [],
    pageErrors: result.pageErrors ?? [],
    requestFailures: result.requestFailures ?? [],
  }
}

async function main() {
  const options = parseFactoryFullRunQaArgs(process.argv.slice(2))
  const repoRoot = await findRepoRoot()
  const runSlug = `${Date.now()}-${sanitizeSegment(options.prompt, 'factory')}`
  const outputDirInput =
    options.outputDir ??
    path.join(repoRoot, 'apps/editor/qa-artifacts/factory-full-run', runSlug)
  const outputDir = path.resolve(outputDirInput)
  const sceneId =
    options.sceneId ??
    `factory-full-run-qa-${sanitizeSegment(options.prompt, 'factory')}-${Date.now()}`
  await fs.mkdir(outputDir, { recursive: true })

  let savedSceneId = sceneId
  try {
    console.log(`factory full-run QA: creating run for "${options.prompt}"`)
    const runId = await createFactoryRun(options)
    console.log(`factory full-run QA: waiting for ${runId}`)
    const run = await waitForRun(options, runId)
    const runPath = path.join(outputDir, 'run.json')
    await fs.writeFile(runPath, `${JSON.stringify(run, null, 2)}\n`, 'utf8')

    console.log('factory full-run QA: applying patches to scene graph')
    const graph = applyFactoryScenePatchesToGraph(
      { nodes: {}, rootNodeIds: [] },
      run.result?.patches ?? [],
    )
    const sceneGraphPath = path.join(outputDir, 'scene-graph.json')
    await fs.writeFile(sceneGraphPath, `${JSON.stringify(graph, null, 2)}\n`, 'utf8')
    console.log(`factory full-run QA: saving scene ${sceneId}`)
    savedSceneId = await saveScene(options, sceneId, graph)

    console.log(`factory full-run QA: opening scene and capturing ${options.views.join(', ')}`)
    const screenshotResult = await screenshotViews({
      options,
      sceneId: savedSceneId,
      outputDir,
    })
    const nodes = Object.values(graph.nodes) as SceneNode[]
    const reportPath = path.join(outputDir, 'visual-smoke-report.json')
    const report = buildVisualSmokeReport({
      options,
      run,
      sceneId: savedSceneId,
      outputDir,
      reportPath,
      runPath,
      sceneGraphPath,
      nodes,
      rootNodeCount: graph.rootNodeIds.length,
      ...screenshotResult,
    })
    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    console.log(JSON.stringify({ reportPath, passed: report.passed, score: report.score }, null, 2))
    if (!report.passed) process.exitCode = 1
  } finally {
    if (!options.keepScene) await deleteScene(options, savedSceneId)
  }
}

if (import.meta.main) {
  await main()
}
