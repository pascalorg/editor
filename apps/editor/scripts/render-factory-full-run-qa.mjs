import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import playwright from '../node_modules/@playwright/test/index.js'

const { chromium } = playwright

const [baseUrlArg, sceneIdArg, outputDirArg, viewsArg] = process.argv.slice(2)
if (!baseUrlArg || !sceneIdArg || !outputDirArg || !viewsArg) {
  console.error(
    'Usage: node render-factory-full-run-qa.mjs <baseUrl> <sceneId> <outputDir> <views-json>',
  )
  process.exit(2)
}

const baseUrl = baseUrlArg.replace(/\/$/, '')
const sceneId = sceneIdArg
const outputDir = path.resolve(outputDirArg)
const views = JSON.parse(viewsArg)
const resultPath = path.join(outputDir, 'screenshot-result.json')

async function launchBrowser() {
  let lastError
  for (const launchOptions of [
    { headless: true, timeout: 30_000 },
    { headless: true, channel: 'chrome', timeout: 30_000 },
    { headless: true, channel: 'msedge', timeout: 30_000 },
  ]) {
    try {
      return await chromium.launch(launchOptions)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}

async function waitForFactoryBridge(page) {
  await page.waitForFunction(
    () => {
      const bridge = window.__pascalFactoryE2e
      return typeof bridge?.cameraView === 'function'
    },
    null,
    { timeout: 45_000 },
  )
}

async function setCameraView(page, view) {
  await page.evaluate((nextView) => {
    window.__pascalFactoryE2e?.cameraView?.(nextView)
  }, view)
  await page.waitForTimeout(view === 'isometric' ? 1_500 : 1_000)
}

async function largestCanvasIndex(page) {
  return page.locator('canvas').evaluateAll((canvases) => {
    const ranked = canvases
      .map((canvas, index) => ({
        index,
        area: canvas.clientWidth * canvas.clientHeight,
      }))
      .sort((a, b) => b.area - a.area)
    return ranked[0]?.index ?? -1
  })
}

const consoleErrors = []
const pageErrors = []
const requestFailures = []
let browser

try {
  await fs.mkdir(outputDir, { recursive: true })
  browser = await launchBrowser()
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 })
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('requestfailed', (request) => {
    requestFailures.push(`${request.url()} ${request.failure()?.errorText ?? ''}`.trim())
  })

  await page.goto(`${baseUrl}/scene/${encodeURIComponent(sceneId)}?factoryE2e=1`, {
    waitUntil: 'domcontentloaded',
    timeout: 90_000,
  })
  await waitForFactoryBridge(page)
  await page.waitForTimeout(8_000)

  const canvasCount = await page.locator('canvas').count()
  const canvasIndex = await largestCanvasIndex(page)
  const shots = []
  if (canvasIndex >= 0) {
    const canvas = page.locator('canvas').nth(canvasIndex)
    for (const view of views) {
      await setCameraView(page, view)
      const screenshotPath = path.join(outputDir, `${view}.png`)
      const box = await canvas.boundingBox()
      if (!box) throw new Error('Unable to locate canvas bounds')
      const buffer = await page.screenshot({
        path: screenshotPath,
        clip: {
          x: Math.max(0, box.x),
          y: Math.max(0, box.y),
          width: Math.max(1, box.width),
          height: Math.max(1, box.height),
        },
      })
      shots.push({
        view,
        path: screenshotPath,
        sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
      })
    }
  }

  await page.screenshot({ path: path.join(outputDir, 'page.png'), fullPage: true })
  await fs.writeFile(
    resultPath,
    `${JSON.stringify({ canvasCount, shots, consoleErrors, pageErrors, requestFailures }, null, 2)}\n`,
    'utf8',
  )
} finally {
  if (browser) await browser.close()
}
