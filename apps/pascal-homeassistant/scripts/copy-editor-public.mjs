import { cp, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const appDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const repoRoot = path.resolve(appDir, '../..')
const sourcePublic = path.join(repoRoot, 'apps/editor/public')
const outputPublic = path.join(appDir, 'out')

await mkdir(outputPublic, { recursive: true })
await cp(sourcePublic, outputPublic, {
  recursive: true,
  force: true,
})
