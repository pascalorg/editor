import { createServer } from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import playwright from '../node_modules/@playwright/test/index.js'

const { chromium } = playwright

const [repoRootArg, htmlPathArg, screenshotPathArg] = process.argv.slice(2)
if (!repoRootArg || !htmlPathArg || !screenshotPathArg) {
  console.error('Usage: node render-primitive-visual-qa.mjs <repoRoot> <htmlPath> <screenshotPath>')
  process.exit(2)
}

const repoRoot = path.resolve(repoRootArg)
const htmlPath = path.resolve(htmlPathArg)
const screenshotPath = path.resolve(screenshotPathArg)

function contentType(filePath) {
  if (filePath.endsWith('.js')) return 'text/javascript'
  if (filePath.endsWith('.html')) return 'text/html'
  if (filePath.endsWith('.json')) return 'application/json'
  if (filePath.endsWith('.png')) return 'image/png'
  return 'application/octet-stream'
}

async function startStaticServer() {
  const server = createServer(async (request, response) => {
    const requestPath = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname)
    const filePath = path.resolve(repoRoot, requestPath.replace(/^\/+/, ''))
    if (!(filePath === repoRoot || filePath.startsWith(`${repoRoot}${path.sep}`))) {
      response.writeHead(403)
      response.end('Forbidden')
      return
    }
    try {
      const bytes = await fs.readFile(filePath)
      response.writeHead(200, { 'content-type': contentType(filePath) })
      response.end(bytes)
    } catch {
      response.writeHead(404)
      response.end('Not found')
    }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Failed to start static server')
  return { server, baseUrl: `http://127.0.0.1:${address.port}` }
}

const { server, baseUrl } = await startStaticServer()
let browser
try {
  browser = await chromium.launch({ headless: true, timeout: 30_000 })
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 }, deviceScaleFactor: 1 })
  const rel = path.relative(repoRoot, htmlPath).replace(/\\/g, '/')
  await page.goto(`${baseUrl}/${rel}`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.__renderReady === true, null, { timeout: 15_000 })
  await page.screenshot({ path: screenshotPath, fullPage: true })
} finally {
  if (browser) await browser.close()
  await new Promise((resolve) => server.close(() => resolve()))
}
