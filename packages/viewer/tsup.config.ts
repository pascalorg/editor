import type { Plugin } from 'esbuild'
import fs from 'fs'
import path from 'path'
import { defineConfig } from 'tsup'

// Read core package.json exports to get the mapping
const corePackagePath = path.resolve(__dirname, '../core/package.json')
const corePackage = JSON.parse(fs.readFileSync(corePackagePath, 'utf-8'))
const coreExports = corePackage.exports as Record<string, string>

// Plugin to resolve @pascal/core/* imports to local source files
const pascalCorePlugin: Plugin = {
  name: 'pascal-core-resolver',
  setup(build) {
    const coreBasePath = path.resolve(__dirname, '../core')

    // Handle @pascal/core (main entry)
    build.onResolve({ filter: /^@pascal\/core$/ }, () => ({
      path: path.join(coreBasePath, 'src/index.ts'),
    }))

    // Handle @pascal/core/* subpath imports
    build.onResolve({ filter: /^@pascal\/core\// }, (args) => {
      const subpath = './' + args.path.replace('@pascal/core/', '')

      // First check if there's an explicit export mapping
      if (coreExports[subpath]) {
        const mappedPath = path.join(coreBasePath, coreExports[subpath])
        if (fs.existsSync(mappedPath)) {
          return { path: mappedPath }
        }
      }

      // Fall back to trying common file extensions
      const srcSubpath = args.path.replace('@pascal/core/', '')
      const srcBasePath = path.join(coreBasePath, 'src')
      const candidates = [
        path.join(srcBasePath, `${srcSubpath}.ts`),
        path.join(srcBasePath, `${srcSubpath}.tsx`),
        path.join(srcBasePath, srcSubpath, 'index.ts'),
        path.join(srcBasePath, srcSubpath, 'index.tsx'),
      ]

      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
          return { path: candidate }
        }
      }

      // Fallback - let esbuild try to resolve it
      return { path: path.join(srcBasePath, srcSubpath) }
    })
  },
}

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  // Skip DTS generation - the bundled core has complex zod types that cause issues
  // Types will be provided separately via the src/index.ts re-exports
  dts: false,
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  // Only externalize peer dependencies - bundle @pascal/core and other deps into the output
  external: ['react', 'react-dom', 'three', '@react-three/fiber'],
  // Explicitly bundle these packages (don't auto-externalize from dependencies)
  noExternal: [
    '@react-three/drei',
    '@react-three/csg',
    '@react-three/uikit',
    '@react-spring/three',
  ],
  esbuildPlugins: [pascalCorePlugin],
  // Add "use client" directive and copy type declarations
  onSuccess: async () => {
    const fs = await import('fs')
    const nodePath = await import('path')
    const cwd = process.cwd()

    // Add "use client" directive to the bundle
    const distPath = nodePath.join(cwd, 'dist', 'index.js')
    const content = fs.readFileSync(distPath, 'utf-8')
    fs.writeFileSync(distPath, `"use client";\n${content}`)
    console.log('Added "use client" directive to dist/index.js')

    // Copy type declarations
    const typesSource = nodePath.join(cwd, 'types.d.ts')
    const typesDest = nodePath.join(cwd, 'dist', 'index.d.ts')
    fs.copyFileSync(typesSource, typesDest)
    console.log('Copied types.d.ts to dist/index.d.ts')
  },
})
