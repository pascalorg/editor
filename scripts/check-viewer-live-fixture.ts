import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const started = performance.now()
const elapsed = () => `${((performance.now() - started) / 1000).toFixed(1)}s`
const temp = await mkdtemp(join('/tmp', 'pascal-viewer-live-'))
console.log(`Isolated viewer fixture: ${temp}`)

async function run(command: string[], cwd: string) {
  const result = await Bun.$`${command}`
    .cwd(cwd)
    .env({
      ...process.env,
      npm_config_cache: process.env.npm_config_cache ?? join(temp, 'npm-cache'),
    })
    .quiet()
    .nothrow()
  if (result.exitCode !== 0)
    throw new Error(`${command.join(' ')} failed:\n${result.stdout}\n${result.stderr}`)
  return result.stdout.toString()
}

async function withServer(command: string[], cwd: string, check: (url: string) => Promise<void>) {
  const server = spawn(command[0]!, command.slice(1), { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  let exitCode: number | null = null
  server.stdout.on('data', (chunk) => {
    output += chunk
  })
  server.stderr.on('data', (chunk) => {
    output += chunk
  })
  server.on('exit', (code) => {
    exitCode = code ?? 1
  })
  const origin = await new Promise<string>((accept, reject) => {
    const deadline = setTimeout(() => {
      clearInterval(poll)
      reject(new Error(output))
    }, 30_000)
    const poll = setInterval(() => {
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/)
      if (match || exitCode !== null) {
        clearTimeout(deadline)
        clearInterval(poll)
        if (match) accept(match[0])
        else reject(new Error(output))
      }
    }, 50)
  }).catch((error) => {
    server.kill()
    throw error
  })
  try {
    await check(origin)
  } finally {
    server.kill('SIGTERM')
    await new Promise<void>((accept) => {
      if (server.exitCode !== null || server.signalCode !== null) accept()
      else server.once('exit', () => accept())
    })
  }
}

try {
  await run(
    [
      'bunx',
      'turbo',
      'build',
      '--filter=@pascal-app/core',
      '--filter=@pascal-app/viewer',
      '--filter=@pascal-app/nodes',
    ],
    process.env.PASCAL_VIEWER_BUILD_ROOT ?? root,
  )
  console.log(`Packages built (${elapsed()})`)
  const app = join(temp, 'app')
  await cp(join(root, 'fixtures/viewer-live'), app, { recursive: true })
  const manifest = JSON.parse(await readFile(join(app, 'package.json'), 'utf8'))
  for (const name of ['core', 'viewer', 'nodes']) {
    const packed = JSON.parse(
      await run(
        ['npm', 'pack', '--ignore-scripts', '--json', '--pack-destination', temp],
        join(root, 'packages', name),
      ),
    )
    manifest.dependencies[`@pascal-app/${name}`] = `file:${join(temp, packed[0].filename)}`
  }
  await writeFile(join(app, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  await run(['npm', 'install', '--no-audit', '--no-fund'], app)
  // Inspect what npm actually installed: `npm ls` also lists the unmet optional editor
  // peer of @pascal-app/nodes, which is exactly the state this proof wants.
  const installed = (await readdir(join(app, 'node_modules'), { recursive: true })).filter((path) =>
    /(?:^|\/)(?:next|@pascal-app\/editor)\/package\.json$/.test(path.replaceAll('\\', '/')),
  )
  if (installed.length)
    throw new Error(`Editor or Next installed in the isolated tree: ${installed.join(', ')}`)
  console.log(`Packed install and dependency isolation passed (${elapsed()})`)
  console.log(await run(['npm', 'run', 'build'], app))
  console.log(`Vite production build passed (${elapsed()})`)

  const systemChrome =
    process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : '/usr/bin/google-chrome'
  const browser = await chromium.launch({
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
      (existsSync(systemChrome) ? systemChrome : undefined),
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  })
  try {
    for (const mode of ['dev', 'preview'] as const) {
      await withServer(['npm', 'run', mode, '--', '--port', '0'], app, async (url) => {
        for (const deniedStorage of [false, true]) {
          const page = await browser.newPage({ viewport: { width: 960, height: 640 } })
          const errors: string[] = []
          page.on('pageerror', (error) => errors.push(error.message))
          page.on('console', (message) => {
            if (message.type() === 'error') errors.push(message.text())
          })
          if (deniedStorage)
            await page.addInitScript(() => {
              Object.defineProperty(window, 'localStorage', {
                get() {
                  throw new DOMException('Storage denied', 'SecurityError')
                },
              })
            })
          try {
            await page.goto(url)
            await page.waitForFunction(
              () => {
                const probe = (window as any).viewerFixture
                return (
                  document.querySelector('[data-scene-ready="true"]') &&
                  probe?.pending === 0 &&
                  probe.drawCalls > 0 &&
                  [
                    'wall_south',
                    'wall_east',
                    'wall_north',
                    'wall_west',
                    'door_fixture',
                    'window_fixture',
                    'roof_fixture',
                    'ceiling_fixture',
                    'procedural-item_fixture',
                    'zone_fixture',
                    'measurement_fixture',
                    'separator_fixture',
                    'item_fixture',
                  ].every((id) => probe.geometry[id] > 0)
                )
              },
              undefined,
              { timeout: 60_000 },
            )
            const probe = await page.evaluate(() => (window as any).viewerFixture)
            if (Object.keys(probe.itemFailures ?? {}).length) throw new Error(JSON.stringify(probe))
            if (errors.length) throw new Error(errors.join('\n'))
            if ((await page.evaluate(() => typeof (globalThis as any).process)) !== 'undefined')
              throw new Error('Fixture must run without a process polyfill')
            console.log(
              `${mode}, storage ${deniedStorage ? 'denied' : 'available'}: scene ready, ` +
                `non-empty node geometry, ${probe.drawCalls} draw calls, no errors (${elapsed()})`,
            )
          } catch (error) {
            console.error(
              await page.evaluate(() => ({
                probe: (window as any).viewerFixture,
                body: document.body.textContent,
              })),
            )
            throw new Error(
              `${mode}, storage denied=${deniedStorage}: ${error}\n${errors.join('\n')}`,
            )
          } finally {
            await page.close()
          }
        }
      })
    }
  } finally {
    await browser.close()
  }
  console.log(`Viewer live fixture passed (${elapsed()})`)
} finally {
  console.log(`Viewer fixture elapsed: ${elapsed()}`)
  if (process.env.KEEP_VIEWER_LIVE_FIXTURE) console.log(`Kept ${temp}`)
  else await rm(temp, { recursive: true, force: true })
}
