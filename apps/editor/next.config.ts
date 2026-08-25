import type { NextConfig } from 'next'

const portableBuild = process.env.PASCAL_PORTABLE_BUILD === '1'

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
  // Upstream gates `standalone` behind PASCAL_PORTABLE_BUILD=1. Ours stays
  // unconditional: the deploy copies `hostinger-server.js` into the standalone
  // output, so a build without it produces nothing to serve — and the failure
  // would be a missing directory at the end of a green build.
  //
  // `outputFileTracingRoot` came with the beta.5 merge and is deliberately not
  // taken. It was removed while hunting a failed deploy and turned out NOT to
  // be the cause — that was a Next version skew between this build and the
  // bundle's runtime (`.github/deploy/package.json`). It stays out anyway: it
  // decides where `.next/standalone` puts traced dependencies, the deploy only
  // ever copies `standalone/apps/editor/`, and every deploy that has worked
  // here was built without it. Adding it back needs a reason and a green
  // deploy, not an inherited default.
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
    '@pascal-app/ifc-converter',
    '@pascal-app/plugin-streetscape',
    '@pascal-app/plugin-trees',
    '@pascal-app/plugin-articraft',
    '@mint/pascal-plugin',
    '@pascal-app/plugin-bones',
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
  // The console's db driver and argon2 are native/dynamic-require packages the
  // bundler must not inline; both ship as real node_modules in the deploy
  // bundle. Neither is in transpilePackages, so no conflict.
  serverExternalPackages: ['@node-rs/argon2'],
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
