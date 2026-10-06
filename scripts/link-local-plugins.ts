import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from 'node:fs'
import path from 'node:path'
import { getLocalPluginPackages } from '../apps/editor/local-plugins'

const appDirectory = path.resolve(import.meta.dir, '../apps/editor')
for (const { name, directory: target } of getLocalPluginPackages()) {
  const packageManifest = JSON.parse(readFileSync(path.join(target, 'package.json'), 'utf8'))
  if (packageManifest.name !== name)
    throw new Error(`Local dependency ${name} has a mismatched package name`)
  linkDirectory(target, path.join(appDirectory, 'node_modules', name))
  const sharedDependencies = [
    ...Object.keys(packageManifest.peerDependencies ?? {}),
    '@types/react',
    '@types/react-dom',
    '@types/three',
  ]
  for (const dependency of sharedDependencies) {
    const hostDependency = path.resolve(appDirectory, '../../node_modules', dependency)
    if (!existsSync(hostDependency)) continue
    linkDirectory(realpathSync(hostDependency), path.join(target, 'node_modules', dependency))
  }
}

function linkDirectory(target: string, destination: string) {
  if (
    existsSync(destination) &&
    lstatSync(destination).isSymbolicLink() &&
    realpathSync(destination) === realpathSync(target)
  )
    return
  // Bun materializes file dependencies with individual file symlinks. Turbopack
  // needs the package directory link to resolve package.json and its exports.
  rmSync(destination, { recursive: true, force: true })
  mkdirSync(path.dirname(destination), { recursive: true })
  symlinkSync(target, destination, 'dir')
}
