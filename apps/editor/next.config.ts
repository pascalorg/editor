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
  // `outputFileTracingRoot` came with the beta.5 merge and is NOT taken. It
  // decides where `.next/standalone` puts the traced dependencies, and pointing
  // it at the monorepo root moves them to `standalone/node_modules` — outside
  // `standalone/apps/editor/`, which is the only subtree
  // `.github/workflows/deploy-bundle.yml` copies into the bundle. The build
  // stays green, the assemble step stays green, the server boots and logs
  // normally, and then every route that needs a traced module fails to resolve.
  // The published deploy answered nothing on `/api/health` for a full minute
  // with not one line in the log. Upstream can afford the setting because it
  // ships the whole standalone tree; we ship one subtree of it.
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
    '@pascal-app/plugin-trees',
    '@mint/pascal-plugin',
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
