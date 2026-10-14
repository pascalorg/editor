#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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
  console.error('[plugin-ifc] web-ifc package not found; cannot copy its required WASM files.')
  process.exit(1)
}

const publicDir = join(scriptDir, '..', 'public')
mkdirSync(publicDir, { recursive: true })
for (const name of ['web-ifc.wasm', 'web-ifc-mt.wasm', 'web-ifc-node.wasm']) {
  const source = join(webIfcDir, name)
  if (!existsSync(source)) continue
  const destination = join(publicDir, name)
  if (existsSync(destination) && statSync(destination).size === statSync(source).size) continue
  copyFileSync(source, destination)
  console.log(`[plugin-ifc] copied ${name}`)
}
