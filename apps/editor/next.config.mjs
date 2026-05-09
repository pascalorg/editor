import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  transpilePackages: [
    'three',
    '@pascal-app/viewer',
    '@pascal-app/core',
    '@pascal-app/editor',
    '@pascal-app/mcp',
  ],
  turbopack: {
    root: path.resolve(__dirname, '../..'),
    resolveAlias: {
      '@react-three/fiber': './node_modules/@react-three/fiber',
      '@react-three/drei': './node_modules/@react-three/drei',
    },
  },
  webpack: (config) => {
    config.resolve ??= {}
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      '@react-three/fiber': path.resolve(__dirname, 'node_modules/@react-three/fiber'),
      '@react-three/drei': path.resolve(__dirname, 'node_modules/@react-three/drei'),
    }

    return config
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

export default nextConfig
