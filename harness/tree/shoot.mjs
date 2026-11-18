import http from 'node:http'
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const harness = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const { chromium } = require('playwright-core')
const three = path.dirname(path.dirname(require.resolve('three')))
const [output, name, query = 'scene=single'] = process.argv.slice(2)
if (!output || !/^[a-z0-9-]+$/.test(name ?? '')) throw new Error('Usage: node shoot.mjs output name query')
mkdirSync(output, { recursive: true })
const mime = { '.html': 'text/html', '.js': 'text/javascript' }
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost').pathname
  if (url === '/ez-tree.js') {
    try {
      const entry = path.join(path.dirname(require.resolve('@dgreenheck/ez-tree')), 'ez-tree.es.js')
      response.setHeader('Content-Type', 'text/javascript')
      createReadStream(entry)
        .on('error', () => response.destroy())
        .pipe(response)
    } catch {
      response.writeHead(404)
      response.end('Install ez-tree 1.1.0 in the harness host to compare presets.')
    }
    return
  }
  const root = url.startsWith('/three/') ? three : harness
  const file = path.resolve(root, `.${url.startsWith('/three/') ? url.slice(6) : url}`)
  if (!file.startsWith(`${root}/`) || !existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404)
    response.end()
    return
  }
  response.setHeader('Content-Type', mime[path.extname(file)] ?? 'application/octet-stream')
  createReadStream(file).pipe(response)
})
let browser
const errors = []
const deadline = setTimeout(() => {
  browser?.close()
  server.closeAllConnections()
  process.exit(1)
}, 55000)
try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  browser = await chromium.launch({
    headless: true,
    channel: 'chromium',
    timeout: 12000,
    args: ['--enable-unsafe-webgpu'],
  })
  const params = new URLSearchParams(query)
  const compare = params.get('compare') === '1'
  const viewport = compare
    ? params.get('scene') === 'forms'
      ? { width: 2160, height: 980 }
      : { width: 2200, height: 860 }
    : { width: 1440, height: 960 }
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 })
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.goto(`http://127.0.0.1:${server.address().port}/${compare ? 'compare' : 'view'}.html?${query}`, {
    timeout: 20000,
  })
  await page.waitForFunction(() => window.__done === true, undefined, { timeout: 42000 })
  const stats = await page.evaluate(() => window.__stats)
  const requested = new URLSearchParams(query).get('gl') === '1' ? 'WebGL2' : 'WebGPU'
  if (stats.backend !== requested) throw new Error(`Expected ${requested}, got ${stats.backend}`)
  await page.screenshot({ path: path.join(output, `${name}.png`), timeout: 10000 })
  writeFileSync(path.join(output, `${name}.json`), JSON.stringify({ stats, errors }, null, 2))
  if (errors.length) throw new Error(errors.join('\n'))
  console.log(
    `${name}: ${stats.backend}, ${stats.metrics.length} trees, ${stats.metrics.map((tree) => `${tree.input.form} ${tree.triangles}/${tree.farTriangles ?? '–'} tris ${tree.buildMs.toFixed(1)} ms`).join('; ')}`,
  )
} finally {
  clearTimeout(deadline)
  await browser?.close()
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
}
