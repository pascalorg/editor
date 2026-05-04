import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../../..')
const packageBundlePath = path.join(
  repoRoot,
  'packages/lovelace-card/dist/pascal-viewer-card.js',
)
const hacsDistDir = path.join(repoRoot, 'dist')
const hacsBundlePath = path.join(hacsDistDir, 'pascal-viewer-card.js')

async function main() {
  const bundleStats = await stat(packageBundlePath)
  if (!bundleStats.isFile()) {
    throw new Error(`Missing Lovelace card bundle at ${packageBundlePath}`)
  }

  const bundle = await readFile(packageBundlePath, 'utf8')
  await mkdir(hacsDistDir, { recursive: true })
  const normalizedBundle = bundle.replace(/[ \t]+$/gm, '').replace(/ +\t/g, '\t')
  await writeFile(hacsBundlePath, normalizedBundle)
  console.log(`Prepared HACS bundle: ${path.relative(repoRoot, hacsBundlePath)}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
