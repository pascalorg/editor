import { resolve } from 'node:path'
import type { NextConfig } from 'next'
import { withWorkflow } from 'workflow/next'

const nextConfig: NextConfig = {
  // Monorepo: apps/editor is two levels below the workspace root, and
  // Workflow's build-time file tracing needs the smallest root that
  // contains every workspace package a workflow might import.
  outputFileTracingRoot: resolve(process.cwd(), '../..'),
  logging: {
    browserToTerminal: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  transpilePackages: [
    'three',
    '@pascal-app/viewer',
    '@pascal-app/core',
    '@pascal-app/editor',
    '@pascal-app/plugin-trees',
    '@dgreenheck/ez-tree',
  ],
  // Server-only: never imported from a 'use client' component. Must stay
  // OUT of transpilePackages — Next's Route Handler bundler applies RSC
  // client-directive stripping even to plain server routes, which turns
  // @pascal-app/core's zustand store (marked 'use client' for the browser
  // bundle) into a client-reference stub when bundled. Externalizing lets
  // Node load the real dist files instead.
  serverExternalPackages: ['@pascal-app/mcp'],
  turbopack: {
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
    unoptimized: process.env.NEXT_PUBLIC_ASSETS_CDN_URL?.startsWith('http://localhost') ?? false,
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

export default withWorkflow(nextConfig)
