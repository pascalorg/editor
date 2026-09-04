// Rebuild the library and refresh the data files the site serves.
// The site is a bun workspace member consuming
// @pascal-app/lingo as a live workspace link — fresh dist/ is visible the
// moment the build finishes, so no copy/rsync step exists anymore. What
// remains is the data that gets baked into site assets:
//   llms-small.txt → apps/site/public/llms-small.txt (npm-shipped compressed reference)
//   bench baselines → apps/site/src/data/*.json        (docs performance copy)
import { execSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'

const ROOT = new URL('..', import.meta.url).pathname
const PKG = `${ROOT}packages/lingo`
const SITE = `${ROOT}apps/site`

execSync('bun run build', { cwd: PKG, stdio: 'inherit' })
mkdirSync(`${SITE}/public`, { recursive: true })
copyFileSync(`${PKG}/llms.txt`, `${SITE}/public/llms-small.txt`)
mkdirSync(`${SITE}/src/data`, { recursive: true })
copyFileSync(`${PKG}/bench/baseline-node.json`, `${SITE}/src/data/bench-baseline.json`)
const aiEvalSource = `${PKG}/bench/ai-eval.json`
const aiEvalTarget = `${SITE}/src/data/ai-eval.json`
if (existsSync(aiEvalSource)) {
  copyFileSync(aiEvalSource, aiEvalTarget)
} else {
  rmSync(aiEvalTarget, { force: true })
}
console.log('library rebuilt — the site sees dist/ live via the workspace link')
console.log(`synced llms-small.txt → ${SITE}/public/llms-small.txt`)
console.log(`synced bench baseline → ${SITE}/src/data/bench-baseline.json`)
console.log(
  existsSync(aiEvalSource)
    ? `synced ai eval → ${aiEvalTarget}`
    : `ai eval absent → removed ${aiEvalTarget}`,
)
