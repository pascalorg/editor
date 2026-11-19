import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { arch, platform, release } from 'node:os'
import { BufferAttribute, BufferGeometry } from 'three'

// Build and shoot are deliberately separate: Main may bundle once, then execute each backend /
// suite sequentially. No dev server, database, installation, or external asset requests.
const editorRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const privateRoot = resolve(editorRoot, '..')
const [mode, outputArgument, backend = 'webgpu', suite = 'types'] = process.argv.slice(2)
if (!['build', 'shoot'].includes(mode) || !outputArgument) {
  throw new Error('Usage: bun editor/scripts/rock-acceptance.mjs build OUTPUT | shoot OUTPUT webgpu|webgl2 types|garden|looks|reference|benchmark|shadow')
}
function assertWorkSlot() {
  const paid = process.env.PASCAL_PAID_CELL_LOCK
  const priority = process.env.PASCAL_RENDER_PRIORITY_LOCK
  if (!paid || !priority) {
    throw new Error('BLOCKED: set PASCAL_PAID_CELL_LOCK and PASCAL_RENDER_PRIORITY_LOCK before building or shooting')
  }
  if (existsSync(paid)) {
    throw new Error('BLOCKED: paid-cell lock exists; Main must wait before building or shooting')
  }
  const owner = existsSync(priority) ? readFileSync(priority, 'utf8').trim() : ''
  if (owner && owner !== 'landscaper') {
    throw new Error('BLOCKED: render.priority belongs to another owner')
  }
}
assertWorkSlot()
const output = resolve(outputArgument)
await mkdir(output, { recursive: true })
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const bundlePath = join(output, 'rock-harness.js')
const buildManifestPath = join(output, 'rock-harness-build.json')

if (mode === 'build') {
  const requireEditor = createRequire(join(editorRoot, 'package.json'))
  const { build } = requireEditor('esbuild')
  const result = await build({
    absWorkingDir: editorRoot,
    entryPoints: ['packages/nodes/src/rock/__tests__/browser.ts'],
    outfile: bundlePath,
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: ['chrome130'],
    sourcemap: false,
    metafile: true,
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'candidate-core-source', setup(builder) {
      // Resolve the public seam to this worktree's actual source, never a stale dist build.
      builder.onResolve({ filter: /^@pascal-app\/core$/ }, () => ({ path: join(editorRoot, 'packages/core/src/index.ts') }))
      builder.onResolve({ filter: /^@pascal-app\/core\/schema$/ }, () => ({ path: join(editorRoot, 'packages/core/src/schema/index.ts') }))
    } }],
  })
  const dependencies = {}
  for (const input of Object.keys(result.metafile.inputs).sort()) {
    const path = resolve(editorRoot, input)
    if (existsSync(path)) dependencies[input] = sha(await readFile(path))
  }
  const bundle = await readFile(bundlePath)
  await writeFile(buildManifestPath, `${JSON.stringify({
    createdAt: new Date().toISOString(), bundleBytes: bundle.length, bundleSha256: sha(bundle),
    threeVersion: JSON.parse(readFileSync(resolve(dirname(requireEditor.resolve('three')), '../package.json'), 'utf8')).version,
    dependencies, output: result.metafile.outputs,
  }, null, 2)}\n`)
  console.log(`Bundled actual rock generator/material: ${bundle.length} bytes; ${buildManifestPath}`)
} else {
  if (!['webgpu', 'webgl2'].includes(backend)) throw new Error(`Unknown backend: ${backend}`)
  if (!['types', 'garden', 'looks', 'reference', 'benchmark', 'shadow'].includes(suite)) throw new Error(`Unknown suite: ${suite}`)
  // Requirement: use playwright-core from the private install, not a separately installed runner.
  const requirePrivate = createRequire(join(privateRoot, 'package.json'))
  const { chromium } = requirePrivate('playwright-core')
  if (!process.versions.bun) throw new Error('Run with Bun to exercise the required Bun-versus-Chromium determinism check')
  const { buildRock } = await import('@pascal-app/core')
  const playwrightPackage = requirePrivate.resolve('playwright-core/package.json')
  const manifest = JSON.parse(await readFile(buildManifestPath, 'utf8'))
  const bundle = await readFile(bundlePath)
  if (sha(bundle) !== manifest.bundleSha256) throw new Error('Bundle differs from its provenance manifest; rebuild')
  // Refuse stale source evidence instead of silently evaluating an earlier candidate.
  for (const [input, expected] of Object.entries(manifest.dependencies)) {
    const path = resolve(editorRoot, input)
    if (!existsSync(path) || sha(await readFile(path)) !== expected) throw new Error(`Source changed since bundling: ${input}; rebuild`)
  }
  const started = performance.now()
  const name = `${backend}-${suite}`
  const reportPath = join(output, `${name}.json`)
  const report = {
    status: 'NOT-RUN', backendRequested: backend, suite, buildManifest: buildManifestPath,
    bundleSha256: manifest.bundleSha256, browserVersion: null, playwrightPackage,
    playwrightVersion: JSON.parse(readFileSync(playwrightPackage, 'utf8')).version,
    os: { platform: platform(), release: release(), arch: arch() }, bunVersion: process.versions.bun,
    frames: [], console: [], pageErrors: [], blockedRequests: [], errors: [],
    acceptance: 'Ordinary evidence independent of production; image aesthetics require Main/human review',
  }
  const persist = () => writeFileSync(reportPath, `${JSON.stringify({ ...report, elapsedMs: performance.now() - started }, null, 2)}\n`)
  let browser
  let page
  let deadline
  try {
    await Promise.race([
      new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('BLOCKED: bounded standalone shooting deadline (55 seconds)')), 55_000) }),
      (async () => {
        assertWorkSlot()
        browser = await chromium.launch({
          headless: true,
          ...(process.env.PASCAL_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PASCAL_CHROMIUM_EXECUTABLE } : {}),
          args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'],
          timeout: 10_000,
        })
        report.browserVersion = browser.version()
        page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
        page.setDefaultTimeout(12_000)
        page.on('console', (message) => { report.console.push({ type: message.type(), text: message.text() }) })
        page.on('pageerror', (error) => { report.pageErrors.push(error.message) })
        const origin = 'http://127.0.0.1:3461'
        await page.route('**/*', async (route) => {
          const url = new URL(route.request().url())
          if (url.origin !== origin) { report.blockedRequests.push(url.href); return route.abort('blockedbyclient') }
          if (url.pathname === '/rock-harness.js') return route.fulfill({ contentType: 'text/javascript', body: bundle })
          if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body:
            '<!doctype html><html><head><meta charset="utf-8"><title>Rock acceptance</title><style>body{margin:0;overflow:hidden}canvas{display:block}</style></head><body><script type="module" src="/rock-harness.js"></script></body></html>' })
          return route.fulfill({ status: 404, body: '' })
        })
        await page.goto(`${origin}/?backend=${backend}`, { waitUntil: 'load' })
        await page.waitForFunction(() => Boolean(window.rockAcceptance))
        await page.evaluate(() => window.rockAcceptance.ready)
        const cases = await page.evaluate((selectedSuite) => window.rockAcceptance.cases(selectedSuite), suite)
        let bareLook
        for (const id of cases) {
          assertWorkSlot()
          const frame = await page.evaluate((caseId) => window.rockAcceptance.capture(caseId), id)
          const stem = `${backend}-${id.replaceAll(':', '-')}`
          const actual = Buffer.from(frame.actualRGBA, 'base64')
          const noRock = Buffer.from(frame.noRockRGBA, 'base64')
          delete frame.actualRGBA
          delete frame.noRockRGBA
          const image = join(output, `${stem}.png`)
          const actualPath = join(output, `${stem}.rgba`)
          const noRockPath = join(output, `${stem}-no-rock.rgba`)
          await writeFile(actualPath, actual)
          await writeFile(noRockPath, noRock)
          await page.screenshot({ path: image, animations: 'disabled', timeout: 5000 })
          const crossEngine = []
          for (let rockIndex = 0; rockIndex < frame.savedRocks.length; rockIndex++) {
            const built = buildRock(frame.savedRocks[rockIndex])
            for (const level of ['near', 'far']) {
              const mesh = built[level]
              if (!mesh) throw new Error(`Bun did not build ${level} for ${id}, rock ${rockIndex}`)
              const position = sha(new Uint8Array(mesh.position.buffer, mesh.position.byteOffset, mesh.position.byteLength))
              const index = sha(new Uint8Array(mesh.index.buffer, mesh.index.byteOffset, mesh.index.byteLength))
              // Exercise the installed Three renderer boundary in Bun, not a copied normal algorithm.
              const geometry = new BufferGeometry()
              geometry.setAttribute('position', new BufferAttribute(mesh.position, 3))
              geometry.setIndex(new BufferAttribute(mesh.index, 1))
              geometry.computeVertexNormals()
              const normals = geometry.getAttribute('normal').array
              const normal = sha(new Uint8Array(normals.buffer, normals.byteOffset, normals.byteLength))
              geometry.dispose()
              const matches = frame.geometry.some((observed) => observed.rockIndex === rockIndex && observed.position === position && observed.index === index && observed.normal === normal)
              if (!matches) throw new Error(`Saved-number bytes differ between Bun and Chromium: ${id}, rock ${rockIndex}, ${level}`)
              crossEngine.push({ rockIndex, level, position, index, normal, status: 'PASS' })
            }
          }
          frame.crossEngine = crossEngine
          if (id === 'look:bare') bareLook = actual
          if (id.startsWith('look:') && id !== 'look:bare') {
            if (!bareLook || bareLook.equals(actual)) throw new Error(`${id} did not change rendered pixels compared with the fixed bare look`)
            frame.lookDifference = { status: 'PASS', oracle: 'A saved look extreme must visibly affect the same production rock; no candidate golden', reference: 'look:bare' }
          }
          frame.artifacts = { image, actualPath, noRockPath, actualSha256: sha(actual), noRockSha256: sha(noRock) }
          report.frames.push(frame)
          persist()
        }
        if (report.pageErrors.length) throw new Error(`Browser exceptions: ${report.pageErrors.join('; ')}`)
        const consoleErrors = report.console.filter((entry) => entry.type === 'error')
        if (consoleErrors.length) throw new Error(`Browser console errors: ${consoleErrors.map((entry) => entry.text).join('; ')}`)
        report.status = 'PASS'
      })(),
    ])
  } catch (error) {
    report.status = String(error).includes('BLOCKED:') || !report.browserVersion ? 'BLOCKED' : 'FAIL'
    report.errors.push(error instanceof Error ? error.stack ?? error.message : String(error))
    if (page && performance.now() - started < 55_000) {
      try {
        const failureImage = join(output, `${name}-failure.png`)
        await page.screenshot({ path: failureImage, timeout: 1500 })
        report.failureImage = failureImage
      } catch {
        // The original error remains authoritative if the failed page cannot be captured.
      }
    }
    process.exitCode = 1
  } finally {
    clearTimeout(deadline)
    // Closing only the browser launched above; no process-name scanning or unrelated kills.
    await browser?.close()
    persist()
  }
  console.log(`${report.status}: ${reportPath} (${((performance.now() - started) / 1000).toFixed(1)} s)`)
}
