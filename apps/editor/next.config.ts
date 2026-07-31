import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Hostinger runs the app from a self-contained bundle; see hostinger-server.js.
  output: 'standalone',
  // Dev-only. Without these, the dev server refuses the HMR websocket for any
  // origin other than localhost, and because Turbopack delivers module updates
  // over that socket the page loads its shell and then hangs waiting for lazy
  // chunks that never arrive — with no error beyond a websocket handshake
  // failure. Needed to open the editor from a tablet or another machine.
  // The public entry (via the router's forwarded port) has to be listed too —
  // the check is on the Host header, so a LAN entry does not cover the same
  // machine reached from outside. Update this if the WAN address changes.
  allowedDevOrigins: ['192.168.1.101', '192.168.1.*', '*.local', '95.70.136.179'],
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
    '@pascal-app/mcp',
    '@pascal-app/ifc-converter',
    '@pascal-app/plugin-trees',
    '@ovurrsl/plugin-warehouse',
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
  // web-ifc parses IFC in a WASM module. It is fetched from the app's own
  // origin (scripts/copy-web-ifc-wasm.mjs puts the blobs in public/), which
  // keeps `WebAssembly.instantiateStreaming` happy about the MIME type.
  webpack: (config) => {
    config.experiments = { ...config.experiments, asyncWebAssembly: true }
    return config
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
