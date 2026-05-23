import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  logging: {
    browserToTerminal: true,
  },
  transpilePackages: [
    'three',
    '@pascal-app/core',
    '@pascal-app/ifc-converter',
    '@pascal-app/nodes',
    '@pascal-app/viewer',
  ],
  turbopack: {
    resolveAlias: {
      react: './node_modules/react',
      three: './node_modules/three',
      '@react-three/fiber': './node_modules/@react-three/fiber',
      '@react-three/drei': './node_modules/@react-three/drei',
    },
  },
  // web-ifc ships a WASM module. Serving it from the same origin as the
  // app keeps `WebAssembly.instantiateStreaming` happy with strict CSP /
  // module-MIME-type checks. The standalone repo copied the file into
  // public/; we do the same on first dev/build via a postinstall step
  // (see scripts/copy-web-ifc-wasm.mjs).
  webpack: (config) => {
    config.experiments = { ...config.experiments, asyncWebAssembly: true }
    return config
  },
}

export default nextConfig
