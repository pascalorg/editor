// Bundles the sandbox compile worker into one file and publishes it as a
// string module (`@pascal-app/geometry-script/sandbox`), so a host can hand it
// to an opaque-origin frame that cannot fetch anything itself.
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const root = join(import.meta.dir, '..')
const result = await Bun.build({
  entrypoints: [join(root, 'src/sandbox-worker.ts')],
  target: 'browser',
  format: 'iife',
  minify: true,
  // A classic script has no import.meta; the bundle only reads import.meta.env.DEV.
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta': '{}' },
})
if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}
const [bundle] = result.outputs
if (!bundle || result.outputs.length !== 1) throw new Error('Expected one sandbox bundle')
const source = await bundle.text()
await mkdir(join(root, 'dist'), { recursive: true })
await writeFile(
  join(root, 'dist/sandbox.js'),
  `/** The geometry-script compile worker, bundled: start it from a blob in a sandbox. */\nexport const sandboxWorkerSource = ${JSON.stringify(source)}\n`,
)
await writeFile(
  join(root, 'dist/sandbox.d.ts'),
  '/** The geometry-script compile worker, bundled: start it from a blob in a sandbox. */\nexport declare const sandboxWorkerSource: string\n',
)
console.log(`sandbox worker: ${(source.length / 1024).toFixed(0)} KiB`)
