import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  transpilePackages: ['@pascal/core', '@pascal-app/viewer'],
}

export default nextConfig
