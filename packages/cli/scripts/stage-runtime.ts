import { chmod, cp, mkdir, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = path.resolve(packageDirectory, '../..')
const appDirectory = path.join(repositoryRoot, 'apps/editor')
const standaloneDirectory = path.join(appDirectory, '.next/standalone')
const standaloneAppDirectory = path.join(standaloneDirectory, 'apps/editor')
const outputDirectory = path.join(packageDirectory, 'dist/runtime')

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

await removeUnusedSharp(outputDirectory)
await flattenBunNodeModules(outputDirectory)
await materializeSymlinks(outputDirectory)
await rm(path.join(outputDirectory, 'node_modules/.bun'), { recursive: true, force: true })
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
      healthPath: '/api/health',
    },
    null,
    2,
  )}\n`,
)

console.log(`Staged Pascal editor runtime ${packageJson.version} at ${outputDirectory}`)

async function assertFile(filePath: string): Promise<void> {
  try {
    await readFile(filePath)
  } catch {
    throw new Error(
      `standalone editor build not found at ${filePath}; run PASCAL_PORTABLE_BUILD=1 bun run build from apps/editor first`,
    )
  }
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
