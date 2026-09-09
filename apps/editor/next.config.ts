import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { NextConfig } from 'next'

const appDirectory = path.dirname(fileURLToPath(import.meta.url))
const portableBuild = process.env.PASCAL_PORTABLE_BUILD === '1'

const nextConfig: NextConfig = {
  allowedDevOrigins: ['192.168.0.102'],
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
    '@pascal-app/plugin-streetscape',
    '@pascal-app/plugin-trees',
    '@mint/pascal-plugin',
    '@pascal-app/plugin-bones',
    '@dgreenheck/ez-tree',
  ],
  turbopack: {
    // Include the editor and locally linked sibling plugin without watching the whole home folder.
    root: path.join(appDirectory, '../../..'),
    resolveAlias: {
      '@pascal-app/core': '../../packages/core/src/index.ts',
      '@pascal-app/editor': '../../packages/editor/src/index.tsx',
      '@pascal-app/viewer': '../../packages/viewer/src/index.ts',
      react: '../../node_modules/react',
      three: '../../node_modules/three',
      // TSL and the renderer must share one module-level shader stack.
      'three/webgpu': '../../node_modules/three/build/three.webgpu.js',
      'three/tsl': '../../node_modules/three/build/three.tsl.js',
      '@react-three/fiber': '../../node_modules/@react-three/fiber',
      '@react-three/drei': '../../node_modules/@react-three/drei',
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
