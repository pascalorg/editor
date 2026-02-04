import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  transpilePackages: ['three', '@pascal-app/viewer', '@pascal-app/core'],
}

export default nextConfig
