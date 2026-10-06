import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { NextConfig } from 'next'

const appDirectory = path.dirname(fileURLToPath(import.meta.url))
const portableBuild = process.env.PASCAL_PORTABLE_BUILD === '1'
const appPackageJson = JSON.parse(
  readFileSync(path.join(appDirectory, 'package.json'), 'utf8'),
) as {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}
const localPluginPaths = Object.values({
  ...appPackageJson.dependencies,
  ...appPackageJson.devDependencies,
})
  .filter((dependency) => dependency.startsWith('file:'))
  .map((dependency) => path.resolve(appDirectory, dependency.slice('file:'.length)))
const turbopackRoot = [path.resolve(appDirectory, '../..'), ...localPluginPaths].reduce(
  (commonRoot, candidate) => {
    const commonParts = commonRoot.split(path.sep)
    const candidateParts = candidate.split(path.sep)
    let sharedParts = 0
    while (
      sharedParts < commonParts.length &&
      sharedParts < candidateParts.length &&
      commonParts[sharedParts] === candidateParts[sharedParts]
    ) {
      sharedParts += 1
    }
    return commonParts.slice(0, sharedParts).join(path.sep) || path.parse(commonRoot).root
  },
)

const nextConfig: NextConfig = {
  ...(portableBuild
    ? { output: 'standalone' as const, outputFileTracingRoot: path.join(appDirectory, '../..') }
    : {}),
  logging: {
    browserToTerminal: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  // MCP / package metadata returns `/editor/<id>` (hosted route). This open-source
  // app serves saved scenes at `/scene/<id>` — redirect so links and bookmarks work.
  async redirects() {
    return [
      {
        source: '/editor/:id',
        destination: '/scene/:id',
        permanent: false,
      },
    ]
  },
  transpilePackages: [
    'three',
    '@pascal-app/viewer',
    '@pascal-app/core',
    '@pascal-app/editor',
    '@pascal-app/mcp',
    '@pascal-app/plugin-pool',
    '@pascal-app/plugin-bath-space',
    '@pascal-app/plugin-landscape',
    '@pascal-app/plugin-streetscape-lab',
    '@pascal-app/plugin-trees',
    '@mint/pascal-plugin',
    '@pascal-app/plugin-bones',
    '@webxr/plugin',
    '@pascal-app/plugin-environment',
    '@dgreenheck/ez-tree',
  ],
  turbopack: {
    root: turbopackRoot,
    resolveAlias: {
      react: './node_modules/react',
      three: './node_modules/three',
      '@react-three/fiber': './node_modules/@react-three/fiber',
      '@react-three/drei': './node_modules/@react-three/drei',
    },
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '100mb',
    },
  },
  images: {
    unoptimized:
      portableBuild ||
      (process.env.NEXT_PUBLIC_ASSETS_CDN_URL?.startsWith('http://localhost') ?? false),
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
      {
        protocol: 'http',
        hostname: '**',
      },
    ],
  },
}

export default nextConfig
