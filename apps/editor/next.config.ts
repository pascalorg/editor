import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { NextConfig } from 'next'

const appDirectory = path.dirname(fileURLToPath(import.meta.url))
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
  async headers() {
    return [
      {
        source: '/embed/:path*',
        headers: [{ key: 'Content-Security-Policy', value: 'frame-ancestors *' }],
      },
    ]
  },
  // MCP / package metadata returns `/editor/<id>` (hosted route). This open-source
  // app serves saved projects at `/project/<id>` — redirect so links and bookmarks work.
  async redirects() {
    return [
      {
        source: '/editor/:id',
        destination: '/project/:id',
        permanent: false,
      },
      // Former routes: the list moved to the home page, scenes became projects.
      { source: '/scenes', destination: '/', permanent: false },
      { source: '/scene/:id', destination: '/project/:id', permanent: false },
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
    '@pascal-app/plugin-streetscape',
    '@pascal-app/plugin-trees',
    '@mint/pascal-plugin',
    '@pascal-app/plugin-bones',
    '@webxr/plugin',
    '@pascal-app/plugin-environment',
    '@dgreenheck/ez-tree',
  ],
  turbopack: {
    root: path.resolve(appDirectory, '../..'),
    resolveAlias: {
      '@pascal-app/core': './../../node_modules/@pascal-app/core',
      '@pascal-app/editor': './../../node_modules/@pascal-app/editor',
      '@pascal-app/viewer': './../../node_modules/@pascal-app/viewer',
      '@pascal-app/nodes': './../../node_modules/@pascal-app/nodes',
      react: './../../node_modules/react',
      'react-dom': './../../node_modules/react-dom',
      three: './../../node_modules/three',
      '@react-three/fiber': './../../node_modules/@react-three/fiber',
      '@react-three/drei': './../../node_modules/@react-three/drei',
      '@react-three/xr': './../../node_modules/@react-three/xr',
      zustand: './../../node_modules/zustand',
      zod: './../../node_modules/zod',
      iwer: './../../node_modules/iwer',
      '@iwer/devui': './../../node_modules/@iwer/devui',
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
