import type { NextConfig } from 'next'

// The catalog still loads item thumbnails and GLBs from a Supabase bucket until
// the CDN work moves them under our own host. `images.remotePatterns` has to be
// narrowed to the hosts we actually load from: a wildcard here lets the Next
// image optimizer fetch and proxy any URL, which is both an SSRF door and a
// bandwidth-amplification vector.
const CATALOG_IMAGE_HOST = 'byrpxoiotywskoojsrzd.supabase.co'

function hostOf(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

function remoteImagePatterns() {
  const httpsHosts = new Set([CATALOG_IMAGE_HOST])
  const cdnHost = hostOf(process.env.NEXT_PUBLIC_ASSETS_CDN_URL)
  const s3Host = hostOf(process.env.S3_ENDPOINT)
  if (cdnHost) httpsHosts.add(cdnHost)
  if (s3Host) httpsHosts.add(s3Host)

  return [
    ...[...httpsHosts].map((hostname) => ({ protocol: 'https' as const, hostname })),
    // Local dev servers serve images over http.
    { protocol: 'http' as const, hostname: 'localhost' },
    { protocol: 'http' as const, hostname: '127.0.0.1' },
  ]
}

const nextConfig: NextConfig = {
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
      // No server action should accept a request larger than the largest upload
      // the app allows (a single GLB/image). 100mb was an unbounded default.
      bodySizeLimit: '25mb',
    },
  },
  images: {
    unoptimized: process.env.NEXT_PUBLIC_ASSETS_CDN_URL?.startsWith('http://localhost') ?? false,
    remotePatterns: remoteImagePatterns(),
  },
}

export default nextConfig
