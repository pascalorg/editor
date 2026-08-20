import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // This repo's custom Next dist dirs (NEXT_DIST_DIR=.next-dev in dev,
    // .next-build for prod-in-CI) — Biome already excludes **/.next*.
    '.next-dev/**',
    '.next-build/**',
  ]),
])

export default eslintConfig
