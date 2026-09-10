import { spawn } from 'node:child_process'
import {
  chmod,
  cp,
  mkdir,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = path.resolve(packageDirectory, '../..')
const appDirectory = path.join(repositoryRoot, 'apps/editor')
const standaloneDirectory = path.join(appDirectory, '.next/standalone')
const standaloneAppDirectory = path.join(standaloneDirectory, 'apps/editor')
const outputDirectory = path.join(packageDirectory, 'dist/runtime')

/**
 * `next build` copies its tracing root into `.next/standalone`, so the portable runtime
 * inherits app sources, repository documentation and build-time-only assets that
 * `server.js` never reads. Every entry below was checked against the staged tree: nothing
 * in `.next`, `node_modules` or the bundled MCP server resolves it.
 */
const buildOnlyRuntimePaths = [
  'apps/editor/app',
  'apps/editor/components',
  'apps/editor/lib',
  'apps/editor/AGENTS.md',
  'apps/editor/CLAUDE.md',
  'apps/editor/README.md',
  'apps/editor/bunfig.toml',
  'apps/editor/next.config.ts',
  'apps/editor/postcss.config.mjs',
  'apps/editor/tsconfig.json',
  'apps/editor/vercel.json',
  // The radio catalogue is played by the hosted community app, which serves its own copy.
  'apps/editor/public/audios/radios',
  // `next/dist/server/font-utils.js` is the sole reader of these font metrics and is
  // itself unreachable from the standalone server.
  'node_modules/next/dist/server/capsize-font-metrics.json',
  'node_modules/next/dist/server/font-utils.js',
]

const packageJson = JSON.parse(
  await readFile(path.join(packageDirectory, 'package.json'), 'utf8'),
) as {
  version: string
}

await chmod(path.join(packageDirectory, 'dist/bin/pascal.js'), 0o755)
await assertFile(path.join(standaloneAppDirectory, 'server.js'))
await rm(outputDirectory, { recursive: true, force: true })
await mkdir(path.dirname(outputDirectory), { recursive: true })
await cp(standaloneDirectory, outputDirectory, { recursive: true, dereference: false })

await cp(path.join(appDirectory, 'public'), path.join(outputDirectory, 'apps/editor/public'), {
  recursive: true,
  force: true,
})
await cp(
  path.join(appDirectory, '.next/static'),
  path.join(outputDirectory, 'apps/editor/.next/static'),
  { recursive: true, force: true },
)
await bundleMcpServer(outputDirectory, packageJson.version)

await rm(path.join(outputDirectory, 'apps/editor/vendor'), { recursive: true, force: true })
await removeUnusedSharp(outputDirectory)
await flattenBunNodeModules(outputDirectory)
await materializeSymlinks(outputDirectory)
await rm(path.join(outputDirectory, 'node_modules/.bun'), { recursive: true, force: true })
await pruneBuildOnlyFiles(outputDirectory)
const nativeFiles = await findNativeModules(outputDirectory)
if (nativeFiles.length > 0) {
  throw new Error(`portable runtime contains native modules:\n${nativeFiles.join('\n')}`)
}

await writeFile(
  path.join(outputDirectory, 'runtime-manifest.json'),
  `${JSON.stringify(
    {
      schemaVersion: 1,
      version: packageJson.version,
      entrypoint: 'apps/editor/server.js',
      mcpEntrypoint: 'services/pascal-mcp.mjs',
      healthPath: '/api/health',
      mcpHealthPath: '/health',
    },
    null,
    2,
  )}\n`,
)

console.log(`Staged Pascal editor runtime ${packageJson.version} at ${outputDirectory}`)

async function bundleMcpServer(runtimeDirectory: string, version: string): Promise<void> {
  const output = path.join(runtimeDirectory, 'services/pascal-mcp.mjs')
  await mkdir(path.dirname(output), { recursive: true })
  const child = spawn(
    process.execPath,
    [
      'build',
      path.join(repositoryRoot, 'packages/mcp/src/bin/pascal-mcp.ts'),
      '--outfile',
      output,
      '--target',
      'node',
      '--format',
      'esm',
      '--define',
      `process.env.PASCAL_MCP_VERSION=${JSON.stringify(version)}`,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  )
  const stderr: Buffer[] = []
  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => resolve(code ?? 1))
  })
  if (exitCode !== 0) {
    throw new Error(`Unable to bundle the Pascal MCP server: ${Buffer.concat(stderr).toString()}`)
  }
}

async function assertFile(filePath: string): Promise<void> {
  try {
    await readFile(filePath)
  } catch {
    throw new Error(
      `standalone editor build not found at ${filePath}; run PASCAL_PORTABLE_BUILD=1 bun run build from apps/editor first`,
    )
  }
}

async function pruneBuildOnlyFiles(root: string): Promise<void> {
  await Promise.all(
    buildOnlyRuntimePaths.map((relative) =>
      rm(path.join(root, relative), { recursive: true, force: true }),
    ),
  )
  await removeStrayItemAssets(path.join(root, 'apps/editor/public/items'))
  await removeTraceArtifacts(path.join(root, 'apps/editor/.next'))
}

/**
 * Item directories are addressed by convention (`model.glb`, `thumbnail.*`, `floor-plan.*`).
 * Anything else is an authoring leftover, so it is dropped and named on stdout: a future
 * asset that does not follow the convention has to be reported rather than silently lost.
 */
async function removeStrayItemAssets(itemsDirectory: string): Promise<void> {
  let entries
  try {
    entries = await readdir(itemsDirectory, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return
  }
  const isConventional = (name: string): boolean =>
    name === 'model.glb' || name.startsWith('thumbnail.') || name.startsWith('floor-plan.')
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const itemDirectory = path.join(itemsDirectory, entry.name)
    for (const asset of await readdir(itemDirectory, { withFileTypes: true })) {
      if (!asset.isFile() || isConventional(asset.name)) continue
      const assetPath = path.join(itemDirectory, asset.name)
      const { size } = await stat(assetPath)
      await rm(assetPath, { force: true })
      console.log(
        `Dropped unreferenced item asset ${entry.name}/${asset.name} (${formatMegabytes(size)} MB)`,
      )
    }
  }
}

function formatMegabytes(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(2)
}

async function removeTraceArtifacts(nextDirectory: string): Promise<void> {
  const walk = async (directory: string): Promise<void> => {
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      return
    }
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) await walk(absolute)
      else if (entry.name.endsWith('.nft.json') || entry.name.endsWith('.map')) {
        await rm(absolute, { force: true })
      }
    }
  }
  await walk(nextDirectory)
}

async function removeUnusedSharp(root: string): Promise<void> {
  const nodeModules = path.join(root, 'node_modules')
  await rm(path.join(nodeModules, 'sharp'), { recursive: true, force: true })
  await rm(path.join(nodeModules, '@img'), { recursive: true, force: true })
  const bunModules = path.join(nodeModules, '.bun')
  let entries: string[] = []
  try {
    entries = await readdir(bunModules)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return
  }
  await Promise.all(
    entries
      .filter(
        (entry) => entry === 'sharp' || entry.startsWith('sharp@') || entry.startsWith('@img+'),
      )
      .map((entry) => rm(path.join(bunModules, entry), { recursive: true, force: true })),
  )
}

async function flattenBunNodeModules(root: string): Promise<void> {
  const nodeModules = path.join(root, 'node_modules')
  const bunNodeModules = path.join(nodeModules, '.bun/node_modules')
  let entries
  try {
    entries = await readdir(bunNodeModules, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return
  }
  for (const entry of entries) {
    if (entry.name.startsWith('@') && entry.isDirectory()) {
      const scope = path.join(bunNodeModules, entry.name)
      for (const packageEntry of await readdir(scope, { withFileTypes: true })) {
        await copyLinkedPackage(
          path.join(scope, packageEntry.name),
          path.join(nodeModules, entry.name, packageEntry.name),
        )
      }
    } else {
      await copyLinkedPackage(
        path.join(bunNodeModules, entry.name),
        path.join(nodeModules, entry.name),
      )
    }
  }
}

async function copyLinkedPackage(source: string, destination: string): Promise<void> {
  let target: string
  try {
    target = await realpath(source)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  await rm(destination, { recursive: true, force: true })
  await mkdir(path.dirname(destination), { recursive: true })
  await cp(target, destination, { recursive: true, dereference: false })
}

async function materializeSymlinks(root: string): Promise<void> {
  const resolvedRoot = path.resolve(root)
  for (let pass = 0; pass < 100; pass += 1) {
    const links = await findSymlinks(root)
    if (links.length === 0) return

    for (const link of links) {
      let target: string
      try {
        target = await realpath(link)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        await rm(link, { force: true })
        continue
      }
      if (!target.startsWith(`${resolvedRoot}${path.sep}`)) {
        throw new Error(`portable runtime symlink escapes its root: ${link}`)
      }
      await rm(link, { force: true })
      await cp(target, link, { recursive: true, dereference: false })
    }
  }
  throw new Error('portable runtime contains a cyclic symlink')
}

async function findSymlinks(root: string): Promise<string[]> {
  const result: string[] = []
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      if (absolute === path.join(root, 'node_modules/.bun')) continue
      if (entry.isSymbolicLink()) result.push(absolute)
      else if (entry.isDirectory()) await walk(absolute)
    }
  }
  await walk(root)
  return result
}

async function findNativeModules(root: string): Promise<string[]> {
  const result: string[] = []
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) await walk(absolute)
      else if (entry.isFile() && entry.name.endsWith('.node'))
        result.push(path.relative(root, absolute))
    }
  }
  await walk(root)
  return result.sort()
}
