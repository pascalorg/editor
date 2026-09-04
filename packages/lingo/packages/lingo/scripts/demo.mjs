// Builds the self-contained demo bundle (core + date + dom) as an IIFE
// exposing `lingo` on window. Usage: node scripts/demo.mjs

import { existsSync } from 'node:fs'
import { build } from 'esbuild'

const ROOT = new URL('..', import.meta.url).pathname
const parts = [`export * from './src/index.ts'`]
if (existsSync(`${ROOT}src/date/index.ts`)) {
  parts.push(`export * from './src/date/index.ts'`)
}
if (existsSync(`${ROOT}src/dom/index.ts`)) {
  parts.push(`export * from './src/dom/index.ts'`)
}

await build({
  stdin: { contents: parts.join('\n'), resolveDir: ROOT, loader: 'ts' },
  bundle: true,
  minify: true,
  format: 'iife',
  globalName: 'lingo',
  target: 'es2020',
  outfile: `${ROOT}demo/lingo.demo.js`,
  logLevel: 'info',
})
