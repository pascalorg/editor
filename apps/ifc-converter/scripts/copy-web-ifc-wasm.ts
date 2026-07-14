#!/usr/bin/env bun
// web-ifc ships its WASM binaries inside node_modules. Next.js needs to
// serve them at the app root URL (the library hardcodes `/web-ifc.wasm`
// when no `wasmPath` override is set), so copy the three blobs into
// `public/` so they're served from /web-ifc*.wasm.
//
// Run on `postinstall` and again on `predev` / `prebuild` so a forgotten
// install step doesn't leave the dev server with a stale or missing
// copy. Idempotent: skips files that already match by size.

import { join, resolve } from 'node:path'

// web-ifc's package.json doesn't expose subpath exports, so we can't use
// `import.meta.resolve('web-ifc/package.json')`. Walk up the script directory
// looking for the package folder inside any node_modules along the way.
async function findWebIfcDir(startDir: string): Promise<string | null> {
  let dir = startDir
  while (dir && dir !== '/') {
    const candidate = join(dir, 'node_modules', 'web-ifc')
    if (await Bun.file(join(candidate, 'web-ifc.wasm')).exists()) return candidate
    dir = resolve(dir, '..')
  }
  return null
}

const scriptDir = import.meta.dir
const webIfcDir = await findWebIfcDir(scriptDir)
if (!webIfcDir) {
  console.warn('[ifc-converter] web-ifc package not found — wasm copy skipped.')
  process.exit(0)
}

const publicDir = join(scriptDir, '..', 'public')

const files = ['web-ifc.wasm', 'web-ifc-mt.wasm', 'web-ifc-node.wasm']
for (const name of files) {
  const src = Bun.file(join(webIfcDir, name))
  const dst = Bun.file(join(publicDir, name))
  try {
    const srcSize = src.size
    const dstSize = (await dst.exists()) ? dst.size : 0
    if (srcSize === dstSize) {
      continue
    }
    await Bun.write(dst, src)
    console.log(`[ifc-converter] copied ${name} (${(srcSize / 1024).toFixed(0)} KB)`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn(`[ifc-converter] could not copy ${name}:`, message)
  }
}
