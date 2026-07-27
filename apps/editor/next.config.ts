import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  logging: {
    browserToTerminal: true,
  },
  // The scene store hands out `/editor/<id>` as the canonical project URL
  // (`packages/mcp/src/storage/sqlite-scene-store.ts` `editorUrlForScene`), and
  // the hosted product serves that path. This app names its route `/scene/[id]`,
  // so every MCP-reported `editorUrl` 404s here.
  //
  // Rewrite rather than redirect: the browser path has to keep the `/editor/`
  // prefix because client code parses the project id back out of it (see
  // `packages/editor/src/components/ui/action-menu/view-toggles.tsx`, scan
  // upload). `/scene/<id>` keeps working for the app's own links.
  async rewrites() {
    return [{ source: '/editor/:id', destination: '/scene/:id' }]
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  transpilePackages: [
    'three',
    '@pascal-app/viewer',
    '@pascal-app/core',
    '@pascal-app/editor',
    '@pascal-app/mcp',
    '@pascal-app/plugin-trees',
    '@dgreenheck/ez-tree',
  ],
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

export default nextConfig
