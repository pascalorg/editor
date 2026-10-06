import path from 'node:path'

const packages = [
  ['@pascal-app/plugin-bath-space', 'bath-space'],
  ['@pascal-app/plugin-landscape', 'landscape'],
  ['@pascal-app/plugin-pool', 'pool'],
  ['@pascal-app/plugin-streetscape-lab', 'streetscape'],
  ['@webxr/plugin', 'webxr'],
] as const

export function getLocalPluginPackages() {
  const root = process.env.PASCAL_LOCAL_PLUGINS_ROOT
  if (!root || process.env.CI || process.env.PASCAL_PORTABLE_BUILD === '1') return []
  return packages.map(([name, folder]) => ({
    name,
    directory: path.resolve(root, 'packages', folder),
  }))
}
