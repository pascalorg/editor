import path from 'node:path'
import type { NextConfig } from 'next'

const repoRoot = path.resolve(process.cwd(), '../..')
const lingoDist = '../../packages/lingo/dist'

const nextConfig: NextConfig = {
  // Dev and prod-verification servers run from this dir simultaneously;
  // NEXT_DIST_DIR keeps `next dev` (.next-dev) from clobbering the
  // `next build` output (.next) that `next start` serves.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  typescript: {
    ignoreBuildErrors: true,
  },
  turbopack: {
    root: repoRoot,
    resolveAlias: {
      '@pascal-app/lingo': path.join(lingoDist, 'index.js'),
      '@pascal-app/lingo/ai': path.join(lingoDist, 'ai/index.js'),
      '@pascal-app/lingo/core': path.join(lingoDist, 'core/index.js'),
      '@pascal-app/lingo/date': path.join(lingoDist, 'date/index.js'),
      '@pascal-app/lingo/dom': path.join(lingoDist, 'dom/index.js'),
      '@pascal-app/lingo/react': path.join(lingoDist, 'react/index.js'),
    },
  },
  experimental: {
    turbopackPluginRuntimeStrategy: 'workerThreads',
  },
  async redirects() {
    // Permanent (308): these legacy paths are retired for good, and permanent
    // redirects let crawlers consolidate signals onto /docs.
    return [
      {
        source: '/escalation',
        destination: '/docs#strictness',
        permanent: true,
      },
      {
        source: '/forms',
        destination: '/docs#forms',
        permanent: true,
      },
      {
        source: '/coverage',
        destination: '/docs#coverage',
        permanent: true,
      },
      {
        source: '/integrations',
        destination: '/docs#integrations',
        permanent: true,
      },
    ]
  },
  async rewrites() {
    // /docs/<section>.md (agent markdown) and /docs/<section> (indexable HTML)
    // share the [slug] segment, and Next can't put a route handler and a page
    // in the same segment. beforeFiles keeps the public .md URLs stable while
    // the handler lives at /docs-md/[slug].
    return {
      beforeFiles: [
        {
          source: '/docs/:slug([^/]+\\.md)',
          destination: '/docs-md/:slug',
        },
      ],
      afterFiles: [],
      fallback: [],
    }
  },
}

export default nextConfig
