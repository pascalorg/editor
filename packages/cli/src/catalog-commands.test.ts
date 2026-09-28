import { afterEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pascal-catalog-command-test-'))
  directories.push(directory)
  const home = path.join(directory, 'home')
  const data = path.join(home, 'data')
  await mkdir(data, { recursive: true })
  const service = path.join(directory, 'catalog-probe.mjs')
  await writeFile(
    service,
    `import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
if (process.argv.slice(2).join(' ') !== '--catalog-status') throw new Error('Unexpected service start');
for (const key of ['PASCAL_API_KEY', 'PASCAL_MCP_HTTP_TOKEN', 'PASCAL_SCENE_API_TOKEN', 'OPENAI_API_KEY']) {
  if (process.env[key]) throw new Error('Credential forwarded to public catalog probe');
}
const data = process.env.PASCAL_DATA_DIR;
const preference = JSON.parse(readFileSync(path.join(data, 'catalog.json'), 'utf8'));
if (!preference.online) throw new Error('Unexpected offline probe');
writeFileSync(path.join(data, 'probe-ran'), 'yes');
let reply = {mode:'online', bundledCount:23, onlineCount:2, accountLinked:false, accountRequired:false, message:'Two additional free public catalog items.', secret:'must not print'};
try { reply = JSON.parse(readFileSync(path.join(data, 'probe-response.json'),'utf8')) } catch {}
console.log(JSON.stringify(reply));
`,
  )
  const run = async (...args: string[]) => {
    const child = Bun.spawn(
      [process.execPath, path.join(import.meta.dir, 'bin/pascal.ts'), 'catalog', ...args],
      {
        env: {
          ...process.env,
          PASCAL_HOME: home,
          PASCAL_MCP_SERVICE_PATH: service,
          PASCAL_NODE_BINARY: 'node',
          PASCAL_API_KEY: 'private-api',
          PASCAL_MCP_HTTP_TOKEN: 'private-mcp',
          PASCAL_SCENE_API_TOKEN: 'private-scene',
          OPENAI_API_KEY: 'private-model',
          PASCAL_NO_OPEN: '1',
        },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    return { code, stdout, stderr }
  }
  return { home, data, run }
}

test('catalog help is focused, optional, and truthful about accounts', async () => {
  const { run, data } = await fixture()
  const result = await run('--help')
  expect(result.code).toBe(0)
  expect(result.stdout).toContain('pascal catalog connect')
  expect(result.stdout).toContain('No account is required')
  expect(result.stdout).toContain('Generation uses separate credits')
  expect(
    await stat(path.join(data, 'probe-ran')).then(
      () => true,
      () => false,
    ),
  ).toBe(false)
})

test('real CLI connect, status, and disconnect persist preference without service lifecycle changes', async () => {
  const { run, data, home } = await fixture()
  const initial = await run('status', '--json')
  expect(initial.code).toBe(0)
  expect(JSON.parse(initial.stdout)).toMatchObject({ enabled: false, mode: 'bundled' })
  expect(
    await stat(path.join(data, 'probe-ran')).then(
      () => true,
      () => false,
    ),
  ).toBe(false)
  const connected = await run('connect', '--json')
  expect(connected.code).toBe(0)
  expect(JSON.parse(connected.stdout)).toMatchObject({
    enabled: true,
    mode: 'online',
    onlineCount: 2,
  })
  expect(connected.stdout).not.toContain('must not print')
  expect(connected.stdout).not.toContain('private-')
  expect(JSON.parse(await readFile(path.join(data, 'catalog.json'), 'utf8'))).toEqual({
    schemaVersion: 1,
    online: true,
  })
  const status = await run('status', '--json')
  expect(status.code).toBe(0)
  expect(JSON.parse(status.stdout).onlineCount).toBe(2)
  await rm(path.join(data, 'probe-ran'))
  const disconnected = await run('disconnect', '--json')
  expect(disconnected.code).toBe(0)
  expect(JSON.parse(disconnected.stdout)).toMatchObject({ enabled: false, mode: 'bundled' })
  expect(
    await stat(path.join(data, 'probe-ran')).then(
      () => true,
      () => false,
    ),
  ).toBe(false)
  expect(
    await stat(path.join(home, 'run')).then(
      () => true,
      () => false,
    ),
  ).toBe(false)
})

test('unavailable online catalog is explicit and disconnect repairs malformed preference', async () => {
  const { run, data } = await fixture()
  await writeFile(
    path.join(data, 'probe-response.json'),
    JSON.stringify({
      mode: 'unavailable',
      bundledCount: 23,
      onlineCount: 0,
      accountLinked: false,
      accountRequired: false,
      message: 'Online unavailable; bundled items remain available.',
    }),
  )
  const connected = await run('connect', '--json')
  expect(connected.code).toBe(1)
  expect(JSON.parse(connected.stdout)).toMatchObject({ enabled: true, mode: 'unavailable' })
  expect(JSON.parse(await readFile(path.join(data, 'catalog.json'), 'utf8')).online).toBe(true)
  await writeFile(path.join(data, 'catalog.json'), 'null')
  const malformed = await run('status', '--json')
  expect(malformed.code).toBe(1)
  expect(JSON.parse(malformed.stderr).error).toBe('invalid_catalog_setting')
  expect((await run('disconnect', '--json')).code).toBe(0)
})

test('unknown catalog commands and options refuse without changing preference', async () => {
  const { run, data } = await fixture()
  expect((await run('login', '--json')).code).toBe(2)
  expect((await run('connect', '--token', 'unwanted', '--json')).code).toBe(2)
  expect(
    await stat(path.join(data, 'catalog.json')).then(
      () => true,
      () => false,
    ),
  ).toBe(false)
})
