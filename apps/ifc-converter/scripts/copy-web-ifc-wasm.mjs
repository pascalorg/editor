#!/usr/bin/env node
// web-ifc ships its WASM binaries inside node_modules. Next.js needs to
// serve them at the app root URL (the library hardcodes `/web-ifc.wasm`
// when no `wasmPath` override is set), so copy the three blobs into
// `public/` so they're served from /web-ifc*.wasm.
//
// Run on `postinstall` and again on `predev` / `prebuild` so a forgotten
// install step doesn't leave the dev server with a stale or missing
// copy. Idempotent: skips files that already match by size.

import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// web-ifc's package.json doesn't expose subpath exports, so we can't use
// require.resolve('web-ifc/package.json'). Walk up the script directory
// looking for the package folder inside any node_modules along the way.
function findWebIfcDir(startDir) {
  let dir = startDir
  while (dir && dir !== '/') {
    const candidate = join(dir, 'node_modules', 'web-ifc')
    if (existsSync(join(candidate, 'web-ifc.wasm'))) return candidate
    dir = resolve(dir, '..')
  }
  return null
}

const scriptDir = dirname(fileURLToPath(import.meta.url))
const webIfcDir = findWebIfcDir(scriptDir)
if (!webIfcDir) {
  console.error('[ifc-converter] web-ifc package not found — cannot copy required WASM files.')
  process.exit(1)
}
const publicDir = join(scriptDir, '..', 'public')

mkdirSync(publicDir, { recursive: true })

const files = ['web-ifc.wasm', 'web-ifc-mt.wasm', 'web-ifc-node.wasm']
let copyFailed = false
for (const name of files) {
  const src = join(webIfcDir, name)
  const dst = join(publicDir, name)
  try {
    const srcSize = statSync(src).size
    let dstSize = 0
    try {
      dstSize = statSync(dst).size
    } catch {
      /* not present yet */
    }
    if (srcSize === dstSize) {
      continue
    }
    copyFileSync(src, dst)
    console.log(`[ifc-converter] copied ${name} (${(srcSize / 1024).toFixed(0)} KB)`)
  } catch (err) {
    console.error(`[ifc-converter] could not copy ${name}:`, err.message)
    copyFailed = true
  }
}

if (copyFailed) process.exit(1)
