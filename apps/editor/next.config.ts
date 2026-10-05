import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { NextConfig } from 'next'

const appDirectory = path.dirname(fileURLToPath(import.meta.url))
const editorRoot = path.resolve(appDirectory, '../..')
const portableBuild = process.env.PASCAL_PORTABLE_BUILD === '1'

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
    '@pascal-app/nodes',
    '@pascal-app/mcp',
    '@pascal-app/plugin-pool',
    '@pascal-app/plugin-bath-space',
    '@pascal-app/plugin-landscape',
    '@pascal-app/plugin-streetscape',
    '@pascal-app/plugin-trees',
    '@mint/pascal-plugin',
    '@pascal-app/plugin-bones',
    '@webxr/plugin',
    '@pascal-app/plugin-environment',
    '@dgreenheck/ez-tree',
  ],
  webpack(config, { dev }) {
    if (!dev) config.resolve.alias['react-scan'] = false
    for (const name of ['core', 'viewer', 'editor']) {
      config.resolve.alias[`@pascal-app/${name}`] = path.join(editorRoot, 'packages', name)
    }
    return config
  },
  turbopack: {
    root: path.resolve(appDirectory, '../../..'),
    resolveAlias: {
      // App Router requires Next's bundled React, including Fragment refs.
      three: '../../node_modules/three',
      '@react-three/fiber': '../../node_modules/@react-three/fiber',
      '@react-three/drei': '../../node_modules/@react-three/drei',
      '@pascal-app/core': '../../packages/core',
      '@pascal-app/viewer': '../../packages/viewer',
      '@pascal-app/editor': '../../packages/editor',
      '@pascal-app/nodes': path.relative(
        appDirectory,
        path.join(editorRoot, 'packages/nodes/src/index.ts'),
      ),
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
